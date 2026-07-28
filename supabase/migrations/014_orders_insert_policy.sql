-- ============================================
-- channel_orders / items : MASTER·STAFF 삽입 허용
-- (봇은 service_role로 RLS 우회하지만, 브라우저/수동 삽입·시딩엔 INSERT 정책이 필요)
-- 기존: SELECT(인증), UPDATE(MASTER/STAFF)만 있었고 INSERT 정책 부재 → 유저 삽입 전면 차단됐음
-- ============================================
DROP POLICY IF EXISTS "orders_insert" ON channel_orders;
CREATE POLICY "orders_insert" ON channel_orders
  FOR INSERT WITH CHECK (get_user_role() IN ('MASTER','STAFF'));

DROP POLICY IF EXISTS "order_items_insert" ON channel_order_items;
CREATE POLICY "order_items_insert" ON channel_order_items
  FOR INSERT WITH CHECK (get_user_role() IN ('MASTER','STAFF'));
