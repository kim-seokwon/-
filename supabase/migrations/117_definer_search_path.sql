-- 117: public 의 SECURITY DEFINER 함수 전부 search_path 잠금(pg_catalog 맨 앞 · pg_temp 맨 뒤).
--   왜: search_path 에 pg_temp 가 없으면 PG 는 pg_temp 를 '맨 앞'에서 찾는다. 로그인한 누구나(TEMP 권한)
--       create temp table platform_admins … 로 같은 이름 표를 만들어 definer 함수의 권한 판정을 속일 수 있다(116 반려 재현).
--   방법: 본문은 안 고친다. ALTER ROUTINE … SET search_path 만. 지금 들어 있는 항목(public·extensions 등)은 순서 그대로 두고
--         pg_catalog 를 맨 앞, pg_temp 를 맨 뒤에 붙인다. search_path 가 아예 없던 함수는 public(+extensions 있으면) 로 채운다.
--   제외: 확장(extension)에 딸린 함수 · 이미 잠긴 함수(맨 앞 pg_catalog·맨 뒤 pg_temp).
--   되돌리기: 적용 전 값을 public.definer_search_path_backup 에 남긴다 → rollbacks/117_definer_search_path.down.sql.
--   두 번 돌려도 안전(이미 잠긴 건 건너뛰고, 백업은 처음 값만 남김).
--   ⚠ 114b 의 '이미 패치됨' 판정은 pg_get_functiondef md5 라서, 117 뒤에 114b 를 다시 돌리면 'SET search_path' 줄이 달라 멈춘다(안전 쪽).
--     114 되돌리기(옛 정의 복원)를 하면 그 함수들은 다시 search_path=public 이 된다 → 그 뒤엔 117 을 한 번 더 돌린다.

create table if not exists public.definer_search_path_backup (
  fn          text primary key,          -- 완전수식 regprocedure 문자열(public.이름(인자형)) — 세션 search_path 와 무관하게 찾힘
  old_path    text,                      -- 적용 전 search_path 값(proconfig 그대로). null = 없었음
  new_path    text not null,
  applied_at  timestamptz not null default now()
);
comment on table public.definer_search_path_backup is 'mig117: definer search_path 잠금 전 값';
alter table public.definer_search_path_backup enable row level security;
revoke all on public.definer_search_path_backup from public, anon, authenticated;

do $m$
declare
  r record; sp0 text := current_setting('search_path'); cfg text; toks text[]; keep text[]; t text; newp text; n_lock int := 0; n_skip int := 0;
  has_ext boolean := to_regnamespace('extensions') is not null;
begin
  --  regprocedure 글자는 세션 search_path 에 따라 'public.' 이 빠진다 → 이 블록 동안 pg_catalog 만 두어 항상 완전수식(public.f(…)·public 형도 public.t).
  --  set_config 는 트랜잭션을 따르므로 실패하면 함께 되돌아간다. 끝에서 원래 값 복원.
  perform set_config('search_path', 'pg_catalog, pg_temp', false);
  for r in
    select p.oid, p.oid::regprocedure::text as fn, p.proconfig
      from pg_catalog.pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.prosecdef
       and p.prokind in ('f', 'p')
       and not exists (select 1 from pg_catalog.pg_depend d
                        where d.classid = 'pg_catalog.pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
     order by 2
  loop
    cfg := (select substr(c, length('search_path=') + 1) from unnest(r.proconfig) c where c like 'search_path=%' limit 1);
    toks := case when cfg is null then null else
              array(select btrim(x) from unnest(string_to_array(cfg, ',')) x where btrim(x) <> '') end;
    if toks is not null and cardinality(toks) >= 2 and toks[1] in ('pg_catalog', '"pg_catalog"')
       and toks[cardinality(toks)] in ('pg_temp', '"pg_temp"') then
      n_skip := n_skip + 1;
      continue;
    end if;
    keep := '{}';
    if toks is null then
      keep := array['public'] || case when has_ext then array['extensions'] else '{}'::text[] end;
    else
      foreach t in array toks loop
        if t not in ('pg_catalog', '"pg_catalog"', 'pg_temp', '"pg_temp"', '""', '''''') then keep := keep || t; end if;
      end loop;
    end if;
    newp := array_to_string(array['pg_catalog'] || keep || array['pg_temp'], ', ');
    insert into public.definer_search_path_backup (fn, old_path, new_path) values (r.fn, cfg, newp)
      on conflict (fn) do nothing;
    execute format('alter routine %s set search_path = %s', r.fn, newp);
    raise notice 'mig117: % | % → %', r.fn, coalesce(cfg, '(없음)'), newp;
    n_lock := n_lock + 1;
  end loop;
  raise notice 'mig117: 잠금 %개 · 이미 잠김 %개', n_lock, n_skip;
  perform set_config('search_path', sp0, false);
end $m$;

-- 사후 확인: 잠기지 않은 public definer 가 남으면 멈춘다(확장 함수 제외).
do $c$
declare left_n int;
begin
  select count(*) into left_n
    from pg_catalog.pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.prokind in ('f', 'p')
     and not exists (select 1 from pg_catalog.pg_depend d where d.classid = 'pg_catalog.pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
     and not exists (select 1 from unnest(p.proconfig) c where c ~ '^search_path=pg_catalog,.*pg_temp$');
  if left_n > 0 then raise exception 'mig117: 아직 안 잠긴 definer %개', left_n; end if;
end $c$;
