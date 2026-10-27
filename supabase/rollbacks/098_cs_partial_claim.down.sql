-- 098 되돌리기 — 신청 상품 트리거·RPC·지우기 RPC 를 걷고, cs_fill_from_order·날짜 가드를 098 전 본문으로 돌린다.
--  지운 CS(cs_tickets_trash)는 먼저 cs_tickets 로 돌려놓는다(롤백으로 기록이 사라지지 않게). 그 뒤 표를 지운다.
--  items·items_total 칸은 남긴다(이미 고른 신청 상품 기록 — 칸이 있어도 옛 화면·함수는 안 읽는다).
--  순서: 이 파일 → (더 걷으려면) 096 down.
drop trigger if exists trg_channel_orders_cs_claim on public.channel_orders;
drop function if exists public.cs_fill_on_order_raw();

do $$
begin
  perform set_config('cs.restoring', '1', true);
  insert into public.cs_tickets select (jsonb_populate_record(null::public.cs_tickets, r.row_data)).*
    from public.cs_tickets_trash r where not exists (select 1 from public.cs_tickets c where c.id = r.id);
end $$;
drop function if exists public.cs_trash(uuid);
drop function if exists public.cs_restore(uuid);
drop table if exists public.cs_tickets_trash;

create or replace function public.cs_tickets_guard_date()
returns trigger language plpgsql security definer set search_path = public as $function$
declare od date;
begin
  if new.channel_order_id is null or new.occurred_on is null then
    new.date_suspect := false; return new;
  end if;
  select (o.order_date at time zone 'Asia/Seoul')::date into od
    from channel_orders o where o.id = new.channel_order_id;
  if od is null then new.date_suspect := false; return new; end if;

  if new.occurred_on < od then
    --  새로 넣거나 날짜·주문연결을 직접 손댈 때만 막는다.
    --  기존 124건도 상태·메모는 계속 고칠 수 있어야 하니까(담당자 업무를 세우면 안 된다).
    if tg_op = 'INSERT'
       or new.occurred_on   is distinct from old.occurred_on
       or new.channel_order_id is distinct from old.channel_order_id then
      raise exception '접수일(%)이 주문일(%)보다 빠릅니다. 주문일 이후로 넣어 주세요.', new.occurred_on, od;
    end if;
    new.date_suspect := true;
  else
    new.date_suspect := false;
  end if;
  return new;
end $function$;

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
revoke all on function public.cs_fill_from_order(uuid) from public, anon, authenticated;

drop function if exists public.cs_order_pick(uuid);
drop function if exists public.cs_items_summary(jsonb);
drop function if exists public.cs_order_lines(uuid);

select '098 rolled back' as status;
