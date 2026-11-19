-- 116 광고 판정선을 대시보드에서 고친다 (사장님 11-18 "유지선 대시보드에서 설정할 수 있게")
--   ad_report_rules 는 105 그대로 '읽기만' 열어 둔다(UPDATE 정책 없음). 고치는 길은 이 RPC 하나뿐.
--   set_ad_report_rule(brand_id, up_max, stop_over, min_days, min_spend)
--     · 권한: 플랫폼관리자(platform_admins) 또는 그 브랜드 조직의 owner·admin (org_memberships). 그 외 42501.
--     · 검증: 0 < up_max < stop_over, min_days ≥ 1, min_spend ≥ 0. null 인 칸은 지금 값 유지.
--     · 행이 없는 브랜드는 화면 기본값(하루예산 10,000 · 2일 · 10,000 · 1000/1600)으로 새로 만든다.
--     · 바뀌기 전·후를 ad_report_rule_log 에 남긴다(누가·언제). 값이 같으면 아무것도 안 바꾸고 로그도 안 남긴다.
--   되돌리기: supabase/rollbacks/116_ad_rule_edit.down.sql (함수·로그표만 지운다. 판정선 값은 로그의 before 로 손으로 되돌림)
--   보안(코덱스 팀장 반려 11-18): definer 함수는 search_path = pg_catalog, pg_temp + 표 전부 public.* — 일반 사용자가 만든 임시표로 권한표를 바꿔치기 못 한다.
--   전제: 113(platform_admins · org_memberships · brands.org_id) 적용됨.
do $m$ begin
  if to_regclass('public.platform_admins') is null or to_regclass('public.org_memberships') is null then
    raise exception '116 중단 — 113 조직표(platform_admins·org_memberships) 없음';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'brands' and column_name = 'org_id') then
    raise exception '116 중단 — brands.org_id 없음(113 먼저)';
  end if;
end $m$;

