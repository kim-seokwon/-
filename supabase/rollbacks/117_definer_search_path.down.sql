-- 117 되돌리기: 백업표의 적용 전 search_path 로 되돌린다. 117 뒤에 누가 또 바꾼 함수(지금 값 ≠ 117 이 넣은 값)는 건드리지 않는다.
--   ⚠ 되돌리면 pg_temp 바꿔치기 구멍이 다시 열린다. 두 번 돌려도 안전.
do $d$
declare r record; cur text; f regprocedure; missing int := 0; sp0 text := current_setting('search_path');
begin
  if to_regclass('public.definer_search_path_backup') is null then return; end if;
  --  키는 public.f(…) 완전수식. ALTER 대상 글자도 완전수식이 되게 이 블록 동안 pg_catalog 만(끝에서 복원)
  perform set_config('search_path', 'pg_catalog, pg_temp', false);
  for r in select fn, old_path, new_path from public.definer_search_path_backup order by fn loop
    f := to_regprocedure(r.fn);
    if f is null then raise notice '117-down: % 못 찾음 — 건너뜀(백업표 남김)', r.fn; missing := missing + 1; continue; end if;
    cur := (select substr(c, length('search_path=') + 1) from pg_catalog.pg_proc p, unnest(p.proconfig) c
             where p.oid = f and c like 'search_path=%' limit 1);
    if cur is distinct from r.new_path then raise notice '117-down: % 지금 값(%)이 117 값과 달라 남김', r.fn, cur; continue; end if;
    if r.old_path is null then
      execute format('alter routine %s reset search_path', f);
    elsif r.old_path in ('""', '''''') then
      execute format('alter routine %s set search_path = %L', f, '');
    else
      execute format('alter routine %s set search_path = %s', f, r.old_path);
    end if;
  end loop;
  --  못 찾은 함수가 있으면 표를 지우지 않는다(원래 값이 사라지지 않게)
  if missing = 0 and coalesce(obj_description('public.definer_search_path_backup'::regclass, 'pg_class'), '') like 'mig117:%' then
    drop table public.definer_search_path_backup;
  end if;
  perform set_config('search_path', sp0, false);
end $d$;
