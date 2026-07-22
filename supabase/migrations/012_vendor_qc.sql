-- ============================================
-- 출고 검수(QC) + 카카오퀵 게이트 필드
-- Supabase SQL Editor에서 실행 (007_vendors.sql 이후)
-- ============================================
ALTER TABLE vendor_jobs ADD COLUMN IF NOT EXISTS qc_status    TEXT DEFAULT 'none';        -- none/pending/passed
ALTER TABLE vendor_jobs ADD COLUMN IF NOT EXISTS qc_checklist JSONB DEFAULT '[]'::jsonb;  -- [{label,checked}]
ALTER TABLE vendor_jobs ADD COLUMN IF NOT EXISTS qc_photos    JSONB DEFAULT '[]'::jsonb;  -- [dataUrl,...] 완성 사진
ALTER TABLE vendor_jobs ADD COLUMN IF NOT EXISTS quick_status JSONB;                      -- 카카오퀵 예약 결과

SELECT 'vendor_jobs QC/quick fields installed' AS status;
