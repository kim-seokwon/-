-- 운영 전환 보안 잠금
-- STAFF는 명시적으로 배정된 브랜드만 볼 수 있으며, 삭제는 MASTER로 제한한다.

-- 구버전에서 단일 브랜드가 이미 지정된 직원은 그 브랜드를 그대로 승계한다.
-- 브랜드가 아예 비어 있던 직원은 권한을 새로 배정받기 전까지 데이터를 볼 수 없다.
UPDATE companies
SET brand_access = ARRAY[brand_id]
WHERE role = 'STAFF'
  AND (brand_access IS NULL OR cardinality(brand_access) = 0)
  AND brand_id IS NOT NULL;

CREATE OR REPLACE FUNCTION can_access_brand(p_brand_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public AS $$
DECLARE p companies%ROWTYPE;
BEGIN
  SELECT * INTO p FROM companies
   WHERE username=split_part(auth.jwt()->>'email','@',1) LIMIT 1;
  IF p.id IS NULL THEN RETURN FALSE; END IF;
  IF p.role='MASTER' THEN RETURN TRUE; END IF;
  IF p.role='STAFF' THEN
    -- 빈 브랜드 권한을 전체 권한으로 해석하지 않는다.
    RETURN p.brand_access IS NOT NULL AND p_brand_id=ANY(p.brand_access);
  END IF;
  RETURN p_brand_id IS NOT NULL AND (
    p_brand_id=p.brand_id OR
    (p.brand_access IS NOT NULL AND p_brand_id=ANY(p.brand_access))
  );
END;
$$;

-- 실수로 업무 이력 전체가 사라지는 것을 방지: 삭제는 마스터만.
DROP POLICY IF EXISTS pages_delete ON pages;
CREATE POLICY pages_delete ON pages FOR DELETE USING (get_user_role()='MASTER');
DROP POLICY IF EXISTS cards_delete ON board_cards;
CREATE POLICY cards_delete ON board_cards FOR DELETE USING (get_user_role()='MASTER');
DROP POLICY IF EXISTS quotes_delete ON quotes;
CREATE POLICY quotes_delete ON quotes FOR DELETE USING (get_user_role()='MASTER');
DROP POLICY IF EXISTS vjobs_delete ON vendor_jobs;
CREATE POLICY vjobs_delete ON vendor_jobs FOR DELETE USING (get_user_role()='MASTER');
DROP POLICY IF EXISTS channel_listings_delete ON channel_listings;
CREATE POLICY channel_listings_delete ON channel_listings FOR DELETE USING (get_user_role()='MASTER');

-- 감사 로그는 append-only. 일반 로그인 역할에 수정/삭제 권한을 부여하지 않는다.
REVOKE ALL ON operation_audit FROM anon, authenticated;
GRANT SELECT ON operation_audit TO authenticated;

SELECT 'production security lockdown installed' AS status;
