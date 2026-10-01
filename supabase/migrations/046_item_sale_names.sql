-- ============================================
-- 제품리스트의 이름은 약식(ST하렘팬츠)인데, 손님이 보는 최종 상품명은
-- 카페24에 올라간 이름(예: [PRE-ORDER] Merino Wool Vest)이다.
-- 한 제품이 여러 이름으로 팔리기도 한다(선주문판 · 일반판).
-- 그래서 '판매명' 을 여러 개 담을 수 있게 둔다.
-- ============================================
ALTER TABLE product_items ADD COLUMN IF NOT EXISTS sale_names TEXT[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_pitem_sale ON product_items USING GIN (sale_names);

SELECT '제품리스트 판매명 칸 추가됨' AS status;
