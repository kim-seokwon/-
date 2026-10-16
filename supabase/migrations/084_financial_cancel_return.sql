-- 084 매출·환불 정의 (10-16 사장님 확정). 078_financial_cancel_return.sql(10-14 감독 검수, 미적용)을 바탕으로 한다.
-- 사장님 원문: "주문금액 / 매출 이 다른거고 주문금액에는 저금액이 포함되고 매출에는 포함안되면 되는거아니야? 환불은 결제,입금 후 취소건이 환불인거고"
--
--   주문금액 order_amount     = 취소 포함 최초 주문액. 카페24는 raw.initial_order_amount 의 payment_amount + total_amount_due
--                               (입금 전 주문은 payment_amount=0 이고 낼 돈이 total_amount_due 에 있다). raw 없는 몰(키디키디)은 기존 order_amount.
--   매출 net_sales_amount     = actual_paid_amount (주문일 기준). 카페24가 취소·반품분을 이미 빼서 보내므로 환불을 또 빼지 않는다(030 이중 차감 제거).
--   환불 refund_amount        = 결제·입금 후 취소 전부(배송 전 카드취소 + 반품), 환불일 기준. raw.paid='F'(입금 전)는 환불 아님.
--     내역: cancel_* = 배송 전 취소, return_* = 반품 (품목 중 R 상태가 있으면 반품 — 078 기준 그대로)
--   unpaid_order_count/amount = 입금 전 주문(raw.paid='F', 주문일 기준) — 주문금액에만 들어가고 매출·환불엔 없다.   ← 새 칸
--   gross_paid_amount         = actual_paid + refund (주문일 기준, 취소 전 결제) — 078 칸 유지.
--
-- 왜(078): actual_paid_amount 는 이미 환불이 빠진 값(2026-08~10 카페24 환불 188건 전부 actual_paid = raw.payment_amount).
-- 기존 칸 이름·순서는 그대로 두고 새 칸은 뒤에 붙인다(create or replace view 조건). 화면은 select * 로 읽는다.
-- 되돌리기: 뒤에 붙인 칸은 replace 로 못 빼므로 drop view dashboard_financial_daily 후 030 의 view 본문 + grant 실행.

-- 적용 전 대조(10-14 16시대, 운영 SELECT): .work/시즌환불/환불수정-대조.md

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

grant select on dashboard_financial_daily to authenticated, anon;
