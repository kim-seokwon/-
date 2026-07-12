-- ============================================
-- BHAS 재고관리 + 카페24 연동 스키마
-- Supabase Dashboard → SQL Editor에서 실행하세요
-- 기존 supabase_rls_setup.sql의 헬퍼함수(get_user_role 등)에 의존합니다.
-- 안전: 신규 테이블만 추가. 기존 테이블 무변경.
-- ============================================

-- ============================================
-- 1. inventory_items : 재고 품목 (브하스 SKU = 단일 진실원천)
-- ============================================
CREATE TABLE IF NOT EXISTS inventory_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku          TEXT UNIQUE NOT NULL,
  name         TEXT NOT NULL,
  option_name  TEXT,                       -- 색상/사이즈 등 옵션
  brand_id     UUID REFERENCES brands(id) ON DELETE SET NULL,
  product_id   UUID REFERENCES products(id) ON DELETE SET NULL,  -- 제작 프로젝트 연결(옵션)
  on_hand      INT NOT NULL DEFAULT 0,      -- 현재고 캐시 (= 원장 합계, 트리거로 유지)
  safety_stock INT NOT NULL DEFAULT 0,      -- 안전재고(이하면 경고)
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inv_items_brand ON inventory_items(brand_id);

-- ============================================
-- 2. channel_listings : 브하스 SKU ↔ 채널 품목 매핑
-- ============================================
CREATE TABLE IF NOT EXISTS channel_listings (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_item_id    UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  channel              TEXT NOT NULL DEFAULT 'cafe24',   -- 'cafe24'|'29cm'|'kidikidi'...
  channel_product_no   TEXT,            -- 카페24 product_no
  channel_variant_code TEXT,            -- 카페24 variant_code (품목코드)
  channel_sku          TEXT,            -- 채널측 SKU(있으면)
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(channel, channel_variant_code)
);
CREATE INDEX IF NOT EXISTS idx_listings_item ON channel_listings(inventory_item_id);

-- ============================================
-- 3. inventory_ledger : 재고 변동 원장 (append-only, 감사추적)
--    현재고 = 원장 delta 합계. 트리거로 inventory_items.on_hand 갱신.
-- ============================================
CREATE TABLE IF NOT EXISTS inventory_ledger (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  delta             INT NOT NULL,        -- +입고/보정, -판매/차감
  reason            TEXT NOT NULL CHECK (reason IN ('initial','restock','cafe24_order','manual','adjust','return')),
  ref               TEXT,                -- 주문번호 등 외부 참조(멱등키)
  note              TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        TEXT
);
CREATE INDEX IF NOT EXISTS idx_ledger_item ON inventory_ledger(inventory_item_id, created_at DESC);
-- 같은 채널주문(ref) 중복 차감 방지: cafe24_order는 (item, ref) 유일
CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_order
  ON inventory_ledger(inventory_item_id, ref) WHERE reason = 'cafe24_order';

-- 원장 입력 시 현재고 캐시 자동 갱신
CREATE OR REPLACE FUNCTION apply_ledger_to_onhand()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE inventory_items
     SET on_hand = on_hand + NEW.delta,
         updated_at = now()
   WHERE id = NEW.inventory_item_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ledger_onhand ON inventory_ledger;
CREATE TRIGGER trg_ledger_onhand
  AFTER INSERT ON inventory_ledger
  FOR EACH ROW EXECUTE FUNCTION apply_ledger_to_onhand();

-- ============================================
-- 4. channel_sync_state : 채널 토큰/동기화 상태 (민감 — service_role 전용)
-- ============================================
CREATE TABLE IF NOT EXISTS channel_sync_state (
  channel               TEXT PRIMARY KEY,         -- 'cafe24'
  mall_id               TEXT,
  access_token          TEXT,
  refresh_token         TEXT,
  expires_at            TIMESTAMPTZ,
  last_order_synced_at  TIMESTAMPTZ,
  dry_run               BOOLEAN NOT NULL DEFAULT TRUE,   -- 기본 ON: push는 로그만
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- 5. sync_log : 동기화 실행 로그 (실패 가시화)
-- ============================================
CREATE TABLE IF NOT EXISTS sync_log (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  channel  TEXT,
  type     TEXT,                 -- 'oauth'|'pull_orders'|'push_inventory'|'error'
  result   TEXT,                 -- 'ok'|'error'|'dry_run'
  detail   JSONB
);
CREATE INDEX IF NOT EXISTS idx_synclog_run ON sync_log(run_at DESC);

-- ============================================
-- RLS
-- ============================================
ALTER TABLE inventory_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_listings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_ledger  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_log          ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_sync_state ENABLE ROW LEVEL SECURITY;  -- 정책 無 → 기본 deny, service_role만 접근

DROP POLICY IF EXISTS "inv_items_select" ON inventory_items;
DROP POLICY IF EXISTS "inv_items_write"  ON inventory_items;
DROP POLICY IF EXISTS "inv_items_update" ON inventory_items;
DROP POLICY IF EXISTS "inv_items_delete" ON inventory_items;
CREATE POLICY "inv_items_select" ON inventory_items FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "inv_items_write"  ON inventory_items FOR INSERT WITH CHECK (get_user_role() IN ('MASTER','STAFF'));
CREATE POLICY "inv_items_update" ON inventory_items FOR UPDATE USING (get_user_role() IN ('MASTER','STAFF'));
CREATE POLICY "inv_items_delete" ON inventory_items FOR DELETE USING (get_user_role() = 'MASTER');

DROP POLICY IF EXISTS "listings_select" ON channel_listings;
DROP POLICY IF EXISTS "listings_write"  ON channel_listings;
DROP POLICY IF EXISTS "listings_delete" ON channel_listings;
CREATE POLICY "listings_select" ON channel_listings FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "listings_write"  ON channel_listings FOR INSERT WITH CHECK (get_user_role() IN ('MASTER','STAFF'));
CREATE POLICY "listings_delete" ON channel_listings FOR DELETE USING (get_user_role() IN ('MASTER','STAFF'));

DROP POLICY IF EXISTS "ledger_select" ON inventory_ledger;
DROP POLICY IF EXISTS "ledger_insert" ON inventory_ledger;
CREATE POLICY "ledger_select" ON inventory_ledger FOR SELECT USING (auth.uid() IS NOT NULL);
-- 사용자 수동조정만 허용(manual/restock/adjust/initial/return). cafe24_order는 service_role(Edge Function)만.
CREATE POLICY "ledger_insert" ON inventory_ledger FOR INSERT WITH CHECK (
  get_user_role() IN ('MASTER','STAFF')
  AND reason IN ('initial','restock','manual','adjust','return')
);

DROP POLICY IF EXISTS "synclog_select" ON sync_log;
CREATE POLICY "synclog_select" ON sync_log FOR SELECT USING (auth.uid() IS NOT NULL);

-- ============================================
-- 확인
-- ============================================
SELECT 'inventory schema installed' AS status;
