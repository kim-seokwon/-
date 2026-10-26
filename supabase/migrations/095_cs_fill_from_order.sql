-- 095 CS 주문 늦게 연결 — 주문보다 CS 접수가 먼저면 고객·상품이 빈칸으로 남던 것(10-26 사장님 "고객정보 왜이래")
--  사례: 12:11 결제 → 12:12 교환 접수(주문 아직 없음, 카페24 5분 수집) → 12:15 주문 수집. 접수 때 _csLookupOrder 가 null 이라
--  '(이름없음)'·브랜드·상품 빈칸·channel_order_id null 로 저장되고 다시 안 채워졌다.
-- 고침: 주문(channel_orders)·상품(channel_order_items)이 들어올 때 같은 주문번호 CS 의 빈칸만 채운다.
--   대상: cs_tickets.order_no = 주문번호 · channel_order_id 가 비었거나 이 주문 · 같은 주문번호 주문이 몰 통틀어 정확히 1건
--   채우는 칸(빈칸일 때만): customer_name('(이름없음)'/빈값) · channel_order_id · brand_id(malls.brand_id) · product_name(최대 3개 ', ')
--   직원이 적은 값은 덮지 않는다. 접수일이 주문일(KST)보다 빠른 CS 는 건드리지 않는다(cs_tickets_guard_date 가 막는 경우).
--   자동으로 채운 칸과 값은 cs_tickets.auto_fill(jsonb)에 남긴다. 같은 번호 주문이 다른 몰에서 2건째 들어오면
--   어느 주문인지 모르게 된 것 → 자동으로 채운 칸만 되돌린다(값이 그새 직원 손으로 바뀌었으면 그 칸은 그대로).
--   CS 한 건 고치다 실패해도, 트리거 전체가 실패해도 주문·품목 저장은 멈추지 않는다(경고만).
--   수집기: cafe24-sync 는 있는 주문을 거른 뒤 insert(after insert 가 새 주문마다 돈다) · 29cm 는 upsert(새 행은 insert 로 돈다, 품목은 안 넣음).
-- 운영 적용 금지(사장님 승인 후 팀장이). 되돌리기: supabase/rollbacks/095_cs_fill_from_order.down.sql

alter table public.cs_tickets add column if not exists auto_fill jsonb;
--  같은 번호 주문 세기·찾기 — 몰+번호 유니크(uq_order_mall_orderid)는 mall_key 가 앞이라 번호만으론 못 탄다
create index if not exists channel_orders_order_id_idx on public.channel_orders (order_id);

create or replace function public.cs_fill_from_order(p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  o record; v_brand uuid; v_prod text; v_name text; t record; f jsonb; n int;
begin
  select id, order_id, mall_key, order_date, receiver_name, buyer_name into o
    from channel_orders where id = p_order;
  if not found or coalesce(o.order_id, '') = '' then return; end if;

  select count(*) into n from channel_orders where order_id = o.order_id;
  if n <> 1 then
    --  몰끼리 같은 주문번호 → 어느 주문인지 모른다. 앞서 자동으로 채운 칸만 빈칸으로 되돌린다.
    for t in select c.* from cs_tickets c where c.order_no = o.order_id and c.auto_fill is not null loop
      begin
        f := t.auto_fill;
        update cs_tickets c set
          customer_name    = case when f ? 'customer_name' and c.customer_name is not distinct from f->>'customer_name'
                                  then '(이름없음)' else c.customer_name end,
          channel_order_id = case when f ? 'channel_order_id' and c.channel_order_id::text is not distinct from f->>'channel_order_id'
                                  then null else c.channel_order_id end,
          brand_id         = case when f ? 'brand_id' and c.brand_id::text is not distinct from f->>'brand_id'
                                  then null else c.brand_id end,
          product_name     = case when f ? 'product_name' and c.product_name is not distinct from f->>'product_name'
                                  then null else c.product_name end,
          auto_fill        = null
        where c.id = t.id;
      exception when others then
        raise warning 'cs_fill_from_order: cs % 되돌리기 실패 — %', t.id, sqlerrm;
      end;
    end loop;
    return;
  end if;

  select m.brand_id into v_brand from malls m where m.mall_key = o.mall_key;
  select string_agg(s.product_name, ', ') into v_prod
    from (select i.product_name from channel_order_items i
           where i.channel_order_id = o.id and coalesce(i.product_name, '') <> '' limit 3) s;
  v_name := coalesce(nullif(o.receiver_name, ''), nullif(o.buyer_name, ''));

  for t in
    select c.* from cs_tickets c
     where c.order_no = o.order_id
       and (c.channel_order_id is null or c.channel_order_id = o.id)
       and (o.order_date is null or c.occurred_on is null
            or c.occurred_on >= (o.order_date at time zone 'Asia/Seoul')::date)
       and (c.channel_order_id is null or c.brand_id is null
            or coalesce(c.product_name, '') = '' or coalesce(nullif(c.customer_name, ''), '(이름없음)') = '(이름없음)')
  loop
    begin
      --  이번에 채우는 칸만 모은다(빈칸 + 채울 값 있음)
      f := jsonb_strip_nulls(jsonb_build_object(
        'customer_name',    case when coalesce(nullif(t.customer_name, ''), '(이름없음)') = '(이름없음)' then v_name end,
        'channel_order_id', case when t.channel_order_id is null then o.id::text end,
        'brand_id',         case when t.brand_id is null then v_brand::text end,
        'product_name',     case when coalesce(t.product_name, '') = '' then v_prod end));
      if f = '{}'::jsonb then continue; end if;
      update cs_tickets c set
        customer_name    = coalesce(f->>'customer_name', c.customer_name),
        channel_order_id = coalesce((f->>'channel_order_id')::uuid, c.channel_order_id),
        brand_id         = coalesce((f->>'brand_id')::uuid, c.brand_id),
        product_name     = coalesce(f->>'product_name', c.product_name),
        auto_fill        = coalesce(c.auto_fill, '{}'::jsonb) || f
      where c.id = t.id;
    exception when others then
      raise warning 'cs_fill_from_order: cs % 못 채움 — %', t.id, sqlerrm;
    end;
  end loop;
end $$;

--  트리거 래퍼 — 안에서 무엇이 터져도 주문·품목 insert 는 계속된다(수집 우선)
create or replace function public.cs_fill_on_order() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin perform cs_fill_from_order(new.id);
  exception when others then raise warning 'cs_fill_on_order: 주문 % — %', new.id, sqlerrm;
  end;
  return null;
end $$;

create or replace function public.cs_fill_on_order_item() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin perform cs_fill_from_order(new.channel_order_id);
  exception when others then raise warning 'cs_fill_on_order_item: 주문 % — %', new.channel_order_id, sqlerrm;
  end;
  return null;
end $$;

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
