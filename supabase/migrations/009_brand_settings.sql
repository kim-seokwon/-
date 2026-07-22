-- ============================================
-- 브랜드별 설정 (택배사 등) — 연동 표에서 브랜드마다 택배사 지정
-- Supabase SQL Editor에서 실행 (001~008 이후)
-- ============================================
CREATE TABLE IF NOT EXISTS brand_settings (
  brand_id   UUID PRIMARY KEY,                 -- brands.id
  courier    TEXT NOT NULL DEFAULT '우체국',    -- 우체국/CJ대한통운/한진택배/롯데택배/로젠택배/기타
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE brand_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bset_select" ON brand_settings;
DROP POLICY IF EXISTS "bset_write"  ON brand_settings;
CREATE POLICY "bset_select" ON brand_settings FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "bset_write"  ON brand_settings FOR ALL USING (get_user_role() IN ('MASTER','STAFF')) WITH CHECK (get_user_role() IN ('MASTER','STAFF'));

SELECT 'brand_settings schema installed' AS status;
