-- 104 상품별 누적 판매금액 (사장님 11-05 "상품별 누적 판매금액도 만들자")
--
-- 계산이 무겁다(운영 실측 6.5초) → 머티리얼라이즈드 뷰(product_sales_mv)에 10분마다 미리 계산해 두고, 화면은 그 결과만 읽는다.
--   MV 는 RLS 가 안 걸린다 → 직접 읽기는 막고(revoke), product_sales() 함수가 권한 브랜드(can_access_brand)만 돌려준다. STAFF 는 권한 브랜드만 보인다.
--   갱신: pg_cron 10분마다 refresh concurrently(유일 인덱스 필요). 갱신 중에도 읽기는 막히지 않는다(기존 결과를 읽음).
--   잠금: refresh concurrently 는 이 MV 에만 EXCLUSIVE(다른 refresh 만 대기). channel_orders 쓰기(수집기)는 막지 않는다 — 읽기만 한다.
-- 기준 = 대시보드 '유효 주문'과 같다: order_facts.state 가 취소·반품이 아닌 주문(교환 포함, 086 D1 규칙). 부분 취소도 주문 단위 판정 그대로.
-- 금액 = 실결제 금액(channel_orders.pay_amount)을 상품 줄에 나눈 것. 그래서 브랜드별 합(상품 + 배송비 + 상품 미상) = sales_daily 합과 같다.
--   카페24  : (결제금액 - raw.actual_order_amount.shipping_fee) 를 상품 줄 금액(payment_amount, 없으면 (판매가+옵션가)×수량) 비율로 나눔. 배송비는 '#ship' 줄.
--   29CM    : 결제금액을 saleAmount 비율로 나눔(합이 결제금액과 같다).
--   키디키디: 수집기(eland sync)가 주문당 첫 상품 한 줄만 raw 에 남긴다 → 그 줄 sellAmount 까지만 그 상품, 나머지는 '#unknown'(상품 미상).
--   상품 줄이 없는 주문은 통째로 '#unknown'.
-- 묶기: 몰 안에서는 상품번호(카페24 product_no · 29CM itemId · 키디키디 itemNo)로 묶고 가장 최근 이름을 쓴다.
--   브랜드 안에서 몰·채널을 넘어서는 그 이름을 정규화해 같으면 한 상품으로 본다:
--   앞의 [..] 꼬리표([PRE-ORDER]·[6/27 오픈 예정] 등) · 앞 번호("13 ") 제거, 공백 제거, 소문자.
-- 결과 1행 = 브랜드 × 채널 × 상품(gkey) × 월(KST). 한 번 받아 화면이 브랜드·채널·기간으로 좁히고 gkey 로 다시 더한다.
-- 누적 = 데이터 시작부터 전부 더한 것. 이름(name)은 그 브랜드 안 그 상품의 가장 최근 이름.

drop function if exists public.product_sales();
drop materialized view if exists public.product_sales_mv;

create materialized view public.product_sales_mv as

