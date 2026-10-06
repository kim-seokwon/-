-- 조간 — 아침에 한 장으로 보는 어제와 오늘.
--  화면마다 따로 긁으면 왕복이 많아진다. 한 번에 한 덩어리로 돌려준다.
--  어제/그제는 한국 시간 기준(=UTC+9)으로 자른다.
create or replace function public.morning_brief()
returns json language sql stable security definer set search_path = public as $$
with t as (
  select (now() at time zone 'Asia/Seoul')::date d
), r as (
  select (d - 1) y, (d - 2) y2, d today from t
), ord as (
  select b.name brand,
         (o.order_date at time zone 'Asia/Seoul')::date od,
         coalesce(o.pay_amount,0) amt
    from channel_orders o
    join malls m on m.mall_key = o.mall_key
    join brands b on b.id = m.brand_id
   where o.order_date >= ((select y2 from r)::timestamp at time zone 'Asia/Seoul')
     and coalesce(o.channel_status,'') !~ '^[CR]'
)
select json_build_object(
  'date', (select today from r),
  'yesterday', (select y from r),
  -- 어제 브랜드별 매출·건수, 그제와 견줘서
  'sales', coalesce((
    select json_agg(x order by x.amt desc) from (
      select brand,
             sum(amt) filter (where od = (select y from r))  amt,
             count(*) filter (where od = (select y from r))  cnt,
             sum(amt) filter (where od = (select y2 from r)) amt_prev
        from ord group by brand
    ) x where x.amt is not null or x.amt_prev is not null), '[]'::json),
  -- 어제 많이 나간 것 (수량 기준) — 숫자만 보면 무엇이 팔렸는지는 모른다
  'top_items', coalesce((select json_agg(z) from (
      select left(i.product_name, 34) nm, sum(coalesce(i.quantity,1))::int qty
        from channel_orders o
        join channel_order_items i on i.channel_order_id = o.id
        join malls m on m.mall_key = o.mall_key
       where (o.order_date at time zone 'Asia/Seoul')::date = (select y from r)
         and coalesce(o.channel_status,'') !~ '^[CR]'
       group by 1 order by 2 desc limit 6) z), '[]'::json),
  -- 오늘 할 일 / 지난 할 일
  'todo_today', coalesce((select json_agg(z) from (
      select title, assignee, list_name from reminders
       where not done and due_date = (select today from r) order by created_at limit 12) z), '[]'::json),
  'todo_late', coalesce((select json_agg(z) from (
      select title, assignee, due_date, ((select today from r) - due_date) late from reminders
       where not done and due_date < (select today from r) order by due_date limit 8) z), '[]'::json),
  'todo_late_n', (select count(*) from reminders where not done and due_date < (select today from r)),
  -- 다가오는 시즌 마감
  'seasons', coalesce((select json_agg(z) from (
      select p.name, b.name brand, p.deadline,
             (p.deadline::date - (select today from r)) dday
        from products p left join brands b on b.id = p.brand_id
       where p.deadline is not null
         and p.deadline::date between (select today from r) and (select today from r) + 45
       order by p.deadline limit 6) z), '[]'::json),
  -- 바깥 소식 (어제 이후 들어온 것 우선)
  'news', coalesce((select json_agg(z) from (
      select kind, source, title, url, author, published_at
        from news_items
       order by coalesce(published_at, created_at) desc limit 14) z), '[]'::json)
);
$$;

revoke all on function public.morning_brief() from public, anon;
grant execute on function public.morning_brief() to authenticated;

notify pgrst, 'reload schema';
