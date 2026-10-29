-- 102 사용 기록 2차 수집 준비 — 회차(round_no) · 새 동작 13개 · 관리자가 직접 여는 7일 회차 (10-29 팀장 배정, .work/사용편의/2단계-후보.md 계측 보완)
--
-- 왜: 1차(091) 는 10-29 확정(finalize)돼 기록이 닫혔다. 계측 보완 코드(제품·조간 낱말)만 배포하면 DB 가 새 낱말을 거절하고
--      기간도 닫혀 있어 2차가 0건이다. 이 파일은 2차를 '열 수 있게'만 한다 — 깔아도 저절로 다시 열리지 않는다.
--
-- 바뀌는 것
--   · ui_events_config: round_no(지금 회차, 1차 = 1) · started_at 추가. finalized_at·ends_at 은 그대로(닫힌 1차는 닫힌 채).
--   · ui_usage_summary: round_no 추가 — 이미 있는 1차 익명 합계는 그대로 두고 round_no = 1 로 표시. 지우거나 고치지 않는다.
--   · ui_events 동작 CHECK: 091 의 28개 + 2단계 13개(uiTrack.js UI_ACTIONS_NEXT). 앱 UI_ACTIONS 와 같다.
--   · ui_events_finalize(): 지금 회차 번호를 붙여 합계를 남긴다. 그 밖(관리자만·끝난 뒤·한 번·같은 트랜잭션)은 091 그대로.
--   · ui_events_start_round(p_round): 관리자가 명시적으로 다음 회차를 7일 연다. 아래일 때 거절
--       - 지금 회차가 진행 중이거나 끝났는데 아직 확정 안 됨(finalized_at 없음)
--       - 원자료(ui_events)가 남아 있음
--       - p_round 가 '지금 회차 + 1' 이 아님(건너뛰기·되감기 금지)
--     같은 번호로 다시 부르면(응답 지연 재시도) 아무것도 안 바꾸고 그 번호를 돌려준다 — 다시 불러도 기간이 늘지 않는다.
-- 그대로인 것: 원자료 권한(직원 본인 쓰기·기간 안만 / 관리자 읽기·종료 14일까지)·지표 뷰 5개·ui_events_until().
-- 091 을 다시 돌리지 않는다 — 091 은 CHECK 를 28개로, finalize 를 회차 없는 것으로 되돌린다.
-- 다시 돌려도 안전. 운영 적용은 사장님 승인 뒤. 되돌리기: supabase/rollbacks/102_ui_events_round.down.sql
--
-- 2차 시작(승인 뒤, 관리자 계정으로 한 번):  select public.ui_events_start_round(2);
-- 2차 끝(7일 뒤):                           select public.ui_events_finalize();

-- ── 회차 ─────────────────────────────────────────────────────────────
alter table public.ui_usage_summary add column if not exists round_no int;
update public.ui_usage_summary set round_no = 1 where round_no is null;   -- 이미 있는 합계 = 1차
alter table public.ui_usage_summary alter column round_no set not null;

alter table public.ui_events_config add column if not exists round_no int not null default 1;
alter table public.ui_events_config add column if not exists started_at timestamptz;
--  되돌리기(down) 뒤 다시 깔 때: 합계에 남은 가장 큰 회차를 이어받는다(회차 번호가 겹치지 않게)
update public.ui_events_config set round_no = greatest(round_no, (select coalesce(max(round_no), 1) from public.ui_usage_summary)) where id;
update public.ui_events_config set started_at = ends_at - interval '7 days' where started_at is null and round_no = 1;   -- 1차는 091 이 깔린 때(끝 - 7일)
create index if not exists ui_usage_summary_round_idx on public.ui_usage_summary (round_no, metric);

