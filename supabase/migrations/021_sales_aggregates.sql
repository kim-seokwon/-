-- ============================================================
--  매출 집계를 서버로 이관
--  기존: 주문 12,000건을 브라우저로 전부 내려(6MB) JS에서 집계 → 폰에서 20~30초.
--  변경: 상태 판정·브랜드/채널 매핑·집계를 전부 SQL에서 하고 결과만 내려준다(수십~수백 KB).
--
--  order_facts  : 주문 1건 = 1행. _orderState()의 판정 규칙을 SQL로 그대로 옮긴 것.
--  sales_monthly / sales_daily / sales_channel_monthly / order_state_totals : 위를 집계한 것.
--  전부 security_invoker=true → channel_orders RLS 그대로 적용됨.
-- ============================================================

-- 주문 1건의 파생 사실(브랜드·플랫폼·상태). 프론트 _orderState()와 동일한 우선순위:
--   아이템 클레임코드(C취소/R반품/E교환) > 배송상태(F/M/T) > 아이템 N코드
create or replace view order_facts
with (security_invoker = true) as
select
  o.id, o.mall_key, o.channel, o.order_date, o.pay_amount,
  o.buyer_name, o.receiver_name, o.status, o.shipped_at,
  m.brand_id,
  coalesce(b.name, m.label, o.mall_key, o.channel, '기타') as brand_name,
  case
    when coalesce(o.channel, 'cafe24') = 'cafe24' then 'cafe24'
    when lower(o.mall_key) in ('kidikidi', 'musinsa', '29cm', 'smartstore') then lower(o.mall_key)
    when o.channel = 'eland' then 'kidikidi'
    when o.channel = 'naver' then 'smartstore'
    else coalesce(lower(o.mall_key), o.channel, 'cafe24')
  end as platform,
  case
    when coalesce(o.channel, 'cafe24') <> 'cafe24' then
      case
        when o.channel_status like '2%' then 'cancel'
        when o.channel_status like '3%' then 'return'
        when o.channel_status like '4%' then 'exchange'
        else 'done'
      end
    else (
      select case
        when bool_or(c like 'C%') then 'cancel'
        when bool_or(c like 'R%') then 'return'
        when bool_or(c like 'E%') then 'exchange'
        when o.raw ->> 'shipping_status' = 'T' then 'done'
        when o.raw ->> 'shipping_status' = 'M' then 'shipping'
        when o.raw ->> 'shipping_status' = 'F' then 'pre'
        when bool_or(c ~ '^N[45]') then 'done'
        when bool_or(c like 'N3%') then 'shipping'
        else 'pre'
      end
      from (
        select upper(coalesce(it ->> 'status', it ->> 'order_status', '')) as c
        from jsonb_array_elements(coalesce(o.raw -> 'items', '[]'::jsonb)) it
      ) codes
    )
  end as state
from channel_orders o
left join malls m on m.mall_key = o.mall_key
left join brands b on b.id = m.brand_id;

-- 브랜드 × 월 × 상태 (KPI·브랜드카드·브랜드×월 매트릭스·전월대비)
create or replace view sales_monthly
with (security_invoker = true) as
select brand_name, brand_id,
       to_char(order_date at time zone 'Asia/Seoul', 'YYYY-MM') as ym,
       state,
       sum(coalesce(pay_amount, 0))::numeric as amt,
       count(*)::int as cnt
from order_facts
where order_date is not null and pay_amount is not null
group by 1, 2, 3, 4;

-- 브랜드 × 일 (일별 매출 차트) — 취소·반품·교환 제외한 순매출만
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

-- 채널(플랫폼) × 월 × 상태 (채널별 매출·순이익 카드)
create or replace view sales_channel_monthly
with (security_invoker = true) as
select platform,
       to_char(order_date at time zone 'Asia/Seoul', 'YYYY-MM') as ym,
       state,
       sum(coalesce(pay_amount, 0))::numeric as amt,
       count(*)::int as cnt
from order_facts
where order_date is not null and pay_amount is not null
group by 1, 2, 3;

-- 전체 기간 상태별 건수 (홈 배송전/배송중 박스 — 전체 운영 기준)
create or replace view order_state_totals
with (security_invoker = true) as
select brand_name, brand_id, state, count(*)::int as cnt
from order_facts
group by 1, 2, 3;

grant select on order_facts, sales_monthly, sales_daily, sales_channel_monthly, order_state_totals
  to authenticated, anon;
