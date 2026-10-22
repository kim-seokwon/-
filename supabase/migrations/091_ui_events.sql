-- 091 사용 기록(ui_events) — 직원 화면 사용 패턴 1주 수집용 (10-22 팀장 배정, 기획서 .work/사용편의/기획서.md 1단계)
--
-- 남기는 것: 누가(auth.uid) · 화면 id · 동작 id(아래 고정 목록) · 시각. 입력 내용·고객/주문 id·검색어는 남기지 않는다.
--   screen 은 영문 소문자 id 형식만, action 은 고정 목록(uiTrack.js UI_ACTIONS 와 같은 것)만 받는다 — 값을 이어 붙일 길을 DB 에서도 막는다.
-- 권한: 쓰기 = 직원(MASTER/STAFF) 본인 것만, 수집 기간 안에서만 · 읽기 = 관리자(MASTER)만, 종료 뒤 14일까지 · 고치기/지우기 없음.
-- 기간: 깔린 순간부터 7일(ui_events_config.ends_at). 끝나면 DB 가 쓰기를 거절한다 — 앱이 안 꺼져도 더 쌓이지 않는다.
-- 정리: 끝난 뒤 관리자가 select public.ui_events_finalize(); 한 번 → 지표 5개 + 일별 합계를 사람 구분 없이 ui_usage_summary 에 남기고
--   개인별 원자료(ui_events)는 지운다. 안 돌려도 종료 14일 뒤부터는 관리자도 원자료를 못 읽는다.
-- 번호: 090 은 도움말-공지-불편접수 워크스페이스가 쓴다 → 091. is_staff/is_master 는 087/090 과 같은 본문(어느 쪽이 먼저 깔려도 선다).
-- 운영 적용 금지(사장님 승인 후 뉴스탭과 한 번에). 되돌리기: supabase/rollbacks/091_ui_events.down.sql

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from companies
                  where username = split_part(auth.jwt()->>'email', '@', 1)
                    and role in ('MASTER', 'STAFF'))
$$;
revoke all on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated, service_role;

create or replace function public.is_master()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from companies
                  where username = split_part(auth.jwt()->>'email', '@', 1)
                    and role = 'MASTER')
$$;
revoke all on function public.is_master() from public, anon;
grant execute on function public.is_master() to authenticated, service_role;

-- ── 수집 기간(한 줄짜리 설정) ─────────────────────────────────────────────
create table if not exists public.ui_events_config (
  id       boolean primary key default true check (id),
  ends_at  timestamptz not null
);
alter table public.ui_events_config add column if not exists finalized_at timestamptz;   -- 확정(집계·삭제) 한 시각. 한 번 차면 다시 집계하지 않는다
insert into public.ui_events_config (ends_at) values (now() + interval '7 days') on conflict (id) do nothing;   -- 다시 깔아도 기간은 안 늘어난다
alter table public.ui_events_config enable row level security;
revoke all on public.ui_events_config from public, anon, authenticated;   -- 앱은 아래 함수로만 본다. 기간 변경은 SQL 편집기(관리 권한)에서만

create or replace function public.ui_events_until()
returns timestamptz language sql stable security definer set search_path = public as $$
  select case when finalized_at is null then ends_at else least(ends_at, finalized_at) end from ui_events_config where id   -- 확정 뒤엔 기간을 늘려도 다시 안 열림
$$;
revoke all on function public.ui_events_until() from public, anon;
grant execute on function public.ui_events_until() to authenticated, service_role;

-- ── 원자료 ───────────────────────────────────────────────────────────
create table if not exists public.ui_events (
  id       bigint generated always as identity primary key,
  user_id  uuid not null default auth.uid(),
  screen   text not null check (screen ~ '^[a-z0-9_.:-]{1,60}$'),
  action   text not null,
  at       timestamptz not null default now()
);
alter table public.ui_events drop constraint if exists ui_events_action_check;
alter table public.ui_events add constraint ui_events_action_check check (action in (
  'open', 'close', 'refresh',
  'filter_target', 'filter_shipping', 'filter_done', 'filter_claim', 'filter_all',
  'order_sync', 'invoice_export', 'ship_issue', 'invoice_upload',
  'cs_create', 'cs_create_order', 'cs_select', 'cs_filter', 'cs_status', 'cs_memo',
  'inv_tab_finished', 'inv_tab_materials', 'inv_save',
  'todo_add', 'todo_done', 'todo_undo', 'cal_add',
  'paper', 'paper_auto', 'brand_open'));
