-- ============================================
-- BHAS 주문 통합관리(OMS) — 카페24 주문 수집 + 배송/송장
-- Supabase Dashboard → SQL Editor에서 실행 (001~003 이후)
-- 신규 테이블만 추가. 기존 무변경.
-- ============================================

-- 수집된 주문 (채널 무관 설계, 현재는 cafe24)
CREATE TABLE IF NOT EXISTS channel_orders (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel          TEXT NOT NULL DEFAULT 'cafe24',
  order_id         TEXT NOT NULL,              -- 채널 주문번호
  order_date       TIMESTAMPTZ,
  buyer_name       TEXT,
  receiver_name    TEXT,
  receiver_phone   TEXT,
  receiver_zipcode TEXT,
  receiver_address TEXT,
  pay_amount       NUMERIC,
  channel_status   TEXT,                       -- 카페24 order_status 원본(N00,N10,N20,N30...)
  status           TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','ready','shipping','done','hold')),
  courier          TEXT,                       -- 택배사
  invoice_no       TEXT,                       -- 운송장번호
  memo             TEXT,
  raw              JSONB,
  collected_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  shipped_at       TIMESTAMPTZ,
  UNIQUE(channel, order_id)
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON channel_orders(status, order_date DESC);

-- 주문 품목
CREATE TABLE IF NOT EXISTS channel_order_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_order_id  UUID NOT NULL REFERENCES channel_orders(id) ON DELETE CASCADE,
  variant_code      TEXT,
  product_name      TEXT,
  option_name       TEXT,
  quantity          INT NOT NULL DEFAULT 1,
  inventory_item_id UUID REFERENCES inventory_items(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON channel_order_items(channel_order_id);

-- updated 트리거 불필요(수집/갱신은 Edge Function이 명시적으로 처리)

-- ============================================
-- RLS
-- ============================================
ALTER TABLE channel_orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "orders_select" ON channel_orders;
DROP POLICY IF EXISTS "orders_update" ON channel_orders;
CREATE POLICY "orders_select" ON channel_orders FOR SELECT USING (auth.uid() IS NOT NULL);
-- 메모/상태 수동 변경은 MASTER/STAFF (수집/배송확정은 Edge Function=service_role)
CREATE POLICY "orders_update" ON channel_orders FOR UPDATE USING (get_user_role() IN ('MASTER','STAFF'));

DROP POLICY IF EXISTS "order_items_select" ON channel_order_items;
CREATE POLICY "order_items_select" ON channel_order_items FOR SELECT USING (auth.uid() IS NOT NULL);

SELECT 'orders schema installed' AS status;
