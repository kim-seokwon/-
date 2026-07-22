-- ============================================
-- 견적서(사업자 고객 대상 제작/판매 견적) — 엑셀 수기 대체
-- Supabase SQL Editor에서 실행 (001~007 이후)
-- 최종견적서 = 세금계산서(팝빌) 소스로도 사용.
-- ============================================
CREATE TABLE IF NOT EXISTS quotes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_no      TEXT,                              -- 견적번호(자동/수기)
  client_name   TEXT NOT NULL,                     -- 고객사 상호
  client_biz_no TEXT,                              -- 사업자등록번호(세금계산서용)
  client_ceo    TEXT,                              -- 대표자
  client_contact TEXT,                             -- 담당자
  client_tel    TEXT,
  client_email  TEXT,
  items         JSONB NOT NULL DEFAULT '[]',       -- [{name,spec,qty,price,amount}]
  supply_amount BIGINT NOT NULL DEFAULT 0,         -- 공급가액
  tax_amount    BIGINT NOT NULL DEFAULT 0,         -- 세액(10%)
  total_amount  BIGINT NOT NULL DEFAULT 0,         -- 합계
  quote_date    DATE,                              -- 견적일
  valid_until   DATE,                              -- 유효기간
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','confirmed')),
  memo          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quotes_created ON quotes(created_at DESC);

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS quotes_updated_at ON quotes;
CREATE TRIGGER quotes_updated_at BEFORE UPDATE ON quotes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "quotes_select" ON quotes;
DROP POLICY IF EXISTS "quotes_write"  ON quotes;
DROP POLICY IF EXISTS "quotes_update" ON quotes;
DROP POLICY IF EXISTS "quotes_delete" ON quotes;
CREATE POLICY "quotes_select" ON quotes FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "quotes_write"  ON quotes FOR INSERT WITH CHECK (get_user_role() IN ('MASTER','STAFF'));
CREATE POLICY "quotes_update" ON quotes FOR UPDATE USING (get_user_role() IN ('MASTER','STAFF'));
CREATE POLICY "quotes_delete" ON quotes FOR DELETE USING (get_user_role() IN ('MASTER','STAFF'));

SELECT 'quotes schema installed' AS status;
