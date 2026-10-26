-- 096 되돌리기 — cs_fill_from_order 를 095 본문(주문번호 그대로 비교)으로 돌리고, 정규화 함수·인덱스를 걷는다.
--  1회 보정으로 채운 CS 값은 그대로 둔다(맞는 주문에서 온 값, auto_fill 에 기록돼 있음).
--  순서: 이 파일 → (095 까지 걷으려면) 095 down.
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

drop index if exists public.channel_orders_order_no_norm_idx;
drop function if exists public.order_no_norm(text);
