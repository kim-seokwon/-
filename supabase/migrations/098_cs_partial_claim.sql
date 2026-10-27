-- 098 CS 부분 반품·교환 + 잘못 쓴 CS 지우기(10-27)
--  사장님 "빈틈이 많다" · 직원 "5개 중에 2개만 반품or교환 접수할 때도 있거든, 그 내용이 들어와야"
--   · "삭제버튼두 만들어주라! 완료된거 말고 잘못 썼을때 삭제 할수있게"
--
-- 근거(운영 읽기 전용 조회 10-27): 카페24 raw->items[] 줄마다 order_status(R 반품·E 교환·C 취소·N 정상)·claim_code.
--   20261014-0009355 = 6줄 중 3줄만 R30(C20261026-0006175) · claim_quantity 는 "0" 으로 와서 0이면 주문 수량을 쓴다.
--   클레임은 restatus 수집이 channel_orders.raw 를 UPDATE 할 때 들어온다(insert 트리거만으론 못 받음).
--   eland 는 raw->items 가 없어 channel_order_items 로 대신(클레임 줄 없음 → 직원이 고른다).
--
-- 1) 신청 상품: cs_tickets.items(jsonb 줄 목록) · items_total(주문 줄 수, "6개 중 3개"). product_name 은 요약 문자열로 계속 쓴다.
--    cs_order_pick(주문) — 화면과 트리거가 같은 판정을 쓴다(줄 목록 · 클레임 줄 · 클레임 종류 · 요약).
--    cs_fill_from_order(096 위에 얹음): 클레임 줄이 있으면 그 줄만. 상품이 '자동으로 채운 값'(auto_fill)일 때만 바로잡고
--    직원이 고른 줄·직접 적은 상품은 안 덮는다. 유형(교환/반품)은 직원이 누른 값이라 트리거는 손대지 않는다.
-- 2) 지우기: 칸(deleted_at)을 다는 대신 cs_tickets_trash 로 옮긴다 — 주간 요약·브랜드 고객·VIP 등 SQL 집계 4곳과
--    화면이 cs_tickets 를 그대로 세므로, 행이 빠져야 집계·검색에서 자동으로 빠진다. 되돌리면 같은 id 로 돌아온다.
--    cs_trash/cs_restore RPC 만 쓴다: 완료건 거절 · 작성자 본인(companies.name = created_by) 또는 관리자만.
--    되돌릴 때 옛 날짜 의심건(접수일<주문일, 운영 124건)이 날짜 가드에 막히지 않게 가드에 '복구 중' 예외를 넣는다.
-- 운영 적용 금지(사장님 승인 후 팀장이). 096 다음에 깐다. 되돌리기: supabase/rollbacks/098_cs_partial_claim.down.sql

alter table public.cs_tickets add column if not exists items jsonb;
alter table public.cs_tickets add column if not exists items_total int;

-- ── 주문 줄 · 클레임 줄 ────────────────────────────────────────
--  줄: {code, name, option, qty, status, claim, reason}. 카페24는 raw->items, 그 외는 channel_order_items.
create or replace function public.cs_order_lines(p_order uuid)
returns jsonb language sql stable set search_path = public as $$
  select coalesce(
    (select jsonb_agg(jsonb_build_object(
              'code', e->>'order_item_code', 'name', e->>'product_name', 'option', e->>'option_value',
              'qty', coalesce(nullif(e->>'quantity', '')::int, 1), 'status', e->>'order_status',
              'claim', nullif(e->>'claim_code', ''), 'reason', nullif(e->>'claim_reason', ''),
              'cq', coalesce(nullif(e->>'claim_quantity', '')::int, 0)) order by n)
       from channel_orders o, jsonb_array_elements(o.raw->'items') with ordinality x(e, n)
      where o.id = p_order and o.channel = 'cafe24' and jsonb_typeof(o.raw->'items') = 'array'),
    (select jsonb_agg(jsonb_build_object('code', null, 'name', i.product_name, 'option', i.option_name,
              'qty', coalesce(i.quantity, 1), 'status', null, 'claim', null, 'reason', null, 'cq', 0) order by i.id)
       from channel_order_items i where i.channel_order_id = p_order),
    '[]'::jsonb)
