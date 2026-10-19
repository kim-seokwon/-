-- 086 되돌리기: 뷰를 084·021 본문으로 되돌린 뒤 트리거·함수·칸을 지운다. (뷰가 칸을 참조하므로 뷰 먼저)
-- 되돌리면 A3 속도·A4 교환 포함이 다시 원래대로(느림·교환 제외)가 된다.

create or replace view dashboard_financial_daily
with (security_invoker = true) as
with base as (
  select c.order_date, c.refunded_at, c.actual_paid_amount, c.refund_amount,
         case when jsonb_typeof(c.raw->'initial_order_amount') = 'object'
              then coalesce((c.raw->'initial_order_amount'->>'payment_amount')::numeric, 0)
                 + coalesce((c.raw->'initial_order_amount'->>'total_amount_due')::numeric, 0)
              else c.order_amount end as order_amount,
         coalesce(c.raw->>'paid', '') = 'F' as is_unpaid,
         (coalesce(c.channel_status, '') like 'R%'
           or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(c.raw->'items') = 'array' then c.raw->'items' else '[]'::jsonb end) i
                      where i->>'order_status' like 'R%')) as is_return,
         exists (select 1 from jsonb_array_elements(case when jsonb_typeof(c.raw->'items') = 'array' then c.raw->'items' else '[]'::jsonb end) i
                 where i->>'order_status' = 'R40') as return_done
  from channel_orders c
), order_daily as (
  select (order_date at time zone 'Asia/Seoul')::date as d,
         sum(order_amount)::numeric as order_amount,
         sum(actual_paid_amount)::numeric as actual_paid_amount,
         sum(actual_paid_amount + refund_amount)::numeric as gross_paid_amount,
         count(*)::int as order_count,
         count(*) filter (where is_unpaid)::int as unpaid_order_count,
         coalesce(sum(order_amount) filter (where is_unpaid), 0)::numeric as unpaid_order_amount
  from base
  where order_date is not null
  group by 1
), refund_daily as (
  select (coalesce(refunded_at, order_date) at time zone 'Asia/Seoul')::date as d,
         sum(refund_amount)::numeric as refund_amount,
         count(*)::int as refund_count,
         coalesce(sum(refund_amount) filter (where not is_return), 0)::numeric as cancel_amount,
         count(*) filter (where not is_return)::int as cancel_count,
         coalesce(sum(refund_amount) filter (where is_return), 0)::numeric as return_refund_amount,
         count(*) filter (where is_return)::int as return_count,
         count(*) filter (where is_return and not return_done)::int as return_pending_count
  from base
  where refund_amount > 0 and not is_unpaid and coalesce(refunded_at, order_date) is not null
  group by 1
), dates as (
  select d from order_daily union select d from refund_daily
)
select dates.d,
       coalesce(o.order_amount, 0)::numeric as order_amount,
       coalesce(o.actual_paid_amount, 0)::numeric as actual_paid_amount,
       coalesce(r.refund_amount, 0)::numeric as refund_amount,
       coalesce(o.actual_paid_amount, 0)::numeric as net_sales_amount,
       coalesce(o.order_count, 0)::int as order_count,
       coalesce(r.refund_count, 0)::int as refund_count,
       coalesce(o.gross_paid_amount, 0)::numeric as gross_paid_amount,
       coalesce(r.cancel_amount, 0)::numeric as cancel_amount,
       coalesce(r.cancel_count, 0)::int as cancel_count,
       coalesce(r.return_refund_amount, 0)::numeric as return_refund_amount,
       coalesce(r.return_count, 0)::int as return_count,
       coalesce(r.return_pending_count, 0)::int as return_pending_count,
       coalesce(o.unpaid_order_count, 0)::int as unpaid_order_count,
       coalesce(o.unpaid_order_amount, 0)::numeric as unpaid_order_amount
from dates
left join order_daily o using (d)
left join refund_daily r using (d);

create or replace view sales_daily
with (security_invoker = true) as
select brand_name, brand_id,
       (order_date at time zone 'Asia/Seoul')::date as d,
       sum(coalesce(pay_amount, 0))::numeric as amt,
       count(*)::int as cnt
from order_facts
where order_date is not null and pay_amount is not null
  and state not in ('cancel', 'return', 'exchange')
group by 1, 2, 3;

drop trigger if exists trg_channel_orders_fin on channel_orders;
drop function if exists public.channel_orders_set_fin();
alter table channel_orders drop column if exists fin_order_amount,
  drop column if exists fin_unpaid, drop column if exists fin_is_return, drop column if exists fin_return_done;
drop function if exists public.order_fin_amount(numeric, jsonb);
drop function if exists public.order_items_any_status(jsonb, text);

notify pgrst, 'reload schema';
