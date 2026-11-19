-- 120 P0-03 테스트 후보 판정표. 2026-11-19 운영 적용(사장님 승인).
--   운영 미적용. 번호는 팀장이 정해 supabase/migrations/1xx_data_verdicts.sql 로 옮긴다(전제: 113 조직표).
--   원칙: 이름은 '후보'를 고르는 데만, 집계 제외는 verdict='test' 행이 있을 때만. 판정은 사람 1회, 바꾸려면 p_change=true.
--   권한: 플랫폼관리자 또는 대상 행 조직의 owner·admin. 조회는 같은 조직 구성원 + 플랫폼관리자.
--   대상: products(시즌) · product_items(제품) · tech_packs(작업지시서) · vendors(생산처) 만. 대상 행을 지우지 않는다.
--   되돌리기: 맨 아래 주석 블록(함수·표 삭제, 대상 행은 그대로).
--   동명 객체: 이 마이그레이션이 만든 표·함수에만 'migDV:' 주석을 단다. 적용 전에 같은 이름 표·함수가 있는데 그 표식이 없으면
--             아무것도 바꾸지 않고 멈춘다(남의 객체를 덮어쓰거나, 되돌리기가 지우는 일 없음). 되돌리기도 표식 있는 것만 지운다.
do $m$
declare n int;
begin
  if to_regclass('public.platform_admins') is null or to_regclass('public.org_memberships') is null then
    raise exception 'data_verdicts 중단 — 113 조직표 없음';
  end if;
  if to_regclass('public.data_verdicts') is not null
     and coalesce(obj_description(to_regclass('public.data_verdicts'), 'pg_class'), '') not like 'migDV:%' then
    raise exception 'data_verdicts 중단 — 같은 이름 표가 이미 있음(이 마이그레이션 것 아님)';
  end if;
  select count(*) into n from pg_catalog.pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('dv_can_read', 'set_data_verdict')
     and coalesce(obj_description(p.oid, 'pg_proc'), '') not like 'migDV:%';
  if n > 0 then raise exception 'data_verdicts 중단 — 같은 이름 함수 %개가 이미 있음(이 마이그레이션 것 아님)', n; end if;
end $m$;

create table if not exists public.data_verdicts (
  id            bigserial primary key,
  org_id        uuid not null,
  target_table  text not null check (target_table in ('products', 'product_items', 'tech_packs', 'vendors')),
  target_id     uuid not null,
  verdict       text not null check (verdict in ('real', 'test')),
  note          text not null default '',
  decided_by    uuid,
  decided_email text,
  decided_at    timestamptz not null default now(),
  prev_verdict  text,                     -- 바꿨을 때 직전 값(처음이면 null)
  unique (org_id, target_table, target_id)
);
comment on table public.data_verdicts is 'migDV: 테스트 후보 사람 판정(real|test)';
alter table public.data_verdicts enable row level security;
revoke all on public.data_verdicts from anon, authenticated;
grant select on public.data_verdicts to authenticated;
--  정책 안에서 조직표를 직접 읽으면 authenticated 에 그 표 select 권한이 필요하다 → definer 함수로 감싼다.
create or replace function public.dv_can_read(p_org uuid) returns boolean language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
      or exists (select 1 from public.org_memberships where org_id = p_org and user_id = auth.uid()) $$;
comment on function public.dv_can_read(uuid) is 'migDV: 판정표 조회 권한';
revoke all on function public.dv_can_read(uuid) from public, anon;
grant execute on function public.dv_can_read(uuid) to authenticated;
drop policy if exists data_verdicts_read on public.data_verdicts;
create policy data_verdicts_read on public.data_verdicts for select to authenticated using (public.dv_can_read(org_id));

create or replace function public.set_data_verdict(p_table text, p_id uuid, p_verdict text, p_note text default '', p_change boolean default false)
returns public.data_verdicts language plpgsql security definer set search_path = pg_catalog, pg_temp as $f$
declare v_org uuid; v_old public.data_verdicts; v_row public.data_verdicts;
begin
  if p_table not in ('products', 'product_items', 'tech_packs', 'vendors') then raise exception '판정할 수 없는 표: %', p_table using errcode = '22023'; end if;
  if p_verdict not in ('real', 'test') then raise exception 'verdict 는 real|test' using errcode = '22023'; end if;
  execute format('select org_id from public.%I where id = $1', p_table) into v_org using p_id;
  if v_org is null then raise exception '대상이 없거나 조직이 비어 있습니다' using errcode = '22023'; end if;
  if auth.uid() is null or not (
       exists (select 1 from public.platform_admins where user_id = auth.uid())
    or exists (select 1 from public.org_memberships where org_id = v_org and user_id = auth.uid() and role in ('owner', 'admin'))) then
    raise exception '판정은 조직 관리자만 할 수 있습니다' using errcode = '42501';
  end if;
  select * into v_old from public.data_verdicts where org_id = v_org and target_table = p_table and target_id = p_id for update;
  if found then
    if v_old.verdict = p_verdict then return v_old; end if;                      -- 같은 판정 = 무변경
    if not coalesce(p_change, false) then raise exception '이미 판정됨 — 바꾸려면 p_change=true' using errcode = '23505'; end if;
    update public.data_verdicts set verdict = p_verdict, note = coalesce(p_note, ''), prev_verdict = v_old.verdict,
           decided_by = auth.uid(), decided_email = auth.jwt()->>'email', decided_at = now()
     where id = v_old.id returning * into v_row;
  else
    insert into public.data_verdicts (org_id, target_table, target_id, verdict, note, decided_by, decided_email)
    values (v_org, p_table, p_id, p_verdict, coalesce(p_note, ''), auth.uid(), auth.jwt()->>'email') returning * into v_row;
  end if;
  return v_row;
end $f$;
comment on function public.set_data_verdict(text, uuid, text, text, boolean) is 'migDV: 테스트 후보 판정 저장';
revoke all on function public.set_data_verdict(text, uuid, text, text, boolean) from public, anon;
grant execute on function public.set_data_verdict(text, uuid, text, text, boolean) to authenticated;

-- 집계에서 빼는 쪽이 쓰는 조건(예): and not exists (select 1 from public.data_verdicts v where v.target_table = 'products' and v.target_id = p.id and v.verdict = 'test')

-- ── 되돌리기 (대상 행·판정 외 데이터는 안 건드림) ─────────────
-- do $d$ declare f regprocedure; begin
--   f := to_regprocedure('public.set_data_verdict(text, uuid, text, text, boolean)');
--   if f is not null and coalesce(obj_description(f, 'pg_proc'), '') like 'migDV:%' then drop function public.set_data_verdict(text, uuid, text, text, boolean); end if;
--   if to_regclass('public.data_verdicts') is not null and coalesce(obj_description(to_regclass('public.data_verdicts'), 'pg_class'), '') like 'migDV:%' then drop table public.data_verdicts; end if;
--   f := to_regprocedure('public.dv_can_read(uuid)');
--   if f is not null and coalesce(obj_description(f, 'pg_proc'), '') like 'migDV:%' then drop function public.dv_can_read(uuid); end if;
-- end $d$;