$$;

--  같은 이름은 묶어 "이름 ×수량" · 주문 순서 그대로 · ', ' 로 잇는다(화면 csItems.js itemsSummary 와 같은 꼴)
create or replace function public.cs_items_summary(p_items jsonb)
returns text language sql immutable set search_path = public as $$
  select string_agg(case when q > 1 then nm || ' ×' || q else nm end, ', ' order by first_n)
    from (select e->>'name' nm, sum(coalesce((e->>'qty')::int, 1)) q, min(n) first_n
            from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality x(e, n)
           where coalesce(e->>'name', '') <> '' group by e->>'name') s
$$;

--  { lines, claim, kind, total, summary } — claim = R/E/C + 클레임 번호 있는 줄만(수량은 claim_quantity, 0이면 주문 수량)
create or replace function public.cs_order_pick(p_order uuid)
returns jsonb language plpgsql stable set search_path = public as $$
declare l jsonb; c jsonb; k text;
begin
  l := cs_order_lines(p_order);
  select coalesce(jsonb_agg(e - 'cq' || jsonb_build_object('qty', case when (e->>'cq')::int > 0 then (e->>'cq')::int else (e->>'qty')::int end) order by n), '[]'::jsonb)
    into c
    from jsonb_array_elements(l) with ordinality x(e, n)
   where coalesce(e->>'status', '') ~ '^[REC]' and coalesce(e->>'claim', '') <> '';
  select case when bool_and(e->>'status' like 'R%') then '반품' when bool_and(e->>'status' like 'E%') then '교환' end
    into k from jsonb_array_elements(c) e;
  return jsonb_build_object(
    'lines', (select coalesce(jsonb_agg(e - 'cq' order by n), '[]'::jsonb) from jsonb_array_elements(l) with ordinality x(e, n)),
    'claim', c, 'kind', k, 'total', jsonb_array_length(l),
    'summary', cs_items_summary(c));
end $$;
--  화면이 부른다 — security invoker 라 주문 RLS(브랜드 권한) 그대로
grant execute on function public.cs_order_lines(uuid) to authenticated;
grant execute on function public.cs_items_summary(jsonb) to authenticated;
grant execute on function public.cs_order_pick(uuid) to authenticated;

