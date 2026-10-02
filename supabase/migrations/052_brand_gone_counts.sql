-- '마지막 구매 뒤 발길 끊긴 고객'이 몇 명인지만 세는 가벼운 함수.
--  brand_customers 는 명단을 통째로 돌려줘서 카드 숫자 하나 띄우자고 부르기엔 무겁다.
create or replace function public.brand_gone_counts(
  p_brand text,
  p_from timestamptz default null,
  p_to   timestamptz default null
) returns json
language sql stable security definer set search_path = public as $$
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
$$;

revoke all on function public.brand_gone_counts(text,timestamptz,timestamptz) from public, anon;
grant execute on function public.brand_gone_counts(text,timestamptz,timestamptz) to authenticated;

notify pgrst, 'reload schema';
