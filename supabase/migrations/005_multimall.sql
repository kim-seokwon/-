-- ============================================
-- BHAS 멀티몰 전환 — 브랜드마다 별도 카페24몰 (SKU 겹침 없음)
-- Supabase Dashboard → SQL Editor에서 실행 (001~004 이후)
-- 토큰 미발급 상태에서 안전하게 재구성. 재고/노션 데이터는 무변경.
-- ============================================

-- 1. malls : 몰 레지스트리 (프론트가 읽음, 자격증명 제외)
CREATE TABLE IF NOT EXISTS malls (
  mall_key       TEXT PRIMARY KEY,         -- 'hiheiho','rohi','tobi','bnap' 등 식별자
  label          TEXT NOT NULL,            -- 표시명(하이헤이호 등)
  channel        TEXT NOT NULL DEFAULT 'cafe24',
  cafe24_mall_id TEXT,                     -- 카페24 몰아이디(xxx.cafe24.com 의 xxx)
  brand_id       UUID REFERENCES brands(id) ON DELETE SET NULL,
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  connected      BOOLEAN NOT NULL DEFAULT FALSE,  -- OAuth 토큰 발급 완료 여부(oauth 함수가 세팅)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE malls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "malls_select" ON malls;
DROP POLICY IF EXISTS "malls_write"  ON malls;
DROP POLICY IF EXISTS "malls_update" ON malls;
DROP POLICY IF EXISTS "malls_delete" ON malls;
CREATE POLICY "malls_select" ON malls FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "malls_write"  ON malls FOR INSERT WITH CHECK (get_user_role() IN ('MASTER','STAFF'));
CREATE POLICY "malls_update" ON malls FOR UPDATE USING (get_user_role() IN ('MASTER','STAFF'));
CREATE POLICY "malls_delete" ON malls FOR DELETE USING (get_user_role() = 'MASTER');

-- 2. channel_sync_state 재구성 — 몰별 자격증명·토큰 (service_role 전용, RLS deny)
DROP TABLE IF EXISTS channel_sync_state;
CREATE TABLE channel_sync_state (
  mall_key             TEXT PRIMARY KEY REFERENCES malls(mall_key) ON DELETE CASCADE,
  channel              TEXT NOT NULL DEFAULT 'cafe24',
  cafe24_mall_id       TEXT,
  client_id            TEXT,            -- 카페24 앱 client_id (몰별 private app)
  client_secret        TEXT,            -- client_secret
  access_token         TEXT,
  refresh_token        TEXT,
  expires_at           TIMESTAMPTZ,
  last_order_synced_at TIMESTAMPTZ,
  dry_run              BOOLEAN NOT NULL DEFAULT TRUE,   -- 기본 ON: push는 로그만
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE channel_sync_state ENABLE ROW LEVEL SECURITY;
-- SELECT 정책 없음 → 토큰은 프론트가 못 읽음. MASTER는 자격증명/설정만 입력(INSERT/UPDATE) 가능.
DROP POLICY IF EXISTS "css_master_insert" ON channel_sync_state;
DROP POLICY IF EXISTS "css_master_update" ON channel_sync_state;
CREATE POLICY "css_master_insert" ON channel_sync_state FOR INSERT WITH CHECK (get_user_role() = 'MASTER');
CREATE POLICY "css_master_update" ON channel_sync_state FOR UPDATE USING (get_user_role() = 'MASTER');

-- 3. channel_listings : 어느 몰의 상품 매핑인지 (mall_key)
ALTER TABLE channel_listings ADD COLUMN IF NOT EXISTS mall_key TEXT REFERENCES malls(mall_key) ON DELETE CASCADE;
ALTER TABLE channel_listings DROP CONSTRAINT IF EXISTS channel_listings_channel_channel_variant_code_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_listing_mall_variant
  ON channel_listings(mall_key, channel_variant_code) WHERE channel_variant_code IS NOT NULL;

-- 4. channel_orders : 어느 몰에서 온 주문인지 (mall_key)
ALTER TABLE channel_orders ADD COLUMN IF NOT EXISTS mall_key TEXT REFERENCES malls(mall_key) ON DELETE SET NULL;
ALTER TABLE channel_orders DROP CONSTRAINT IF EXISTS channel_orders_channel_order_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_order_mall_orderid ON channel_orders(mall_key, order_id);

-- 5. inventory_items : 이 SKU가 속한 몰(브랜드별 분리이므로 1:1) — 필터 편의용
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS mall_key TEXT REFERENCES malls(mall_key) ON DELETE SET NULL;

SELECT 'multimall schema installed' AS status;
