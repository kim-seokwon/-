-- ============================================
-- 견적 → 세금계산서(팝빌) 연동 필드
-- Supabase SQL Editor에서 실행 (001~010 이후)
-- ============================================
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS tax_status      TEXT DEFAULT 'none';   -- none/issued/failed
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS tax_mgtkey      TEXT;                  -- 팝빌 문서관리번호
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS tax_supply_date DATE;                  -- 작성일자(=공급일)
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS tax_issued_at   TIMESTAMPTZ;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS email TEXT;                            -- (이미 있으면 무시)

SELECT 'quote tax fields installed' AS status;
