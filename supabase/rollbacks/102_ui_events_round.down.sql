-- 102 되돌리기 — 회차 열기 함수를 걷고, 동작 CHECK·finalize 를 091 로 되돌린다.
-- 익명 합계(ui_usage_summary)는 지우지 않는다: round_no 칸은 남기되 비워도 되게(091 finalize 는 이 칸을 모른다) 한다 — 회차 구분이 남는다.
-- 지금 회차가 열려 있거나(확정 전) 원자료에 새 낱말이 있으면 거절한다 — 먼저 select public.ui_events_finalize(); (끝난 뒤)
-- 되돌린 뒤 2차가 이미 확정돼 있으면 기록은 닫힌 채다(ui_events_until 그대로).
do $$
begin
  if exists (select 1 from public.ui_events_config where id and finalized_at is null and round_no > 1) then
    raise exception '102 되돌리기: 2차 이후 회차가 확정 전 — 먼저 끝난 뒤 ui_events_finalize()';
  end if;
  if exists (select 1 from public.ui_events where action not in (
      'open', 'close', 'refresh',
      'filter_target', 'filter_shipping', 'filter_done', 'filter_claim', 'filter_all',
      'order_sync', 'invoice_export', 'ship_issue', 'invoice_upload',
      'cs_create', 'cs_create_order', 'cs_select', 'cs_filter', 'cs_status', 'cs_memo',
      'inv_tab_finished', 'inv_tab_materials', 'inv_save',
      'todo_add', 'todo_done', 'todo_undo', 'cal_add',
      'paper', 'paper_auto', 'brand_open')) then
    raise exception '102 되돌리기: 원자료에 102 낱말이 남아 있음 — 먼저 ui_events_finalize()';
  end if;
end $$;

drop function if exists public.ui_events_start_round(int);

alter table public.ui_events drop constraint if exists ui_events_action_check;
alter table public.ui_events add constraint ui_events_action_check check (action in (
  'open', 'close', 'refresh',
  'filter_target', 'filter_shipping', 'filter_done', 'filter_claim', 'filter_all',
  'order_sync', 'invoice_export', 'ship_issue', 'invoice_upload',
  'cs_create', 'cs_create_order', 'cs_select', 'cs_filter', 'cs_status', 'cs_memo',
  'inv_tab_finished', 'inv_tab_materials', 'inv_save',
  'todo_add', 'todo_done', 'todo_undo', 'cal_add',
  'paper', 'paper_auto', 'brand_open'));

-- 091 의 finalize(회차 없음)
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
    select 'first_screen', screen, count(*) from ui_m_first_screen group by screen;
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

drop index if exists public.ui_usage_summary_round_idx;
alter table public.ui_usage_summary alter column round_no drop not null;
alter table public.ui_events_config drop column if exists started_at;
alter table public.ui_events_config drop column if exists round_no;
