-- ============================================================
--  계정별 세분화 권한: 메뉴 접근 + 브랜드 접근
--  NULL = 역할(role) 기본값으로 폴백 (기존 계정 무변경, 회귀 없음)
--  menu_access : 접근 허용 메뉴 id 배열 (예: {orders,sales,inventory})
--  brand_access: 조회 허용 브랜드 id 배열 (비면 역할 기본: MASTER/STAFF=전체, CLIENT=brand_id)
-- ============================================================
ALTER TABLE companies ADD COLUMN IF NOT EXISTS menu_access  TEXT[];
ALTER TABLE companies ADD COLUMN IF NOT EXISTS brand_access UUID[];
