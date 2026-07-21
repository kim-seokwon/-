-- ============================================
-- 거래처(동대문 봉제·원단·부자재 등) + 거래처 물품 현황
-- Supabase Dashboard → SQL Editor에서 실행 (001~006 이후)
-- 신규 테이블만 추가. 기존 무변경. RLS는 기존 get_user_role() 헬퍼 사용.
-- 세금계산서(팝빌) 발행 시 거래처 정보(biz_no 등) 소스로도 사용.
-- ============================================

-- 1. vendors : 거래처
CREATE TABLE IF NOT EXISTS vendors (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,                    -- 상호
  category    TEXT NOT NULL DEFAULT '기타',      -- 봉제/원단/부자재/프린트/기타
  biz_no      TEXT,                             -- 사업자등록번호(세금계산서용)
  ceo_name    TEXT,                             -- 대표자
  phone       TEXT,
  address     TEXT,                             -- 주소(대부분 동대문)
  lat         DOUBLE PRECISION,                 -- 지도 좌표
  lng         DOUBLE PRECISION,
  email       TEXT,
  memo        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. vendor_jobs : 거래처 물품 현황(진행중 작업 + 스케줄)
CREATE TABLE IF NOT EXISTS vendor_jobs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id   UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,                    -- 품목/작업명
  stage       TEXT NOT NULL DEFAULT '진행중',    -- 원단/재단/봉제/디테일/완료 등(자유)
  qty         INT,
  due_date    DATE,                             -- 스케줄(마감/납기)
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','done')),
  memo        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendor_jobs_vendor ON vendor_jobs(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_jobs_due    ON vendor_jobs(due_date);

-- updated_at 트리거(기존 함수 재사용 가정, 없으면 생성)
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS vendors_updated_at ON vendors;
CREATE TRIGGER vendors_updated_at BEFORE UPDATE ON vendors
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================
-- RLS (로그인 사용자 조회, MASTER/STAFF 쓰기 — 기존 패턴과 동일)
-- ============================================
ALTER TABLE vendors     ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vendors_select" ON vendors;
DROP POLICY IF EXISTS "vendors_write"  ON vendors;
DROP POLICY IF EXISTS "vendors_update" ON vendors;
DROP POLICY IF EXISTS "vendors_delete" ON vendors;
CREATE POLICY "vendors_select" ON vendors FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "vendors_write"  ON vendors FOR INSERT WITH CHECK (get_user_role() IN ('MASTER','STAFF'));
CREATE POLICY "vendors_update" ON vendors FOR UPDATE USING (get_user_role() IN ('MASTER','STAFF'));
CREATE POLICY "vendors_delete" ON vendors FOR DELETE USING (get_user_role() = 'MASTER');

DROP POLICY IF EXISTS "vjobs_select" ON vendor_jobs;
DROP POLICY IF EXISTS "vjobs_write"  ON vendor_jobs;
DROP POLICY IF EXISTS "vjobs_update" ON vendor_jobs;
DROP POLICY IF EXISTS "vjobs_delete" ON vendor_jobs;
CREATE POLICY "vjobs_select" ON vendor_jobs FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "vjobs_write"  ON vendor_jobs FOR INSERT WITH CHECK (get_user_role() IN ('MASTER','STAFF'));
CREATE POLICY "vjobs_update" ON vendor_jobs FOR UPDATE USING (get_user_role() IN ('MASTER','STAFF'));
CREATE POLICY "vjobs_delete" ON vendor_jobs FOR DELETE USING (get_user_role() IN ('MASTER','STAFF'));

SELECT 'vendors schema installed' AS status;