create index if not exists ui_events_at_idx on public.ui_events (at desc);
create index if not exists ui_events_user_idx on public.ui_events (user_id, at desc);

alter table public.ui_events enable row level security;
revoke all on public.ui_events from anon;
revoke all on public.ui_events from authenticated;
grant select, insert (screen, action) on public.ui_events to authenticated;   -- user_id·at 은 서버 기본값만(남의 id·과거 시각 못 넣음)

drop policy if exists ui_events_insert on public.ui_events;
drop policy if exists ui_events_select on public.ui_events;
create policy ui_events_insert on public.ui_events for insert to authenticated
  with check (public.is_staff() and user_id = auth.uid() and now() < public.ui_events_until());
create policy ui_events_select on public.ui_events for select to authenticated
  using (public.is_master() and now() < public.ui_events_until() + interval '14 days');

-- ── 지표 5개(기획서) — security_invoker: 읽는 사람 권한 그대로(관리자만 보임). 하루 = 한국 시각 기준 ──
-- ① 사람별 하루 첫 화면
create or replace view public.ui_m_first_screen with (security_invoker = true) as
  select day, user_id, screen from (
    select (at at time zone 'Asia/Seoul')::date as day, user_id, screen,
           row_number() over (partition by user_id, (at at time zone 'Asia/Seoul')::date order by id) as rn
      from public.ui_events where action = 'open') f
   where rn = 1;

-- ② 자주 여는 화면 TOP
create or replace view public.ui_m_open_top with (security_invoker = true) as
  select screen, count(*) as opens, count(distinct user_id) as users
    from public.ui_events where action = 'open'
   group by screen;

-- ③ 한 일 하는 데 클릭 수 — 끝맺는 동작(출고·송장·CS 상태·재고 저장·할 일 완료·일정 추가)마다,
--    같은 사람이 그 화면을 연 마지막 시점(30분 안)부터 끝맺기까지 남긴 기록 수(끝맺기 포함, 열기 제외)
create or replace view public.ui_m_task_clicks with (security_invoker = true) as
  with done as (
    select d.id, d.user_id, d.screen, d.action,
           (select max(o.id) from public.ui_events o
             where o.user_id = d.user_id and o.screen = d.screen and o.action = 'open'
               and o.id < d.id and o.at > d.at - interval '30 minutes') as start_id
      from public.ui_events d
     where d.action in ('ship_issue', 'invoice_upload', 'cs_status', 'inv_save', 'todo_done', 'cal_add')),
  c as (
    select done.screen, done.action,
           (select count(*) from public.ui_events e where e.user_id = done.user_id and e.id > done.start_id and e.id <= done.id) as clicks
      from done where start_id is not null)
  select screen, action as task, count(*) as done, round(avg(clicks), 1) as avg_clicks,
         percentile_disc(0.5) within group (order by clicks) as p50_clicks
    from c group by screen, action;

-- ④ 열고 바로(10초 안) 닫는 화면 — 창으로 연 것 기준(닫기 기록이 있는 것)
create or replace view public.ui_m_quick_close with (security_invoker = true) as
  select o.screen, count(*) as opens,
         count(*) filter (where c.at - o.at < interval '10 seconds') as quick_closes
    from public.ui_events o
    left join lateral (select x.at from public.ui_events x
                        where x.user_id = o.user_id and x.screen = o.screen and x.action = 'close' and x.id > o.id
                        order by x.id limit 1) c on true
   where o.action = 'open'
   group by o.screen;

