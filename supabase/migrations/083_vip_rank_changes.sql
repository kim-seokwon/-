-- VIP 현재 누적 순위와 선택기간 시작 직전 누적 순위를 한 번에 계산한다.
-- 순위는 전체 고객에 먼저 매겨 1000명 표시 상한 밖 고객도 NEW로 오판하지 않는다.

create or replace function public.brand_vip_rank_changes(
  p_brand text,
  p_start timestamptz default null,
  p_limit int default 1000
) returns json
language sql stable security definer set search_path = public as $$
with current_totals as (
  select coalesce(nullif(o.receiver_phone,''), o.receiver_name, o.buyer_name) cust,
         max(o.receiver_name) name,
         max(o.receiver_phone) phone,
         count(*) orders,
         sum(coalesce(o.pay_amount,0)) spend,
         min(o.order_date) first_at,
         max(o.order_date) last_at,
         (array_agg(distinct m.label))[1:3] malls
    from channel_orders o
    join malls m on m.mall_key = o.mall_key
    join brands b on b.id = m.brand_id
   where b.name = p_brand
     and coalesce(public.can_access_brand(b.id), false)
     and coalesce(nullif(o.receiver_phone,''), o.receiver_name, o.buyer_name) is not null
     and coalesce(o.channel_status,'') !~ '^[CR]'
   group by 1
),
current_ranked as (
  select c.*, rank() over (order by spend desc) rank
    from current_totals c
),
current_limited as (
  select * from current_ranked order by rank, cust limit greatest(1, least(p_limit, 1000))
),
start_totals as (
  select coalesce(nullif(o.receiver_phone,''), o.receiver_name, o.buyer_name) cust,
         sum(coalesce(o.pay_amount,0)) spend
    from channel_orders o
    join malls m on m.mall_key = o.mall_key
    join brands b on b.id = m.brand_id
   where p_start is not null
     and b.name = p_brand
     and coalesce(public.can_access_brand(b.id), false)
     and coalesce(nullif(o.receiver_phone,''), o.receiver_name, o.buyer_name) is not null
     and coalesce(o.channel_status,'') !~ '^[CR]'
     and o.order_date < p_start
   group by 1
),
start_ranked as (
  select s.*, rank() over (order by spend desc) start_rank from start_totals s
)
select coalesce(json_agg(json_build_object(
  'name', c.name, 'phone', c.phone, 'orders', c.orders, 'spend', c.spend,
  'first', c.first_at::date, 'last', c.last_at::date,
  'gone_days', now()::date - c.last_at::date, 'malls', c.malls,
  'rank', c.rank, 'start_rank', s.start_rank,
  'rank_move', case
    when p_start is null then 'same'
    when s.start_rank is null then 'new'
    when s.start_rank > c.rank then 'up'
    when s.start_rank < c.rank then 'down'
    else 'same' end,
  'rank_delta', case when s.start_rank is null then null else abs(s.start_rank - c.rank) end,
  'cs', (select count(*) from cs_tickets t
          where t.customer_name = c.name or regexp_replace(coalesce(t.order_no,''),'\s','','g') in
                (select o2.order_id from channel_orders o2
                  where coalesce(nullif(o2.receiver_phone,''), o2.receiver_name, o2.buyer_name) = c.cust)),
  'last_items', (select string_agg(distinct left(i.product_name, 24), ', ')
                   from channel_orders o3
                   join channel_order_items i on i.channel_order_id = o3.id
                  where coalesce(nullif(o3.receiver_phone,''), o3.receiver_name, o3.buyer_name) = c.cust
                    and o3.order_date = c.last_at)
) order by c.rank, c.cust), '[]'::json)
from current_limited c
left join start_ranked s on s.cust = c.cust;
$$;

revoke all on function public.brand_vip_rank_changes(text,timestamptz,int) from public, anon;
grant execute on function public.brand_vip_rank_changes(text,timestamptz,int) to authenticated;

notify pgrst, 'reload schema';
