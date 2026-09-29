-- restatus egress 절감: 상태 시그니처를 DB에서 계산해 돌려준다.
--  이전엔 cafe24-sync restatus가 최근 60일 주문의 raw(jsonb, 건당 ~3.6KB)를 매번 전량 읽어
--  JS stateSig()로 비교했다 → 5분 주기에서 하루 ~1GB egress, 2026-09 무료한도 초과로 프로젝트 차단.
--  cafe24_state_sig()는 cafe24-sync/index.ts 의 stateSig()와 같은 문자열을 만든다:
--    `${shipping_status}|${order_status}|${items[].(status||order_status) 정렬 후 ','결합}`
--  state_sig(channel_orders)는 PostgREST 계산 필드 → .select("…, state_sig") 로 raw 없이 조회.
create or replace function public.cafe24_state_sig(r jsonb) returns text
language sql immutable parallel safe as $$
  select coalesce(r->>'shipping_status', '') || '|' || coalesce(r->>'order_status', '') || '|' ||
    coalesce((
      select string_agg(c, ',' order by c collate "C")
      from (
        select coalesce(nullif(i->>'status', ''), nullif(i->>'order_status', ''), '') as c
        from jsonb_array_elements(case when jsonb_typeof(r->'items') = 'array' then r->'items' else '[]'::jsonb end) i
      ) s
    ), '')
$$;

create or replace function public.state_sig(o public.channel_orders) returns text
language sql stable as $$ select public.cafe24_state_sig(o.raw) $$;

revoke all on function public.cafe24_state_sig(jsonb) from public, anon;
revoke all on function public.state_sig(public.channel_orders) from public, anon;
grant execute on function public.cafe24_state_sig(jsonb) to authenticated, service_role;
grant execute on function public.state_sig(public.channel_orders) to authenticated, service_role;

notify pgrst, 'reload schema';