-- ⑤ 안 쓰는 화면 — 앱 화면 목록 중 기간 내 한 번도 안 열린 것(목록은 main.js 창 제목표 기준)
create or replace view public.ui_m_unused with (security_invoker = true) as
  select s.screen
    from (values ('home'), ('orders'), ('cs'), ('inventory'), ('items'), ('sales'), ('analysis'), ('crm'), ('sns'), ('news'),
                 ('calendar'), ('reminders'), ('all_todos'), ('notes'), ('contacts'), ('vendors'), ('sample_maker'), ('tech_packs'),
                 ('quotes'), ('expenses'), ('dashboard'), ('integrations'), ('settings')) s(screen)
   where not exists (select 1 from public.ui_events e where e.screen = s.screen and e.action = 'open');

revoke all on public.ui_m_first_screen, public.ui_m_open_top, public.ui_m_task_clicks, public.ui_m_quick_close, public.ui_m_unused from anon;
grant select on public.ui_m_first_screen, public.ui_m_open_top, public.ui_m_task_clicks, public.ui_m_quick_close, public.ui_m_unused to authenticated;

-- ── 집계 확정본(사람 구분 없음) + 원자료 폐기 ───────────────────────────────
create table if not exists public.ui_usage_summary (
  id       bigint generated always as identity primary key,
  made_at  timestamptz not null default now(),
  metric   text not null,          -- daily · first_screen · open_top · task_clicks · quick_close · unused
  day      date,
  screen   text,
  action   text,
  n        bigint,
  value    numeric
);
alter table public.ui_usage_summary enable row level security;
revoke all on public.ui_usage_summary from public, anon, authenticated;
grant select on public.ui_usage_summary to authenticated;
drop policy if exists ui_usage_summary_select on public.ui_usage_summary;
create policy ui_usage_summary_select on public.ui_usage_summary for select to authenticated using (public.is_master());

-- 관리자만, 수집이 끝난 뒤에만, 딱 한 번. 한 트랜잭션: 설정 행을 잠그고 → 합계를 남기고 → 원자료를 지우고 → 확정 표시.
-- 다시 부르면(응답 지연·재시도) 아무것도 안 바꾸고 0 을 돌려준다. 동시에 두 번 불러도 뒤엣것은 잠금을 기다렸다가 확정 표시를 보고 빠진다.
-- 돌려준 값 = 지운 줄 수
create or replace function public.ui_events_finalize()
returns bigint language plpgsql security definer set search_path = public as $$
declare gone bigint; cfg ui_events_config%rowtype;
begin
  if not public.is_master() then raise exception 'ui_events_finalize: 관리자만'; end if;
  select * into cfg from ui_events_config where id for update;
  if cfg.finalized_at is not null then return 0; end if;
  if now() < cfg.ends_at then raise exception 'ui_events_finalize: 아직 수집 중(% 까지)', cfg.ends_at; end if;

  insert into ui_usage_summary (metric, day, screen, action, n, value)
    select 'daily', (at at time zone 'Asia/Seoul')::date, screen, action, count(*), count(distinct user_id) from ui_events group by 2, 3, 4;
  insert into ui_usage_summary (metric, screen, n)
    select 'first_screen', screen, count(*) from ui_m_first_screen group by screen;          -- 사람·날 수(누구인지는 안 남김)
  insert into ui_usage_summary (metric, screen, n, value)
    select 'open_top', screen, opens, users from ui_m_open_top;
  insert into ui_usage_summary (metric, screen, action, n, value)
    select 'task_clicks', screen, task, done, avg_clicks from ui_m_task_clicks;
  insert into ui_usage_summary (metric, screen, n, value)
    select 'quick_close', screen, opens, quick_closes from ui_m_quick_close;
  insert into ui_usage_summary (metric, screen)
    select 'unused', screen from ui_m_unused;

  delete from ui_events;
  get diagnostics gone = row_count;
  update ui_events_config set finalized_at = now() where id;
  return gone;
end $$;
revoke all on function public.ui_events_finalize() from public, anon;
grant execute on function public.ui_events_finalize() to authenticated;
