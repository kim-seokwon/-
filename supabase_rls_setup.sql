-- ============================================
-- BHAS Supabase RLS (Row Level Security) 설정
-- Supabase Dashboard → SQL Editor에서 실행하세요
-- ============================================

-- 1. 모든 테이블 RLS 활성화
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE todos ENABLE ROW LEVEL SECURITY;
ALTER TABLE photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE memos ENABLE ROW LEVEL SECURITY;
ALTER TABLE history ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE global_documents ENABLE ROW LEVEL SECURITY;

-- 2. 기존 정책 삭제 (충돌 방지)
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN (SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public') LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.policyname, r.tablename);
    END LOOP;
END $$;

-- ============================================
-- 헬퍼 함수: 현재 유저의 role 조회
-- ============================================
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT AS $$
  SELECT role FROM companies WHERE username = split_part(auth.jwt()->>'email', '@', 1)
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION get_user_brand_id()
RETURNS UUID AS $$
  SELECT brand_id FROM companies WHERE username = split_part(auth.jwt()->>'email', '@', 1)
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION get_user_company_id()
RETURNS UUID AS $$
  SELECT id FROM companies WHERE username = split_part(auth.jwt()->>'email', '@', 1)
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================
-- products: 프로젝트
-- ============================================
-- 읽기: MASTER/STAFF=전체, CLIENT=본인 브랜드만
CREATE POLICY "products_select" ON products FOR SELECT USING (
  get_user_role() IN ('MASTER', 'STAFF')
  OR brand_id = get_user_brand_id()
  OR company_id = get_user_company_id()
);

-- 생성: 인증된 사용자
CREATE POLICY "products_insert" ON products FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- 수정: MASTER/STAFF만
CREATE POLICY "products_update" ON products FOR UPDATE USING (
  get_user_role() IN ('MASTER', 'STAFF')
);

-- 삭제: MASTER/STAFF만
CREATE POLICY "products_delete" ON products FOR DELETE USING (
  get_user_role() IN ('MASTER', 'STAFF')
);

-- ============================================
-- todos: 할 일
-- ============================================
CREATE POLICY "todos_select" ON todos FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "todos_insert" ON todos FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "todos_update" ON todos FOR UPDATE USING (auth.uid() IS NOT NULL);

-- 삭제: MASTER/STAFF=전체, CLIENT=본인 생성만
CREATE POLICY "todos_delete" ON todos FOR DELETE USING (
  get_user_role() IN ('MASTER', 'STAFF')
  OR created_by = get_user_company_id()::text
);

-- ============================================
-- photos: 사진
-- ============================================
CREATE POLICY "photos_select" ON photos FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "photos_insert" ON photos FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "photos_delete" ON photos FOR DELETE USING (
  get_user_role() IN ('MASTER', 'STAFF')
  OR created_by = auth.uid()::text
);

-- ============================================
-- documents: 문서
-- ============================================
CREATE POLICY "documents_select" ON documents FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "documents_insert" ON documents FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "documents_delete" ON documents FOR DELETE USING (
  get_user_role() IN ('MASTER', 'STAFF')
  OR created_by = get_user_company_id()::text
);

-- ============================================
-- product_stages: 공정 상태
-- ============================================
CREATE POLICY "stages_select" ON product_stages FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "stages_upsert" ON product_stages FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "stages_update" ON product_stages FOR UPDATE USING (auth.uid() IS NOT NULL);

-- ============================================
-- memos: 메모
-- ============================================
CREATE POLICY "memos_select" ON memos FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "memos_insert" ON memos FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "memos_delete" ON memos FOR DELETE USING (
  get_user_role() IN ('MASTER', 'STAFF')
  OR created_by = get_user_company_id()::text
);

-- ============================================
-- history: 이력
-- ============================================
CREATE POLICY "history_select" ON history FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "history_insert" ON history FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================
-- companies: 계정 (MASTER만 수정/삭제)
-- ============================================
CREATE POLICY "companies_select" ON companies FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "companies_insert" ON companies FOR INSERT WITH CHECK (get_user_role() = 'MASTER');
CREATE POLICY "companies_update" ON companies FOR UPDATE USING (get_user_role() = 'MASTER');
CREATE POLICY "companies_delete" ON companies FOR DELETE USING (get_user_role() = 'MASTER');

-- ============================================
-- brands: 브랜드 (MASTER만 수정/삭제)
-- ============================================
CREATE POLICY "brands_select" ON brands FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "brands_insert" ON brands FOR INSERT WITH CHECK (get_user_role() = 'MASTER');
CREATE POLICY "brands_update" ON brands FOR UPDATE USING (get_user_role() = 'MASTER');
CREATE POLICY "brands_delete" ON brands FOR DELETE USING (get_user_role() = 'MASTER');

-- ============================================
-- global_documents: 전체 문서
-- ============================================
CREATE POLICY "gdocs_select" ON global_documents FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "gdocs_insert" ON global_documents FOR INSERT WITH CHECK (
  get_user_role() IN ('MASTER', 'STAFF')
);
CREATE POLICY "gdocs_delete" ON global_documents FOR DELETE USING (
  get_user_role() IN ('MASTER', 'STAFF')
);

-- ============================================
-- Storage: bhas 버킷 정책
-- ============================================
-- Supabase Dashboard → Storage → bhas 버킷 → Policies에서 설정:
-- SELECT: 인증된 사용자 (authenticated)
-- INSERT: 인증된 사용자 (authenticated)
-- DELETE: 인증된 사용자 (authenticated)

-- ============================================
-- 완료! 정책 확인
-- ============================================
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, cmd;
