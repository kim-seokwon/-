-- 097 CS 원송장(처음 출고된 송장) + 합배송 — 주문별 송장·같이 나간 상품을 필요한 칸만 돌려준다(10-27 사장님 "여기에 송장번호도 확인되어야 될거같은데?").
--  카페24: channel_orders.invoice_no 는 비어 있고 raw->items[] 에 tracking_no·shipping_company_name·shipped_date·product_name·option_value·quantity.
--  29CM: invoice_no·courier 칸(raw->items[] 의 invoiceNo·deliveryCompanyName·itemName·optionValueList·orderCount 로 상품별 보강).
--  키디키디(eland): 송장 없음 → 주문당 빈 행 1개(channel 만) — 화면은 "송장 정보 없음".
--  raw 는 건당 ~3.6KB — 목록에서 raw 를 통째로 받지 않도록 서버에서 칸만 뽑는다. 한 번에 최대 200개 주문.
--  security invoker: channel_orders RLS(orders_select — 볼 수 있는 브랜드 몰만) 그대로.
-- 운영 적용 금지(사장님 승인 후 팀장이). 되돌리기: supabase/rollbacks/097_cs_order_shipments.down.sql

create or replace function public.cs_order_shipments(p_ids uuid[])
returns table (channel_order_id uuid, channel text, tracking_no text, courier text, shipped_date text,
               product_name text, option_name text, quantity int)
language sql stable security invoker set search_path = public as $$
  select o.id as channel_order_id, o.channel,
         nullif(btrim(coalesce(i->>'tracking_no', i->>'invoiceNo', o.invoice_no, '')), '') as tracking_no,
         nullif(btrim(coalesce(i->>'shipping_company_name', i->>'deliveryCompanyName', o.courier, '')), '') as courier,
         nullif(coalesce(i->>'shipped_date', i->>'deliveryStartedAt', o.shipped_at::text, ''), '') as shipped_date,
         nullif(coalesce(i->>'product_name', i->>'itemName', ''), '') as product_name,
         nullif(coalesce(i->>'option_value',
                         (select string_agg(v, ', ') from jsonb_array_elements_text(
                            case when jsonb_typeof(i->'optionValueList') = 'array' then i->'optionValueList' else '[]'::jsonb end) v), ''), '') as option_name,
         case when coalesce(i->>'quantity', i->>'orderCount') ~ '^[0-9]{1,6}$' then coalesce(i->>'quantity', i->>'orderCount')::int end as quantity
    from channel_orders o
    left join lateral jsonb_array_elements(
           case when jsonb_typeof(o.raw->'items') = 'array' then o.raw->'items' else '[]'::jsonb end) i on true
   where o.id = any ((p_ids)[1:200])
$$;
revoke all on function public.cs_order_shipments(uuid[]) from public, anon;
grant execute on function public.cs_order_shipments(uuid[]) to authenticated, service_role;

select '097 cs_order_shipments ready' as status;
