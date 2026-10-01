-- ============================================
-- 제품리스트(product_items) — 생산의 중심 표
-- Supabase SQL Editor에서 실행 (007_vendors, 008_quotes, 013_tech_packs, 040_project_members 이후)
--
-- 'products' 테이블은 이제 화면에서 **시즌**으로 부른다(= 프로젝트 이름 변경).
-- 제품 한 줄이 시즌·공장·작업지시서·샘플·견적을 모두 물고 있어
-- 어디서 열어도 같은 줄을 보게 만든다.
-- ============================================

CREATE TABLE IF NOT EXISTS product_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id     UUID REFERENCES brands(id)   ON DELETE SET NULL,  -- 브랜드
  name         TEXT NOT NULL DEFAULT '',                         -- 이름
  pattern_no   TEXT,                                             -- 패턴명
  status       TEXT NOT NULL DEFAULT '요청하기',                  -- 제작현황
  memo         TEXT,
  trims        BOOLEAN NOT NULL DEFAULT false,                   -- 부자재
  checked      BOOLEAN NOT NULL DEFAULT false,                   -- 체크
  vendor_id    UUID REFERENCES vendors(id)  ON DELETE SET NULL,  -- 공장
  product_id   UUID REFERENCES products(id) ON DELETE SET NULL,  -- 시즌
  ship_date    DATE,                                             -- 출고예정일
  open_date    DATE,                                             -- 오픈일
  -- ── 연동 ──
  tech_pack_id UUID REFERENCES tech_packs(id) ON DELETE SET NULL, -- 작업지시서·샘플디자인
  quote_id     UUID REFERENCES quotes(id)     ON DELETE SET NULL, -- 견적
  sort         INT  NOT NULL DEFAULT 0,
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pitem_season ON product_items(product_id);
CREATE INDEX IF NOT EXISTS idx_pitem_brand  ON product_items(brand_id);
CREATE INDEX IF NOT EXISTS idx_pitem_vendor ON product_items(vendor_id);
CREATE INDEX IF NOT EXISTS idx_pitem_tp     ON product_items(tech_pack_id);

DROP TRIGGER IF EXISTS product_items_updated_at ON product_items;
CREATE TRIGGER product_items_updated_at BEFORE UPDATE ON product_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 거꾸로도 찾을 수 있게 — 작업지시서/견적/생산작업에서 제품 줄로
ALTER TABLE tech_packs  ADD COLUMN IF NOT EXISTS item_id UUID REFERENCES product_items(id) ON DELETE SET NULL;
ALTER TABLE quotes      ADD COLUMN IF NOT EXISTS item_id UUID REFERENCES product_items(id) ON DELETE SET NULL;
ALTER TABLE vendor_jobs ADD COLUMN IF NOT EXISTS item_id UUID REFERENCES product_items(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tp_item  ON tech_packs(item_id);
CREATE INDEX IF NOT EXISTS idx_q_item   ON quotes(item_id);
CREATE INDEX IF NOT EXISTS idx_vj_item  ON vendor_jobs(item_id);

-- RLS — 브랜드 권한 + 시즌(프로젝트) 담당자 권한을 모두 따른다
ALTER TABLE product_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pitem_select ON product_items;
DROP POLICY IF EXISTS pitem_write  ON product_items;
DROP POLICY IF EXISTS pitem_update ON product_items;
DROP POLICY IF EXISTS pitem_delete ON product_items;

CREATE POLICY pitem_select ON product_items FOR SELECT TO authenticated
  USING (
    (brand_id IS NULL OR can_access_brand(brand_id))
    AND (product_id IS NULL OR can_access_project(product_id))
  );
CREATE POLICY pitem_write ON product_items FOR INSERT TO authenticated
  WITH CHECK (brand_id IS NULL OR can_access_brand(brand_id));
CREATE POLICY pitem_update ON product_items FOR UPDATE TO authenticated
  USING (brand_id IS NULL OR can_access_brand(brand_id))
  WITH CHECK (brand_id IS NULL OR can_access_brand(brand_id));
CREATE POLICY pitem_delete ON product_items FOR DELETE TO authenticated
  USING (get_user_role() = 'MASTER' OR (brand_id IS NULL OR can_access_brand(brand_id)));

SELECT 'product_items + tech_packs/quotes/vendor_jobs.item_id installed' AS status;