create table if not exists public.ad_report_rule_log (
  id          bigserial primary key,
  brand_id    uuid not null,
  before      jsonb,                 -- null = 행 새로 만듦
  after       jsonb not null,
  changed_by  uuid,                  -- auth.uid()
  changed_email text,
  changed_at  timestamptz not null default now()
);
comment on table public.ad_report_rule_log is 'mig116: 광고 판정선 변경 기록';
create index if not exists ad_report_rule_log_brand_idx on public.ad_report_rule_log (brand_id, changed_at desc);
alter table public.ad_report_rule_log enable row level security;
revoke all on public.ad_report_rule_log from anon, authenticated;
grant select on public.ad_report_rule_log to authenticated;
grant all on public.ad_report_rule_log to service_role;
--  로그 읽기 = 플랫폼관리자 또는 그 브랜드 조직의 구성원만(타조직 스태프는 못 봄 · 고객 조직 owner 는 자기 것 봄).
--  정책 안에서 조직표를 직접 읽으면 authenticated 에 그 표 권한이 필요해서 definer 함수로 감싼다.
--  definer 함수는 search_path 를 pg_catalog, pg_temp 로 잠그고 모든 표를 public.* 로 적는다(pg_temp 표 바꿔치기 막기).
create or replace function public.ad_rule_log_can_read(p_brand_id uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select exists (select 1 from public.platform_admins pa where pa.user_id = auth.uid())
      or exists (select 1 from public.org_memberships m join public.brands b on b.org_id = m.org_id
                  where b.id = p_brand_id and m.user_id = auth.uid()) $$;
revoke all on function public.ad_rule_log_can_read(uuid) from public, anon;
grant execute on function public.ad_rule_log_can_read(uuid) to authenticated;
drop policy if exists ad_report_rule_log_staff_read on public.ad_report_rule_log;
drop policy if exists ad_report_rule_log_org_read on public.ad_report_rule_log;
create policy ad_report_rule_log_org_read on public.ad_report_rule_log for select to authenticated using (public.ad_rule_log_can_read(brand_id));
--  판정선 읽기도 쓰기 권한과 맞춘다(코덱스 팀장 반려2): 105 는 is_staff() 만 읽기 → 고객 조직 owner(companies=CLIENT)가 저장은 되는데 읽으면 0행,
--  재접속하면 기본값이 보여 다시 저장할 때 덮어쓴다. 105 STAFF 읽기는 그대로 두고(내부 직원 회귀 방지) 조직 구성원 읽기를 더한다(정책은 OR).
drop policy if exists ad_report_rules_org_read on public.ad_report_rules;
create policy ad_report_rules_org_read on public.ad_report_rules for select to authenticated using (public.ad_rule_log_can_read(brand_id));

create or replace function public.set_ad_report_rule(
  p_brand_id uuid, p_up_max integer, p_stop_over integer, p_min_days integer default null, p_min_spend integer default null)
returns public.ad_report_rules
language plpgsql security definer set search_path = pg_catalog, pg_temp as $f$
declare
  cur public.ad_report_rules;
  nxt public.ad_report_rules;
  v_up int; v_stop int; v_days int; v_spend int;
  v_email text := nullif(auth.jwt() ->> 'email', '');
begin
  if p_brand_id is null or not exists (select 1 from public.brands where id = p_brand_id) then
    raise exception '브랜드가 없습니다' using errcode = '22023';
  end if;
  if not (exists (select 1 from public.platform_admins where user_id = auth.uid())
          or exists (select 1 from public.org_memberships m join public.brands b on b.org_id = m.org_id
                      where b.id = p_brand_id and m.user_id = auth.uid() and m.role in ('owner', 'admin'))) then
    raise exception '판정선은 조직 관리자만 바꿀 수 있습니다' using errcode = '42501';
  end if;

  select * into cur from public.ad_report_rules where brand_id = p_brand_id for update;
  v_up    := coalesce(p_up_max,    cur.up_max,    1000);
  v_stop  := coalesce(p_stop_over, cur.stop_over, 1600);
  v_days  := coalesce(p_min_days,  cur.min_days,  2);
  v_spend := coalesce(p_min_spend, cur.min_spend, 10000);
  if v_up <= 0 or v_up >= v_stop then
    raise exception '증액선은 0보다 크고 유지선보다 작아야 합니다 (증액 %, 유지 %)', v_up, v_stop using errcode = '22023';
  end if;
  if v_days < 1 then raise exception '최소 일수는 1일 이상' using errcode = '22023'; end if;
  if v_spend < 0 then raise exception '최소 지출은 0 이상' using errcode = '22023'; end if;

  if cur.brand_id is not null and cur.up_max = v_up and cur.stop_over = v_stop and cur.min_days = v_days and cur.min_spend = v_spend then
    return cur;                                            -- 바뀐 것 없음 → 기록도 없음
  end if;

  if cur.brand_id is null then
    insert into public.ad_report_rules (brand_id, test_daily_budget, min_days, min_spend, up_max, stop_over, updated_by, updated_at)
    values (p_brand_id, 10000, v_days, v_spend, v_up, v_stop, coalesce(v_email, auth.uid()::text, 'unknown'), now())
    returning * into nxt;
  else
    update public.ad_report_rules set up_max = v_up, stop_over = v_stop, min_days = v_days, min_spend = v_spend,
           updated_by = coalesce(v_email, auth.uid()::text, 'unknown'), updated_at = now()
     where brand_id = p_brand_id
    returning * into nxt;
  end if;

  insert into public.ad_report_rule_log (brand_id, before, after, changed_by, changed_email)
  values (p_brand_id,
          case when cur.brand_id is null then null else jsonb_build_object('up_max', cur.up_max, 'stop_over', cur.stop_over, 'min_days', cur.min_days, 'min_spend', cur.min_spend) end,
          jsonb_build_object('up_max', v_up, 'stop_over', v_stop, 'min_days', v_days, 'min_spend', v_spend),
          auth.uid(), v_email);
  return nxt;
end $f$;
comment on function public.set_ad_report_rule(uuid, integer, integer, integer, integer) is 'mig116: 광고 판정선 수정(관리자)';
revoke all on function public.set_ad_report_rule(uuid, integer, integer, integer, integer) from public, anon;
grant execute on function public.set_ad_report_rule(uuid, integer, integer, integer, integer) to authenticated;
