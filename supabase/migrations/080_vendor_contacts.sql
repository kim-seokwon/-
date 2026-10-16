-- 연락처 분류를 하나의 테이블로 관리하고, vendors를 연락처로도 쓸 수 있게 확장한다.
-- 배포/적용은 별도 승인 후 수행한다.

CREATE TABLE IF NOT EXISTS vendor_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
  color TEXT NOT NULL DEFAULT '#64748b',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO vendor_categories (name, color, sort_order) VALUES
  ('봉제', '#3b82f6', 10),
  ('원단', '#8b5cf6', 20),
  ('부자재', '#f59e0b', 30),
  ('프린트', '#10b981', 40),
  ('기타', '#64748b', 9990)
ON CONFLICT (name) DO NOTHING;

-- 기존에 사용자가 직접 입력한 분류도 버리지 않는다.
INSERT INTO vendor_categories (name, color, sort_order)
SELECT name, '#64748b', 100 + row_number() OVER (ORDER BY name) * 10
FROM (
  SELECT DISTINCT trim(category) AS name
  FROM vendors
  WHERE nullif(trim(category), '') IS NOT NULL
) existing_categories
ON CONFLICT (name) DO NOTHING;

UPDATE vendors SET category = '기타' WHERE nullif(trim(category), '') IS NULL;
UPDATE vendors SET category = trim(category) WHERE category IS DISTINCT FROM trim(category);

ALTER TABLE vendors ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT '거래중';
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS contact_name TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS fax TEXT;

DO $$ BEGIN
  ALTER TABLE vendors ADD CONSTRAINT vendors_status_check
    CHECK (status IN ('거래중', '보류', '거래중단'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE vendors ADD CONSTRAINT vendors_category_fk
    FOREIGN KEY (category) REFERENCES vendor_categories(name)
    ON UPDATE CASCADE ON DELETE SET DEFAULT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_vendors_status ON vendors(status);
CREATE INDEX IF NOT EXISTS idx_vendor_categories_sort ON vendor_categories(sort_order, name);

DROP TRIGGER IF EXISTS vendor_categories_updated_at ON vendor_categories;
CREATE TRIGGER vendor_categories_updated_at BEFORE UPDATE ON vendor_categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE vendor_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "vendor_categories_select" ON vendor_categories;
DROP POLICY IF EXISTS "vendor_categories_insert" ON vendor_categories;
DROP POLICY IF EXISTS "vendor_categories_update" ON vendor_categories;
DROP POLICY IF EXISTS "vendor_categories_delete" ON vendor_categories;
CREATE POLICY "vendor_categories_select" ON vendor_categories FOR SELECT TO authenticated
  USING (get_user_role() IN ('MASTER', 'STAFF'));
CREATE POLICY "vendor_categories_insert" ON vendor_categories FOR INSERT TO authenticated
  WITH CHECK (get_user_role() IN ('MASTER', 'STAFF'));
CREATE POLICY "vendor_categories_update" ON vendor_categories FOR UPDATE TO authenticated
  USING (get_user_role() IN ('MASTER', 'STAFF') AND name <> '기타')
  WITH CHECK (get_user_role() IN ('MASTER', 'STAFF') AND name <> '기타');
CREATE POLICY "vendor_categories_delete" ON vendor_categories FOR DELETE TO authenticated
  USING (get_user_role() IN ('MASTER', 'STAFF') AND name <> '기타');
