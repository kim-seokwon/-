-- 088 brand_customers · brand_gone_counts 에 브랜드 검사 (10-19 RLS점검 위험3: .work/상용화/RLS점검.md)
--
-- 두 함수는 SECURITY DEFINER(RLS 우회) + authenticated EXECUTE 인데 p_brand 검사가 없어서,
-- 로그인만 하면 남의 브랜드 고객 이름·전화·구매액을 받을 수 있었다(STAFF 는 brand_access 밖 브랜드도).
-- 바꾼 뒤: 함수 첫머리에서 p_brand 이름의 브랜드 중 can_access_brand 통과한 id 만 확정 → 없으면 42501 예외.
--   본문 조인도 그 id 로만(10-19 코덱스 반려: 이름이 같은 권한 밖 브랜드가 섞이는 우회 차단).
--   brand_customers 의 보조조회(CS 건수·마지막에 산 것)도 허용 브랜드 몰 주문·CS 만 본다(10-19 2차 반려).
--   없는 브랜드 이름도 같은 예외(존재 여부를 흘리지 않음).
-- 본문은 10-19 운영 정의와 같고 브랜드 조건만 다르다: 주 집계 b.name = p_brand → b.id = any(v_ids), brand_customers 보조조회에 v_ids 제한.
-- 권한: 익명 EXECUTE 없음 유지(public·anon revoke, authenticated·service_role grant — 운영과 같음).
-- 되돌리기: supabase/rollbacks/088_brand_func_guard.down.sql

create or replace function public.brand_customers(p_brand text, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_kind text DEFAULT 'all'::text, p_days integer DEFAULT 90, p_limit integer DEFAULT 300)
returns json language plpgsql stable security definer set search_path = public as $function$
declare
  v_ids uuid[];
begin
  -- 브랜드 검사: 이름이 p_brand 인 브랜드 중 로그인 사용자가 볼 수 있는 것(can_access_brand — RLS 와 같은 규칙)의 id 만 확정한다.
  -- 엣지함수(service_role)는 RLS 를 우회하는 것과 같게 전부 허용. 하나도 없으면 42501.
  -- 본문은 이 id 로만 조인한다 — 이름이 같은 권한 밖 브랜드가 생겨도 섞이지 않게(brands.name 에 유일 제약 없음).
  select array_agg(b.id) into v_ids
    from brands b
   where b.name = p_brand
     and (coalesce(auth.jwt()->>'role', '') = 'service_role' or public.can_access_brand(b.id));
  if v_ids is null then
    raise exception 'forbidden: brand' using errcode = '42501';
  end if;
  return (
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
   where b.id = any(v_ids)
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
         -- CS 는 허용 브랜드 것만: brand_id 가 v_ids 안, 또는 brand_id 가 비었으면 주문번호로 이어진 주문이 허용 브랜드 몰일 때만.
         -- (brand_id·주문 둘 다 없는 CS 는 브랜드를 알 수 없어 세지 않는다)
         (select count(*) from cs_tickets t
           where (t.brand_id = any(v_ids)
                  or (t.brand_id is null and exists (
                        select 1 from channel_orders o4 join malls m4 on m4.mall_key = o4.mall_key
                         where m4.brand_id = any(v_ids)
                           and o4.order_id = regexp_replace(coalesce(t.order_no,''),'\s','','g'))))
             and (t.customer_name = c.nm or regexp_replace(coalesce(t.order_no,''),'\s','','g') in
                 (select o2.order_id from channel_orders o2
                    join malls m2 on m2.mall_key = o2.mall_key
                   where m2.brand_id = any(v_ids)
                     and coalesce(nullif(o2.receiver_phone,''), o2.receiver_name, o2.buyer_name) = c.cust))) cs_n,
         (select string_agg(distinct left(i.product_name, 24), ', ')
            from channel_orders o3
            join malls m3 on m3.mall_key = o3.mall_key
            join channel_order_items i on i.channel_order_id = o3.id
           where m3.brand_id = any(v_ids)
             and coalesce(nullif(o3.receiver_phone,''), o3.receiver_name, o3.buyer_name) = c.cust
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
) s
  );
end
$function$;
revoke all on function public.brand_customers(text,timestamptz,timestamptz,text,int,int) from public, anon;
grant execute on function public.brand_customers(text,timestamptz,timestamptz,text,int,int) to authenticated, service_role;

create or replace function public.brand_gone_counts(p_brand text, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
returns json language plpgsql stable security definer set search_path = public as $function$
declare
  v_ids uuid[];
begin
  -- 브랜드 검사: 이름이 p_brand 인 브랜드 중 로그인 사용자가 볼 수 있는 것(can_access_brand — RLS 와 같은 규칙)의 id 만 확정한다.
  -- 엣지함수(service_role)는 RLS 를 우회하는 것과 같게 전부 허용. 하나도 없으면 42501.
  -- 본문은 이 id 로만 조인한다 — 이름이 같은 권한 밖 브랜드가 생겨도 섞이지 않게(brands.name 에 유일 제약 없음).
  select array_agg(b.id) into v_ids
    from brands b
   where b.name = p_brand
     and (coalesce(auth.jwt()->>'role', '') = 'service_role' or public.can_access_brand(b.id));
  if v_ids is null then
    raise exception 'forbidden: brand' using errcode = '42501';
  end if;
  return (
with c as (
  select coalesce(nullif(o.receiver_phone,''), o.receiver_name, o.buyer_name) cust,
         count(*) n,
         sum(coalesce(o.pay_amount,0)) spend,
         max(o.order_date) last_at
    from channel_orders o
    join malls m on m.mall_key = o.mall_key
    join brands b on b.id = m.brand_id
   where b.id = any(v_ids)
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
)
  );
end
$function$;
revoke all on function public.brand_gone_counts(text,timestamptz,timestamptz) from public, anon;
grant execute on function public.brand_gone_counts(text,timestamptz,timestamptz) to authenticated, service_role;

notify pgrst, 'reload schema';