-- ── 동작 목록: 091 + 2단계 13개 ──────────────────────────────────────────
alter table public.ui_events drop constraint if exists ui_events_action_check;
alter table public.ui_events add constraint ui_events_action_check check (action in (
  'open', 'close', 'refresh',
  'filter_target', 'filter_shipping', 'filter_done', 'filter_claim', 'filter_all',
  'order_sync', 'invoice_export', 'ship_issue', 'invoice_upload',
  'cs_create', 'cs_create_order', 'cs_select', 'cs_filter', 'cs_status', 'cs_memo',
  'inv_tab_finished', 'inv_tab_materials', 'inv_save',
  'todo_add', 'todo_done', 'todo_undo', 'cal_add',
  'paper', 'paper_auto', 'brand_open',
  'item_select', 'item_open', 'item_open_dbl', 'item_memo', 'item_note',
  'paper_close_done', 'paper_close_x', 'paper_close_esc',
  'paper_seen_1', 'paper_seen_2_3', 'paper_seen_4_6', 'paper_seen_7p', 'paper_seen_all'));

-- ── 확정: 지금 회차 번호로 남긴다(나머지는 091 과 같다) ─────────────────────────
create or replace function public.ui_events_finalize()
returns bigint language plpgsql security definer set search_path = public as $$
declare gone bigint; cfg ui_events_config%rowtype;
begin
  if not public.is_master() then raise exception 'ui_events_finalize: 관리자만'; end if;
  select * into cfg from ui_events_config where id for update;
  if cfg.finalized_at is not null then return 0; end if;
  if now() < cfg.ends_at then raise exception 'ui_events_finalize: 아직 수집 중(% 까지)', cfg.ends_at; end if;

  insert into ui_usage_summary (round_no, metric, day, screen, action, n, value)
    select cfg.round_no, 'daily', (at at time zone 'Asia/Seoul')::date, screen, action, count(*), count(distinct user_id) from ui_events group by 3, 4, 5;
  insert into ui_usage_summary (round_no, metric, screen, n)
    select cfg.round_no, 'first_screen', screen, count(*) from ui_m_first_screen group by screen;
  insert into ui_usage_summary (round_no, metric, screen, n, value)
    select cfg.round_no, 'open_top', screen, opens, users from ui_m_open_top;
  insert into ui_usage_summary (round_no, metric, screen, action, n, value)
    select cfg.round_no, 'task_clicks', screen, task, done, avg_clicks from ui_m_task_clicks;
  insert into ui_usage_summary (round_no, metric, screen, n, value)
    select cfg.round_no, 'quick_close', screen, opens, quick_closes from ui_m_quick_close;
  insert into ui_usage_summary (round_no, metric, screen)
    select cfg.round_no, 'unused', screen from ui_m_unused;

  delete from ui_events;
  get diagnostics gone = row_count;
  update ui_events_config set finalized_at = now() where id;
  return gone;
end $$;
revoke all on function public.ui_events_finalize() from public, anon;
grant execute on function public.ui_events_finalize() to authenticated;

-- ── 다음 회차 열기: 관리자만 · 명시적으로 · 7일 · 한 번 ─────────────────────────
-- 돌려준 값 = 열린(또는 이미 열려 있던 같은) 회차 번호
create or replace function public.ui_events_start_round(p_round int)
returns int language plpgsql security definer set search_path = public as $$
declare cfg ui_events_config%rowtype;
begin
  if not public.is_master() then raise exception 'ui_events_start_round: 관리자만'; end if;
  select * into cfg from ui_events_config where id for update;
  if not found then raise exception 'ui_events_start_round: 설정 없음(091 먼저)'; end if;
  if cfg.finalized_at is null then
    if cfg.round_no = p_round then return p_round; end if;   -- 같은 번호 재시도: 이미 열림 — 기간은 그대로
    raise exception 'ui_events_start_round: %차가 아직 확정 안 됨(진행 중이거나 finalize 전, % 까지)', cfg.round_no, cfg.ends_at;
  end if;
  if p_round is distinct from cfg.round_no + 1 then
    raise exception 'ui_events_start_round: 다음 회차는 %', cfg.round_no + 1;
  end if;
  if exists (select 1 from ui_events) then raise exception 'ui_events_start_round: 원자료가 남아 있음'; end if;

  update ui_events_config
     set round_no = p_round, started_at = now(), ends_at = now() + interval '7 days', finalized_at = null
   where id;
  return p_round;
end $$;
revoke all on function public.ui_events_start_round(int) from public, anon;
grant execute on function public.ui_events_start_round(int) to authenticated;
