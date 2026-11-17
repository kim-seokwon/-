-- 111 주문 수집 알림 기록 — 같은 알림을 하루 1번만 보내기 위한 표 (11-17 팀장)
--   배경: 29CM 이 11-10~11-16 7회 연속 수집 실패(invalid_grant)했는데 아무도 몰랐다.
--   channel-bots/telegram/order-alert.mjs 가 텔레그램으로 보낸 뒤 (KST 날짜, 몰, 규칙)을 남긴다. 규칙은 orderAlerts.js.
--   rule: fail(수집 연속 실패) · stale(실패 기록 없이 멈춤) · zero(평소 팔리는 몰이 2일 연속 0건)
-- 운영 적용 금지(사장님 승인 후 팀장이). 되돌리기: supabase/rollbacks/111_order_alert_log.down.sql

create table if not exists public.order_alert_log (
  day       date not null,                 -- KST
  mall_key  text not null,
  rule      text not null check (rule in ('fail', 'stale', 'zero')),
  detail    jsonb not null default '{}'::jsonb,   -- 보낸 문장
  sent_at   timestamptz not null default now(),
  primary key (day, mall_key, rule)
);

-- 권한 — 직원 읽기, 쓰기는 service_role(알림 스크립트)만 (110 과 같은 틀)
alter table public.order_alert_log enable row level security;
revoke all on table public.order_alert_log from anon, authenticated;
grant select on table public.order_alert_log to authenticated;
grant all on table public.order_alert_log to service_role;
drop policy if exists order_alert_log_staff_read on public.order_alert_log;
create policy order_alert_log_staff_read on public.order_alert_log for select to authenticated using (public.is_staff());

-- 몰별 알림 스위치 — 일부러 수집을 끈 몰은 알림에서 뺀다(화면 상태 점은 그대로 보인다)
--   스마트스토어(08-18 예약 중지, 미연결)·키디키디(봇 복구 전 수동 실행만)는 꺼서 시작한다. 수집을 다시 켜면 true 로.
alter table public.malls add column if not exists alert_enabled boolean not null default true;
update public.malls set alert_enabled = false where mall_key in ('smartstore', 'kidikidi');

select '111 order alert log installed' as status;
