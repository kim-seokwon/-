-- 119 상품별 판매 — 키디키디 줄마다 나누기. 2026-11-19 운영 적용(사장님 승인). 되돌리기 .work/개선요청-1118/키디키디/119_product_sales_eland_lines.down.sql
--   왜: 수집기(channel-bots/kidikidi, lines.mjs)가 이제 raw.items[] 에 주문의 전 줄을 남긴다. 104 는 첫 줄 하나만 읽어 나머지를 '#unknown' 으로 뒀다.
--   바뀌는 것: eland 주문에 raw.items 배열이 있으면 결제금액을 줄 sellAmount 비율로 나눈다(29CM 방식). 없으면(옛 수집) 104 와 똑같이 한 줄 폴백.
--   불변: 주문마다 Σ상품줄 + #ship + #unknown = pay. 월·브랜드 합계는 그대로, #unknown 이 상품으로만 옮겨간다.
--   MV 만 바꾼다(product_sales()·refresh_product_sales()·cron 은 이름으로 MV 를 읽어 그대로 둔다). 되돌리기: 119_product_sales_eland_lines.down.sql(104 정의로 MV 재생성).
--   잠금: drop/create MV 는 짧은 ACCESS EXCLUSIVE — 그동안 product_sales() 는 대기. 새 MV 는 만들 때 한 번 채워진다.
begin;
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
  -- 키디키디 새 수집(raw.items[] 전 줄) — 29CM 처럼 결제금액을 sellAmount 비율로 나눈다
  select f.id, i.e->>'itemNo', i.e->>'itemName', coalesce(nullif(i.e->>'ordQty', '')::numeric, 0),
         coalesce(nullif(i.e->>'sellAmount', '')::numeric, nullif(i.e->>'sellPrice', '')::numeric, 0)
  from f, jsonb_array_elements(f.raw->'items') i(e)
  where f.channel = 'eland' and jsonb_typeof(f.raw->'items') = 'array'
  union all
  -- 키디키디 옛 수집(첫 줄 하나만) — 104 그대로
  select f.id, f.raw->>'itemNo', f.raw->>'itemName', coalesce(nullif(f.raw->>'ordQty', '')::numeric, 0),
         coalesce(nullif(f.raw->>'sellAmount', '')::numeric, nullif(f.raw->>'sellPrice', '')::numeric, 0)
  from f where f.channel = 'eland' and f.raw ? 'itemName' and jsonb_typeof(f.raw->'items') is distinct from 'array'
),
ord as (
  select f.*, coalesce(s.sw, 0) as sw, coalesce(s.n, 0) as n,
         (f.channel = 'eland' and jsonb_typeof(f.raw->'items') is distinct from 'array') as eland_one,
         case when coalesce(f.channel, 'cafe24') = 'cafe24'
              then least(f.pay, greatest(coalesce(nullif(f.raw->'actual_order_amount'->>'shipping_fee', '')::numeric, 0), 0))
              else 0 end as ship
  from f left join (select id, sum(w) sw, count(*) n from it group by id) s on s.id = f.id
),
lines as (
  -- 상품 줄: (결제금액 - 배송비) 를 상품 금액 비율로 나눈다. 키디키디 옛 한 줄 raw 는 그 줄 금액까지만 상품에.
  select o.brand_id, o.brand_name, o.platform, o.mall_key, o.d, it.pkey, it.pname, it.qty,
         case when o.eland_one then case when it.w > 0 then least(it.w, o.pay) else o.pay end
              when o.sw > 0 then (o.pay - o.ship) * it.w / o.sw
              else (o.pay - o.ship) / o.n end as amt
  from ord o join it on it.id = o.id
  union all
  select o.brand_id, o.brand_name, o.platform, o.mall_key, o.d, '#ship', null, 0, o.ship
  from ord o where o.ship > 0 and o.n > 0
  union all
  select o.brand_id, o.brand_name, o.platform, o.mall_key, o.d, '#unknown', null, 0,
         case when o.n = 0 then o.pay else o.pay - (case when o.sw > 0 then least(o.sw, o.pay) else o.pay end) end
  from ord o where o.n = 0 or (o.eland_one and o.sw > 0 and o.sw < o.pay)
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
commit;
notify pgrst, 'reload schema';
