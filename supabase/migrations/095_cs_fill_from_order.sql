-- 095 CS 주문 늦게 연결 — 주문보다 CS 접수가 먼저면 고객·상품이 빈칸으로 남던 것(10-26 사장님 "고객정보 왜이래")
--  사례: 12:11 결제 → 12:12 교환 접수(주문 아직 없음, 카페24 5분 수집) → 12:15 주문 수집. 접수 때 _csLookupOrder 가 null 이라
--  '(이름없음)'·브랜드·상품 빈칸·channel_order_id null 로 저장되고 다시 안 채워졌다.
-- 고침: 주문(channel_orders)·상품(channel_order_items)이 들어올 때 같은 주문번호 CS 의 빈칸만 채운다.
--   대상: cs_tickets.order_no = 주문번호 · channel_order_id 가 비었거나 이 주문 · 같은 주문번호 주문이 몰 통틀어 정확히 1건
--   채우는 칸(빈칸일 때만): customer_name('(이름없음)'/빈값) · channel_order_id · brand_id(malls.brand_id) · product_name(최대 3개 ', ')
--   직원이 적은 값은 덮지 않는다. 접수일이 주문일(KST)보다 빠른 CS 는 건드리지 않는다(cs_tickets_guard_date 가 막는 경우).
--   CS 한 건 고치다 실패해도 주문 수집은 멈추지 않는다(경고만).
-- 운영 적용 금지(사장님 승인 후 팀장이). 되돌리기: supabase/rollbacks/095_cs_fill_from_order.down.sql

create or replace function public.cs_fill_from_order(p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  o record; v_brand uuid; v_prod text; v_name text; t record;
begin
  select id, order_id, mall_key, order_date, receiver_name, buyer_name into o
    from channel_orders where id = p_order;
  if not found or coalesce(o.order_id, '') = '' then return; end if;
  --  몰끼리 같은 주문번호가 있으면 어느 주문인지 모른다 → 안 채운다
  if (select count(*) from channel_orders where order_id = o.order_id) <> 1 then return; end if;

  select m.brand_id into v_brand from malls m where m.mall_key = o.mall_key;
  select string_agg(s.product_name, ', ') into v_prod
    from (select i.product_name from channel_order_items i
           where i.channel_order_id = o.id and coalesce(i.product_name, '') <> '' limit 3) s;
  v_name := coalesce(nullif(o.receiver_name, ''), nullif(o.buyer_name, ''));

  for t in
    select c.id from cs_tickets c
     where c.order_no = o.order_id
       and (c.channel_order_id is null or c.channel_order_id = o.id)
       and (o.order_date is null or c.occurred_on is null
            or c.occurred_on >= (o.order_date at time zone 'Asia/Seoul')::date)
       and (c.channel_order_id is null or c.brand_id is null
            or coalesce(c.product_name, '') = '' or coalesce(nullif(c.customer_name, ''), '(이름없음)') = '(이름없음)')
  loop
    begin
      update cs_tickets c set
        customer_name    = case when coalesce(nullif(c.customer_name, ''), '(이름없음)') = '(이름없음)' and v_name is not null
                                then v_name else c.customer_name end,
        channel_order_id = coalesce(c.channel_order_id, o.id),
        brand_id         = coalesce(c.brand_id, v_brand),
        product_name     = case when coalesce(c.product_name, '') = '' and v_prod is not null then v_prod else c.product_name end
      where c.id = t.id;
    exception when others then
      raise warning 'cs_fill_from_order: cs % 못 채움 — %', t.id, sqlerrm;
    end;
  end loop;
end $$;

create or replace function public.cs_fill_on_order() returns trigger
language plpgsql security definer set search_path = public as $$
begin perform cs_fill_from_order(new.id); return null; end $$;

create or replace function public.cs_fill_on_order_item() returns trigger
language plpgsql security definer set search_path = public as $$
begin perform cs_fill_from_order(new.channel_order_id); return null; end $$;

--  트리거로만 쓴다 — 화면(anon·authenticated)이 직접 부르지 못하게
revoke all on function public.cs_fill_from_order(uuid) from public, anon, authenticated;
revoke all on function public.cs_fill_on_order() from public, anon, authenticated;
revoke all on function public.cs_fill_on_order_item() from public, anon, authenticated;

drop trigger if exists trg_channel_orders_cs_fill on public.channel_orders;
create trigger trg_channel_orders_cs_fill after insert on public.channel_orders
  for each row execute function public.cs_fill_on_order();
drop trigger if exists trg_channel_order_items_cs_fill on public.channel_order_items;
create trigger trg_channel_order_items_cs_fill after insert on public.channel_order_items
  for each row execute function public.cs_fill_on_order_item();

select '095 cs_fill_from_order triggers installed' as status;
