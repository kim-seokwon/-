-- 고객 분석의 블록을 눌렀을 때 보여줄 '고객 한 줄씩' 목록.
--  brand_repurchase 가 숫자만 돌려줘서, 왜 그런지(누가 떠났는지·무엇을 샀는지)는 볼 수가 없었다.
--  고객 묶는 기준은 brand_repurchase 와 똑같이 전화번호(없으면 수취인·구매자 이름)로 맞춘다.
create or replace function public.brand_customers(
  p_brand text,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_kind text default 'all',     -- all | once | repeat | loyal | gone | vip
  p_days int default 90,         -- gone: 마지막 구매 뒤 며칠 지났으면 '떠난' 으로 볼지
  p_limit int default 300
) returns json
language sql stable security definer set search_path = public as $$
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
$$;

revoke all on function public.brand_customers(text,timestamptz,timestamptz,text,int,int) from public, anon;
grant execute on function public.brand_customers(text,timestamptz,timestamptz,text,int,int) to authenticated;

notify pgrst, 'reload schema';
