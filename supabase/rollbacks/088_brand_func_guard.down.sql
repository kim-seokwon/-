-- 088 되돌리기 — 10-19 운영 정의(050·052, 브랜드 검사 없음)로 복원

CREATE OR REPLACE FUNCTION public.brand_customers(p_brand text, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_kind text DEFAULT 'all'::text, p_days integer DEFAULT 90, p_limit integer DEFAULT 300)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
with c as (
  select coalesce(nullif(o.receiver_phone,''), o.receiver_name, o.buyer_name) cust,
         max(o.receiver_name) nm,
         max(o.receiver_phone) phone,
         count(*) n,
         sum(coalesce(o.pay_amount,0)) spend,
         min(o.order_date) first_at,
         max(o.order_date) last_at,
         (array_agg(distinct m.label))[1:3] malls
    from channel_orders o
    join malls m on m.mall_key = o.mall_key
    join brands b on b.id = m.brand_id
   where b.name = p_brand
     and coalesce(nullif(o.receiver_phone,''), o.receiver_name, o.buyer_name) is not null
     and coalesce(o.channel_status,'') !~ '^[CR]'
     and (p_from is null or o.order_date >= p_from)
     and (p_to   is null or o.order_date <  p_to)
   group by 1
),
-- 떠난 이유의 단서: 그 고객의 CS(교환·반품) 와 마지막으로 산 상품
x as (
  select c.*,
         (now()::date - c.last_at::date) gone_days,
         (select count(*) from cs_tickets t
           where t.customer_name = c.nm or regexp_replace(coalesce(t.order_no,''),'\s','','g') in
                 (select o2.order_id from channel_orders o2
                   where coalesce(nullif(o2.receiver_phone,''), o2.receiver_name, o2.buyer_name) = c.cust)) cs_n,
         (select string_agg(distinct left(i.product_name, 24), ', ')
            from channel_orders o3
            join channel_order_items i on i.channel_order_id = o3.id
           where coalesce(nullif(o3.receiver_phone,''), o3.receiver_name, o3.buyer_name) = c.cust
             and o3.order_date = c.last_at) last_items
    from c
)
select coalesce(json_agg(s.r order by s.sort_key desc), '[]'::json) from (
  select json_build_object(
           'name', nm, 'phone', phone, 'orders', n, 'spend', spend,
           'first', first_at::date, 'last', last_at::date, 'gone_days', gone_days,
           'cs', cs_n, 'last_items', last_items, 'malls', malls
         ) r,
         case when p_kind = 'gone' then gone_days::numeric else spend end sort_key
    from x
   where case
           when p_kind = 'once'   then n = 1
           when p_kind = 'repeat' then n >= 2
           when p_kind = 'loyal'  then n >= 10
           when p_kind = 'vip'    then true
           when p_kind = 'gone'   then gone_days >= p_days
           -- 'n3' 처럼 정확히 몇 회 산 사람 (분포 막대를 눌렀을 때)
           when p_kind ~ '^n[0-9]+$' then n = substring(p_kind from 2)::int
           else true
         end
   order by sort_key desc
   limit greatest(1, least(p_limit, 1000))
) s;
$function$;
revoke all on function public.brand_customers(text,timestamptz,timestamptz,text,int,int) from public, anon;
grant execute on function public.brand_customers(text,timestamptz,timestamptz,text,int,int) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.brand_gone_counts(p_brand text, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
with c as (
  select coalesce(nullif(o.receiver_phone,''), o.receiver_name, o.buyer_name) cust,
         count(*) n,
         sum(coalesce(o.pay_amount,0)) spend,
         max(o.order_date) last_at
    from channel_orders o
    join malls m on m.mall_key = o.mall_key
    join brands b on b.id = m.brand_id
   where b.name = p_brand
     and coalesce(nullif(o.receiver_phone,''), o.receiver_name, o.buyer_name) is not null
     and coalesce(o.channel_status,'') !~ '^[CR]'
     and (p_from is null or o.order_date >= p_from)
     and (p_to   is null or o.order_date <  p_to)
   group by 1
), d as (select *, (now()::date - last_at::date) gone from c)
select json_build_object(
  'customers', (select count(*) from d),
  'd90',   (select count(*) from d where gone >= 90),
  'd180',  (select count(*) from d where gone >= 180),
  'd365',  (select count(*) from d where gone >= 365),
  -- 떠난 분들이 쥐고 있던 돈 — 되돌릴 값어치를 가늠하려고
  'lost90_spend', (select coalesce(sum(spend),0) from d where gone >= 90),
  'repeat90',     (select count(*) from d where gone >= 90 and n >= 2)
);
$function$;
revoke all on function public.brand_gone_counts(text,timestamptz,timestamptz) from public, anon;
grant execute on function public.brand_gone_counts(text,timestamptz,timestamptz) to authenticated, service_role;

notify pgrst, 'reload schema';
