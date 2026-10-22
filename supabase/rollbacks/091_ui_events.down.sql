-- 091 되돌리기 — 사용 기록 표·지표 뷰·집계·기간 설정을 걷는다. ⚠ 쌓인 기록·집계가 함께 사라진다
--   (필요하면 먼저: select * from ui_usage_summary; / select * from ui_events;)
-- is_staff()(087)·is_master()(090) 는 다른 마이그레이션도 쓰므로 남긴다.
drop function if exists public.ui_events_finalize();
drop view if exists public.ui_m_first_screen, public.ui_m_open_top, public.ui_m_task_clicks, public.ui_m_quick_close, public.ui_m_unused;
drop table if exists public.ui_usage_summary;
drop table if exists public.ui_events;
drop function if exists public.ui_events_until();
drop table if exists public.ui_events_config;
