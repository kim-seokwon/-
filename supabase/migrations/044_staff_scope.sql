-- ============================================
-- 직원 계정을 줘도 되게 — 권한 밖 자료를 막는다
--
-- 2026-10-01 실측: 브랜드 권한을 하나도 안 준 STAFF 가
--   CS 323건 · 지출 429건(법인카드) · 시즌 7 · 메모 105 를 전부 보고 있었다.
--   cs_tickets·expenses 의 SELECT 정책이 'true' 였고, products 는 STAFF 면 무조건 통과였다.
--
-- 지금 계정 3명은 전부 MASTER 라 보이는 건 달라지지 않는다.
-- ============================================

-- ── 지출: 경영 정보다. MASTER 와 본인이 올린 것만 ──
DROP POLICY IF EXISTS exp_select ON expenses;
CREATE POLICY exp_select ON expenses FOR SELECT TO authenticated
  USING (get_user_role() = 'MASTER' OR created_by = current_username());

-- ── CS: 그 브랜드를 볼 수 있는 사람만 (브랜드 없는 건은 로그인한 사람 모두) ──
DROP POLICY IF EXISTS cs_select ON cs_tickets;
CREATE POLICY cs_select ON cs_tickets FOR SELECT TO authenticated
  USING (brand_id IS NULL OR can_access_brand(brand_id));

-- ── 시즌: 브랜드가 붙어 있으면 그 브랜드 권한을 따른다 ──
--    (브랜드를 안 붙인 시즌은 업무의 뼈대라 모두 볼 수 있게 둔다)
DROP POLICY IF EXISTS products_select ON products;
CREATE POLICY products_select ON products FOR SELECT TO authenticated
  USING (
    get_user_role() = 'MASTER'
    OR brand_id IS NULL
    OR can_access_brand(brand_id)
    OR company_id::text = get_user_company_id()
  );

SELECT '직원 권한 범위 좁힘 — 지출·CS·시즌' AS status;
