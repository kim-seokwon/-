-- ============================================
-- 견적 고객사(거래처) 레지스트리 + 견적 특약사항 필드
-- Supabase SQL Editor에서 실행 (001~009 이후). 세금계산서 공급받는자 소스 겸용.
-- ============================================
CREATE TABLE IF NOT EXISTS clients (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,          -- 상호
  biz_no      TEXT,                   -- 사업자등록번호
  ceo         TEXT,                   -- 대표자
  contact     TEXT,                   -- 담당자
  tel         TEXT,
  email       TEXT,
  memo        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "clients_select" ON clients;
DROP POLICY IF EXISTS "clients_write"  ON clients;
CREATE POLICY "clients_select" ON clients FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "clients_write"  ON clients FOR ALL USING (get_user_role() IN ('MASTER','STAFF')) WITH CHECK (get_user_role() IN ('MASTER','STAFF'));

-- 견적에 특약사항(참고사항) 텍스트 추가 (수정 가능)
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS terms TEXT;

SELECT 'clients + quotes.terms installed' AS status;
