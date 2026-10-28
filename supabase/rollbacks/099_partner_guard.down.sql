-- 099 되돌리기: RESTRICTIVE 정책·직원 검사 줄·partner_items·require_staff 를 걷어내 10-28 운영 상태로.
--   기존 PERMISSIVE 정책은 099 가 안 건드렸으니 그대로 남아 있다.
--   함수 6개는 지금 깔린 정의에서 099 가 끼운 줄만 정확히 빼고 다시 만든다(나머지 본문은 그대로).

do $$
declare t text;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    execute format('drop policy if exists partner_guard_select on public.%I', t);
    execute format('drop policy if exists partner_guard_insert on public.%I', t);
    execute format('drop policy if exists partner_guard_update on public.%I', t);
    execute format('drop policy if exists partner_guard_delete on public.%I', t);
  end loop;
end $$;

drop policy if exists partner_guard_select on storage.objects;

do $$
declare f record; d text;
begin
  for f in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('morning_brief', 'get_channel_operational_status', 'reap_apify_runs',
                         'brand_customers', 'brand_gone_counts', 'brand_vip_rank_changes')
  loop
    d := pg_get_functiondef(f.oid);
    continue when position('-- 099 partner guard' in d) = 0;
    d := replace(d, E'\nselect public.require_staff(); -- 099 partner guard\n', '');
    d := replace(d, E'\n  perform public.require_staff(); -- 099 partner guard\n', '');
    execute d;
  end loop;
end $$;

drop function if exists public.partner_items();
drop function if exists public.require_staff();
