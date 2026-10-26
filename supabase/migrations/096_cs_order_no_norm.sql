-- 096 CS 주문번호 표기 차이 — 하이픈·공백·ORD 가 달라 주문을 못 찾던 것(10-26 사장님 "주문번호 인식안되는것도 확인햇어?")
--  사례(운영 읽기 전용 조회 10-26): 키디키디 CS "20250724-1209833"·"20250711-1006403" ↔ 주문 202507241209833·202507111006403,
--  29cm "ORD20260604-8904004"(표기 같음, 접수 때 29cm 주문 미수집).
--  095 위에 얹는다(095 는 이미 배포 중이라 고치지 않음). 095 의 cs_fill_from_order 를 정규화 비교로 바꾸고, 1회 보정을 돈다.
--  정규화: 영숫자만 · 대문자 · 맨 앞 'ORD' 무시 → cafe24 YYYYMMDD-NNNNNNN · 29cm ORDYYYYMMDD-NNNNNNN · eland 15자리가 같은 꼴이 된다.
--   정규화로 겹치는 주문이 2건 이상이면(몰끼리 같은 번호) 095 와 같이 안 채우고 자동분만 되돌린다.
-- 운영 적용 금지(사장님 승인 후 팀장이). 095 다음에 깐다. 되돌리기: supabase/rollbacks/096_cs_order_no_norm.down.sql

create or replace function public.order_no_norm(t text)
returns text language sql immutable parallel safe set search_path = public as $$
  select regexp_replace(upper(regexp_replace(coalesce(t, ''), '[^A-Za-z0-9]', '', 'g')), '^ORD', '')
$$;
grant execute on function public.order_no_norm(text) to authenticated, service_role;

--  주문 1.5만 행 — 주문이 들어올 때마다 정규화 번호로 세므로 식 인덱스. cs_tickets(324행)는 식 비교로 충분.
create index if not exists channel_orders_order_no_norm_idx on public.channel_orders (public.order_no_norm(order_id));

create or replace function public.cs_fill_from_order(p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  o record; v_brand uuid; v_prod text; v_name text; t record; f jsonb; n int;
begin
  select id, order_id, mall_key, order_date, receiver_name, buyer_name into o
    from channel_orders where id = p_order;
  if not found or order_no_norm(o.order_id) = '' then return; end if;

  select count(*) into n from channel_orders where order_no_norm(order_id) = order_no_norm(o.order_id);
  if n <> 1 then
    --  몰끼리 같은 주문번호(정규화 기준) → 어느 주문인지 모른다. 앞서 자동으로 채운 칸만 빈칸으로 되돌린다.
    for t in select c.* from cs_tickets c where order_no_norm(c.order_no) = order_no_norm(o.order_id) and c.auto_fill is not null loop
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
     where order_no_norm(c.order_no) = order_no_norm(o.order_id)
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

--  1회 보정 — 지금 주문에 안 붙은 CS 중 정규화 번호로 주문이 정확히 1건 맞는 것(10-26 운영 기준 3건 예상: 키디키디 2·29cm 1).
--   cs_fill_from_order 로 돌린다: 빈칸만 채우고 auto_fill 에 기록 · 직원 값 안 덮음 · 접수일<주문일이면 안 건드림.
do $$
declare r record;
begin
  for r in
    select o.id from channel_orders o
     where public.order_no_norm(o.order_id) in (
       select public.order_no_norm(c.order_no) from cs_tickets c
        where c.channel_order_id is null and public.order_no_norm(c.order_no) <> '')
       and (select count(*) from channel_orders x where public.order_no_norm(x.order_id) = public.order_no_norm(o.order_id)) = 1
  loop
    perform public.cs_fill_from_order(r.id);
  end loop;
end $$;

select '096 order_no_norm + cs_fill_from_order normalized + backfill done' as status,
       (select count(*) from cs_tickets where auto_fill ? 'channel_order_id') as auto_linked;