-- ── 늦은 연결 + 클레임 바로잡기(096 본문 + 신청 상품) ─────────────
create or replace function public.cs_fill_from_order(p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  o record; v_brand uuid; v_prod text; v_name text; t record; f jsonb; n int;
  pk jsonb; v_claim jsonb; v_total int; auto_prod boolean; auto_items boolean;
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
          items            = case when f ? 'items' and c.items is not distinct from f->'items' then null else c.items end,
          items_total      = case when f ? 'items' and c.items is not distinct from f->'items' then null else c.items_total end,
          auto_fill        = null
        where c.id = t.id;
      exception when others then
        raise warning 'cs_fill_from_order: cs % 되돌리기 실패 — %', t.id, sqlerrm;
      end;
    end loop;
    return;
  end if;

  select m.brand_id into v_brand from malls m where m.mall_key = o.mall_key;
  pk := cs_order_pick(o.id);
  v_claim := pk->'claim';
  v_total := nullif((pk->>'total')::int, 0);
  if jsonb_array_length(v_claim) > 0 then
    v_prod := pk->>'summary';                                   -- 신청한 줄만
  else
    v_claim := null;                                            -- 클레임 전 — 직원이 고르기 전까지 앞 3개(095 그대로)
    select string_agg(s.product_name, ', ') into v_prod
      from (select i.product_name from channel_order_items i
             where i.channel_order_id = o.id and coalesce(i.product_name, '') <> '' limit 3) s;
  end if;
  v_name := coalesce(nullif(o.receiver_name, ''), nullif(o.buyer_name, ''));

  for t in
    select c.* from cs_tickets c
     where order_no_norm(c.order_no) = order_no_norm(o.order_id)
       and (c.channel_order_id is null or c.channel_order_id = o.id)
       and (o.order_date is null or c.occurred_on is null
            or c.occurred_on >= (o.order_date at time zone 'Asia/Seoul')::date)
  loop
    begin
      --  상품이 비었거나 자동값 그대로면 '자동' — 직원이 적은 상품·고른 줄은 아니다
      auto_prod  := coalesce(t.product_name, '') = ''
                    or (t.auto_fill ? 'product_name' and t.product_name is not distinct from t.auto_fill->>'product_name');
      auto_items := t.items is null or (t.auto_fill ? 'items' and t.items is not distinct from t.auto_fill->'items');
      --  이번에 채우는 칸만 모은다(빈칸·자동값 + 채울 값 있음 + 지금 값과 다름)
      f := jsonb_strip_nulls(jsonb_build_object(
        'customer_name',    case when coalesce(nullif(t.customer_name, ''), '(이름없음)') = '(이름없음)' then v_name end,
        'channel_order_id', case when t.channel_order_id is null then o.id::text end,
        'brand_id',         case when t.brand_id is null then v_brand::text end,
        'product_name',     case when auto_prod and auto_items and t.product_name is distinct from v_prod
                                  and (v_claim is not null or coalesce(t.product_name, '') = '') then v_prod end,
        'items',            case when auto_prod and auto_items and v_claim is not null
                                  and t.items is distinct from v_claim then v_claim end));
      if f = '{}'::jsonb and (t.items_total is not null or v_total is null) then continue; end if;
      update cs_tickets c set
        customer_name    = coalesce(f->>'customer_name', c.customer_name),
        channel_order_id = coalesce((f->>'channel_order_id')::uuid, c.channel_order_id),
        brand_id         = coalesce((f->>'brand_id')::uuid, c.brand_id),
        product_name     = coalesce(f->>'product_name', c.product_name),
        items            = coalesce(f->'items', c.items),
        items_total      = coalesce(c.items_total, v_total),
        auto_fill        = case when f = '{}'::jsonb then c.auto_fill else coalesce(c.auto_fill, '{}'::jsonb) || f end
      where c.id = t.id;
    exception when others then
      raise warning 'cs_fill_from_order: cs % 못 채움 — %', t.id, sqlerrm;
    end;
  end loop;
end $$;
revoke all on function public.cs_fill_from_order(uuid) from public, anon, authenticated;

--  클레임은 restatus 가 raw 를 바꿀 때 온다 — 줄 목록이 바뀐 주문만 다시 맞춘다(수집은 멈추지 않는다)
create or replace function public.cs_fill_on_order_raw() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin perform cs_fill_from_order(new.id);
  exception when others then raise warning 'cs_fill_on_order_raw: 주문 % — %', new.id, sqlerrm;
  end;
  return null;
end $$;
revoke all on function public.cs_fill_on_order_raw() from public, anon, authenticated;
drop trigger if exists trg_channel_orders_cs_claim on public.channel_orders;
create trigger trg_channel_orders_cs_claim after update of raw on public.channel_orders
  for each row when (old.raw->'items' is distinct from new.raw->'items')
  execute function public.cs_fill_on_order_raw();

-- ── 잘못 쓴 CS 지우기 · 되돌리기 ──────────────────────────────
create table if not exists public.cs_tickets_trash (
  id uuid primary key,                -- 원래 cs_tickets.id(되돌리면 같은 id)
  row_data jsonb not null,
  deleted_by text,                    -- 표시용 이름
  deleted_by_uid uuid,                -- 되돌리기 판정용(로그인 id)
  deleted_at timestamptz not null default now()
);
alter table public.cs_tickets_trash add column if not exists deleted_by_uid uuid;
alter table public.cs_tickets_trash enable row level security;   -- 정책 없음 = 화면에서 직접 못 읽고 못 씀(RPC 만)

--  날짜 가드(운영 본문 그대로) + 되돌리기 중엔 INSERT 를 막지 않는다(원래 있던 행을 돌려놓는 것뿐)
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
    if (tg_op = 'INSERT' and coalesce(current_setting('cs.restoring', true), '') <> '1')
       or (tg_op = 'UPDATE' and (new.occurred_on   is distinct from old.occurred_on
                              or new.channel_order_id is distinct from old.channel_order_id)) then
      raise exception '접수일(%)이 주문일(%)보다 빠릅니다. 주문일 이후로 넣어 주세요.', new.occurred_on, od;
    end if;
    new.date_suspect := true;
  else
    new.date_suspect := false;
  end if;
  return new;
end $function$;

--  작성자 판정은 표시 이름(created_by)이 아니라 로그인 id 로 — 이름은 누구나 고칠 수 있고(cs_update 정책 true) 동명이인도 있다.
--  넣을 때 서버가 auth.uid() 로 찍고, 고칠 때는 원래 값 그대로(화면이 무엇을 보내도). 되돌리기 때만 지운 행의 값을 그대로 돌려놓는다.
--  098 이전 행은 비어 있다 → 관리자만 지울 수 있다.
alter table public.cs_tickets add column if not exists created_by_uid uuid;
create or replace function public.cs_tickets_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    new.created_by_uid := old.created_by_uid;
  elsif coalesce(current_setting('cs.restoring', true), '') <> '1' then
    new.created_by_uid := auth.uid();
  end if;
  return new;
end $$;
revoke all on function public.cs_tickets_owner() from public, anon, authenticated;
drop trigger if exists trg_cs_tickets_owner on public.cs_tickets;
create trigger trg_cs_tickets_owner before insert or update on public.cs_tickets
  for each row execute function public.cs_tickets_owner();

--  지울 수 있나: 완료 아님 · 작성자 본인(로그인 id) 또는 관리자
create or replace function public.cs_trash(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare t cs_tickets; me text;
begin
  select * into t from cs_tickets where id = p_id for update;
  if not found then raise exception '없는 CS 입니다'; end if;
  if t.status = '완료' then raise exception '완료된 CS 는 지울 수 없습니다'; end if;
  if not coalesce(is_master() or t.created_by_uid = auth.uid(), false) then   -- NULL(098 전 행·비로그인)은 거절
    raise exception '직접 쓴 CS 만 지울 수 있습니다(관리자는 모두)';
  end if;
  select name into me from companies where username = current_username() limit 1;
  insert into cs_tickets_trash (id, row_data, deleted_by, deleted_by_uid)
    values (t.id, to_jsonb(t), coalesce(me, current_username()), auth.uid())
    on conflict (id) do update set row_data = excluded.row_data, deleted_by = excluded.deleted_by,
      deleted_by_uid = excluded.deleted_by_uid, deleted_at = now();
  delete from cs_tickets where id = p_id;
end $$;

--  되돌리기: 지운 사람 본인 또는 관리자 — 같은 id·같은 값으로
create or replace function public.cs_restore(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r cs_tickets_trash;
begin
  select * into r from cs_tickets_trash where id = p_id for update;
  if not found then raise exception '되돌릴 CS 가 없습니다'; end if;
  if not coalesce(is_master() or r.deleted_by_uid = auth.uid(), false) then
    raise exception '지운 사람만 되돌릴 수 있습니다(관리자는 모두)';
  end if;
  perform set_config('cs.restoring', '1', true);
  insert into cs_tickets select * from jsonb_populate_record(null::cs_tickets, r.row_data);
  perform set_config('cs.restoring', '', true);
  delete from cs_tickets_trash where id = p_id;
end $$;
revoke all on function public.cs_trash(uuid) from public, anon;
revoke all on function public.cs_restore(uuid) from public, anon;
grant execute on function public.cs_trash(uuid) to authenticated;
grant execute on function public.cs_restore(uuid) to authenticated;

select '098 cs partial claim + trash installed' as status;