with f as (
  select f.id, f.mall_key, f.channel, f.platform, f.brand_id, f.brand_name,
         (f.order_date at time zone 'Asia/Seoul')::date as d, f.pay_amount::numeric as pay, o.raw
  from order_facts f join channel_orders o on o.id = f.id
  where f.order_date is not null and f.pay_amount is not null and f.state not in ('cancel', 'return')
),
it as (
  select f.id, i.e->>'product_no' as pkey, i.e->>'product_name' as pname,
         coalesce((i.e->>'quantity')::numeric, 0) as qty,
         coalesce(nullif(i.e->>'payment_amount', '')::numeric,
                  (coalesce(nullif(i.e->>'product_price', '')::numeric, 0) + coalesce(nullif(i.e->>'option_price', '')::numeric, 0))
                  * coalesce((i.e->>'quantity')::numeric, 0)) as w
  from f, jsonb_array_elements(coalesce(f.raw->'items', '[]')) i(e)
  where coalesce(f.channel, 'cafe24') = 'cafe24'
  union all
  select f.id, i.e->>'itemId', i.e->>'itemName', coalesce((i.e->>'orderCount')::numeric, 0), coalesce(nullif(i.e->>'saleAmount', '')::numeric, 0)
  from f, jsonb_array_elements(coalesce(f.raw->'items', '[]')) i(e)
  where f.channel = '29cm'
  union all
  select f.id, f.raw->>'itemNo', f.raw->>'itemName', coalesce(nullif(f.raw->>'ordQty', '')::numeric, 0),
         coalesce(nullif(f.raw->>'sellAmount', '')::numeric, nullif(f.raw->>'sellPrice', '')::numeric, 0)
  from f where f.channel = 'eland' and f.raw ? 'itemName'
),
ord as (
  select f.*, coalesce(s.sw, 0) as sw, coalesce(s.n, 0) as n,
         case when coalesce(f.channel, 'cafe24') = 'cafe24'
              then least(f.pay, greatest(coalesce(nullif(f.raw->'actual_order_amount'->>'shipping_fee', '')::numeric, 0), 0))
              else 0 end as ship
  from f left join (select id, sum(w) sw, count(*) n from it group by id) s on s.id = f.id
),
lines as (
  -- 상품 줄: (결제금액 - 배송비) 를 상품 금액 비율로 나눈다. 키디키디는 수집된 한 줄 금액까지만 상품에.
  select o.brand_id, o.brand_name, o.platform, o.mall_key, o.d, it.pkey, it.pname, it.qty,
         case when o.channel = 'eland' then case when it.w > 0 then least(it.w, o.pay) else o.pay end
              when o.sw > 0 then (o.pay - o.ship) * it.w / o.sw
              else (o.pay - o.ship) / o.n end as amt
  from ord o join it on it.id = o.id
  union all
  select o.brand_id, o.brand_name, o.platform, o.mall_key, o.d, '#ship', null, 0, o.ship
  from ord o where o.ship > 0 and o.n > 0
  union all
  select o.brand_id, o.brand_name, o.platform, o.mall_key, o.d, '#unknown', null, 0,
         case when o.n = 0 then o.pay else o.pay - (case when o.sw > 0 then least(o.sw, o.pay) else o.pay end) end
  from ord o where o.n = 0 or (o.channel = 'eland' and o.sw > 0 and o.sw < o.pay)
)
, pk as (
  select distinct on (mall_key, pkey) mall_key, pkey, pname as last_name
  from lines where pkey not like '#%' and pname is not null order by mall_key, pkey, d desc
),
g as (
  select l.*, coalesce(pk.last_name, l.pname, l.pkey) as nm,
    case when l.pkey like '#%' then l.pkey
         else lower(regexp_replace(regexp_replace(regexp_replace(coalesce(pk.last_name, l.pname, l.pkey),
                '^\s*(\[[^]]*\]\s*)+', ''), '^\d{1,2}\s+', ''), '\s+', '', 'g')) end as gkey
  from lines l left join pk using (mall_key, pkey)
),
nm as (
  select distinct on (brand_id, gkey) brand_id, gkey, regexp_replace(nm, '^\s*(\[[^]]*\]\s*)+', '') as name
  from g where pkey not like '#%' order by brand_id, gkey, d desc
)
select g.brand_id, g.brand_name, g.platform, g.gkey, coalesce(nm.name, g.gkey) as name,
       to_char(g.d, 'YYYY-MM') as ym,
       count(distinct g.mall_key || ':' || coalesce(g.pkey, ''))::int as ids,
       sum(g.qty) as qty, round(sum(g.amt), 2) as amt
from g left join nm on nm.brand_id is not distinct from g.brand_id and nm.gkey = g.gkey
where g.brand_id is not null   -- 유일 인덱스(refresh concurrently)용. 브랜드 없는 몰은 어차피 화면에 안 나온다(운영 0건)
group by 1, 2, 3, 4, 5, 6
;

create unique index product_sales_mv_key on public.product_sales_mv (brand_id, platform, gkey, ym);
revoke all on public.product_sales_mv from anon, authenticated, public;

-- 화면이 부르는 함수. 권한 브랜드를 먼저 한 번만 고르고(브랜드 몇 개) 그 브랜드 줄만 돌려준다 — 줄마다 can_access_brand 를 부르지 않는다.
create or replace function public.product_sales()
returns table (brand_id uuid, brand_name text, platform text, gkey text, name text, ym text, ids int, qty numeric, amt numeric)
language sql stable security definer set search_path = public as $$
  select m.brand_id, m.brand_name, m.platform, m.gkey, m.name, m.ym, m.ids, m.qty, m.amt
  from public.product_sales_mv m
  where m.brand_id in (select b.id from public.brands b where public.can_access_brand(b.id))
$$;
grant execute on function public.product_sales() to authenticated;
revoke execute on function public.product_sales() from anon, public;

-- 갱신 함수 — cron 만 부른다(화면에서 못 부르게).
create or replace function public.refresh_product_sales()
returns void language sql security definer set search_path = public as $$
  refresh materialized view concurrently public.product_sales_mv
$$;
revoke execute on function public.refresh_product_sales() from anon, authenticated, public;

-- 10분마다 갱신 — DB 안 함수만 부른다(외부 호출·비밀값 없음). pg_cron 이 없으면 건너뜀.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'product-sales-refresh';
    perform cron.schedule('product-sales-refresh', '3-59/10 * * * *', 'select public.refresh_product_sales()');
  end if;
end $$;

notify pgrst, 'reload schema';
