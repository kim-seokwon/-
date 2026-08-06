-- 주문금액·실결제금액·환불금액을 분리한다.
-- pay_amount는 이전 화면 호환을 위해 유지하되, 신규 집계는 아래 3개 컬럼만 사용한다.
alter table channel_orders
  add column if not exists order_amount numeric not null default 0,
  add column if not exists actual_paid_amount numeric not null default 0,
  add column if not exists refund_amount numeric not null default 0,
  add column if not exists refunded_at timestamptz;

-- 과거 수집 건은 실제결제 확인 전까지 기존 수집금액을 실결제로만 이관한다.
-- 상태만 보고 환불액을 추정하지 않는다(부분환불 오집계를 막기 위함).
update channel_orders
set order_amount = case when order_amount = 0 then coalesce(pay_amount, 0) else order_amount end,
    actual_paid_amount = case when actual_paid_amount = 0 then coalesce(pay_amount, 0) else actual_paid_amount end
where order_amount = 0 or actual_paid_amount = 0;

-- 주문일 기준: 주문금액과 결제금액. 환불은 실제 환불 처리일 기준으로 별도 집계한다.
create or replace view dashboard_financial_daily
with (security_invoker = true) as
with order_daily as (
  select (order_date at time zone 'Asia/Seoul')::date as d,
         sum(order_amount)::numeric as order_amount,
         sum(actual_paid_amount)::numeric as actual_paid_amount,
         count(*)::int as order_count
  from channel_orders
  where order_date is not null
  group by 1
), refund_daily as (
  select (coalesce(refunded_at, order_date) at time zone 'Asia/Seoul')::date as d,
         sum(refund_amount)::numeric as refund_amount,
         count(*) filter (where refund_amount > 0)::int as refund_count
  from channel_orders
  where refund_amount > 0 and coalesce(refunded_at, order_date) is not null
  group by 1
), dates as (
  select d from order_daily union select d from refund_daily
)
select dates.d,
       coalesce(o.order_amount, 0)::numeric as order_amount,
       coalesce(o.actual_paid_amount, 0)::numeric as actual_paid_amount,
       coalesce(r.refund_amount, 0)::numeric as refund_amount,
       (coalesce(o.actual_paid_amount, 0) - coalesce(r.refund_amount, 0))::numeric as net_sales_amount,
       coalesce(o.order_count, 0)::int as order_count,
       coalesce(r.refund_count, 0)::int as refund_count
from dates
left join order_daily o using (d)
left join refund_daily r using (d);

grant select on dashboard_financial_daily to authenticated, anon;
