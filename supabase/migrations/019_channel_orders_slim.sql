-- ============================================================
--  매출/분석 전용 경량 뷰
--  channel_orders.raw(jsonb)는 주문당 ~13KB(카페24 원본 전체) → 전체기간 전량 로드 시
--  수십~수백MB가 브라우저로 내려와 매출탭이 멈춘다.
--  집계가 실제로 쓰는 raw 필드만 같은 모양(shape)으로 재구성해 내려준다.
--   · raw.shipping_status                → _orderState()
--   · raw.items[].status / order_status   → _orderState() 클레임코드(C/R/E)
--   · raw.items[].uitem / qty            → 옵션 분석 카드(eland)
--   · raw.return_reason / cancelReason    → 반품사유 카드
--  security_invoker=true : 호출자 권한으로 실행 → channel_orders RLS 그대로 적용됨.
-- ============================================================
create or replace view channel_orders_slim
with (security_invoker = true) as
select
  o.id, o.channel, o.mall_key, o.order_id, o.order_date, o.buyer_name,
  o.receiver_name, o.pay_amount, o.channel_status, o.status,
  o.courier, o.invoice_no, o.shipped_at, o.collected_at,
  jsonb_build_object(
    'shipping_status', o.raw ->> 'shipping_status',
    'return_reason',   o.raw ->> 'return_reason',
    'cancelReason',    o.raw ->> 'cancelReason',
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'status',       it ->> 'status',
               'order_status', it ->> 'order_status',
               'uitem',        it ->> 'uitem',
               'qty',          it ->> 'qty'))
      from jsonb_array_elements(coalesce(o.raw -> 'items', '[]'::jsonb)) it
    ), '[]'::jsonb)
  ) as raw
from channel_orders o;

grant select on channel_orders_slim to authenticated, anon;
