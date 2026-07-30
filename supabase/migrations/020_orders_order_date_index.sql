-- 매출/분석은 전체기간을 order_date DESC 로 페이지네이션(1000행씩)해서 읽는다.
-- 기존 인덱스는 (status, order_date DESC)뿐이라 status 조건 없는 정렬엔 안 쓰임 → 매 페이지 전체 정렬.
-- 주문이 1.2만건을 넘어섰으므로 order_date 단독 인덱스를 추가한다.
create index if not exists idx_orders_order_date on channel_orders (order_date desc);
