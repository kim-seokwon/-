-- ============================================
-- 작업지시서(tech_packs) 저장 + 생산 물품 연결
-- Supabase SQL Editor에서 실행 (007_vendors.sql, 012_vendor_qc.sql 이후)
-- ============================================
CREATE TABLE IF NOT EXISTS tech_packs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    style_name  TEXT NOT NULL,
    style_no    TEXT,
    config      JSONB NOT NULL,            -- 샘플메이커 전체 스펙(치수/디테일/배치/절개/이미지)
    created_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE vendor_jobs ADD COLUMN IF NOT EXISTS tech_pack_id UUID REFERENCES tech_packs(id) ON DELETE SET NULL;

-- RLS: 로그인 사용자 접근 (기존 정책 패턴에 맞춰 필요시 조정)
ALTER TABLE tech_packs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tech_packs_all ON tech_packs;
CREATE POLICY tech_packs_all ON tech_packs FOR ALL TO authenticated USING (true) WITH CHECK (true);

SELECT 'tech_packs table + vendor_jobs.tech_pack_id installed' AS status;
