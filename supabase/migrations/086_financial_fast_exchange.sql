-- 086 대시보드 운영검수 반려 A3·A4 (10-19 코덱스 운영검수: .work/대시보드-운영검수.md)
--
-- A3. dashboard_financial_daily 가 운영에서 5.5~9.2초 · 날짜범위는 57014 timeout.
--   원인(EXPLAIN ANALYZE 10-19, 읽기전용): channel_orders 14,741행 전부에서 raw(jsonb, 평균 3.6KB TOAST)를
--   행마다 4번 풀어 본다(initial_order_amount · paid · items×2 jsonb_array_elements). shared hit 351,988 · 9,219ms 중 9,121ms가 이 스캔.
--   → 뷰가 쓰는 판정 4개를 칸으로 빼 두고 트리거로 유지한다(066 op_status 와 같은 방식). 뷰는 raw 를 안 읽는다.
--   생성열이 아니라 트리거인 이유(066과 같음): 규칙을 나중에 바꿀 수 있게.
--
-- A4. 10월 홈 1,134건 vs 정산 sales_daily 1,113건(10-19 재조회) — 차이 21 = 교환.
--   홈은 D1 규칙(교환 포함, 취소·반품만 제외 — main.js _countsAsOrder). sales_daily 는 교환까지 뺐다(021).
--   → sales_daily 를 D1 규칙으로. 칸 구성은 그대로.
--
-- 기존 grant 는 create or replace view 가 그대로 둔다(익명 차단 상태 유지 — 여기서 grant 를 새로 주지 않는다).
-- 되돌리기: supabase/rollbacks/086_financial_fast_exchange.down.sql

-- 1) 판정 함수 — 084 뷰 본문을 그대로 옮긴 것
create or replace function public.order_fin_amount(p_order_amount numeric, p_raw jsonb)
returns numeric language sql immutable parallel safe as $$
  select case when jsonb_typeof(p_raw->'initial_order_amount') = 'object'
              then coalesce((p_raw->'initial_order_amount'->>'payment_amount')::numeric, 0)
                 + coalesce((p_raw->'initial_order_amount'->>'total_amount_due')::numeric, 0)
              else p_order_amount end
$$;

create or replace function public.order_items_any_status(p_raw jsonb, p_like text)
returns boolean language sql immutable parallel safe as $$
  select exists (select 1 from jsonb_array_elements(
                   case when jsonb_typeof(p_raw->'items') = 'array' then p_raw->'items' else '[]'::jsonb end) i
                 where i->>'order_status' like p_like)
$$;
revoke all on function public.order_fin_amount(numeric, jsonb) from public, anon;
revoke all on function public.order_items_any_status(jsonb, text) from public, anon;
grant execute on function public.order_fin_amount(numeric, jsonb) to authenticated, service_role;
grant execute on function public.order_items_any_status(jsonb, text) to authenticated, service_role;

-- 2) 칸 + 트리거 (기본값 없는 add column 은 메타데이터만 바뀐다 — 표 재작성 없음)
alter table channel_orders add column if not exists fin_order_amount numeric;
alter table channel_orders add column if not exists fin_unpaid boolean;
alter table channel_orders add column if not exists fin_is_return boolean;
alter table channel_orders add column if not exists fin_return_done boolean;

create or replace function public.channel_orders_set_fin() returns trigger
language plpgsql as $$
begin
  new.fin_order_amount := public.order_fin_amount(new.order_amount, new.raw);
  new.fin_unpaid       := coalesce(new.raw->>'paid', '') = 'F';
  new.fin_is_return    := coalesce(new.channel_status, '') like 'R%' or public.order_items_any_status(new.raw, 'R%');
  new.fin_return_done  := public.order_items_any_status(new.raw, 'R40');
  return new;
end $$;

drop trigger if exists trg_channel_orders_fin on channel_orders;
create trigger trg_channel_orders_fin
  before insert or update of raw, channel_status, order_amount on channel_orders
  for each row execute function public.channel_orders_set_fin();

-- 3) 기존 행 백필 — 2천건씩(락 짧게). fin_* 만 바꾸므로 op_status·fin 트리거는 안 돈다.
do $$
declare n int;
begin
  loop
    update channel_orders o set
      fin_order_amount = public.order_fin_amount(o.order_amount, o.raw),
      fin_unpaid       = coalesce(o.raw->>'paid', '') = 'F',
      fin_is_return    = coalesce(o.channel_status, '') like 'R%' or public.order_items_any_status(o.raw, 'R%'),
      fin_return_done  = public.order_items_any_status(o.raw, 'R40')
     where o.id in (select id from channel_orders where fin_unpaid is null limit 2000);
    get diagnostics n = row_count;
    exit when n = 0;
  end loop;
end $$;

-- 4) 뷰 — 084 와 칸·순서·계산 동일, base 만 칸에서 읽는다
create or replace view dashboard_financial_daily
with (security_invoker = true) as
with base as (
  select c.order_date, c.refunded_at, c.actual_paid_amount, c.refund_amount,
         c.fin_order_amount as order_amount,
         coalesce(c.fin_unpaid, false) as is_unpaid,
         coalesce(c.fin_is_return, false) as is_return,
         coalesce(c.fin_return_done, false) as return_done
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

-- 5) A4 — 일별 매출·건수도 D1 규칙(교환 포함, 취소·반품만 제외)
create or replace view sales_daily
with (security_invoker = true) as
select brand_name, brand_id,
       (order_date at time zone 'Asia/Seoul')::date as d,
       sum(coalesce(pay_amount, 0))::numeric as amt,
       count(*)::int as cnt
from order_facts
where order_date is not null and pay_amount is not null
  and state not in ('cancel', 'return')
group by 1, 2, 3;

notify pgrst, 'reload schema';
