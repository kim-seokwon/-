-- 112 주문 알림 규칙 추가 — halt(판매 멈춤: 그 앞 30일에 주문이 있었는데 7일 연속 0건, 주 1회) (11-17 팀장)
--   배경: 29CM 하이헤이호가 11-05부터 0건인데 zero 규칙은 '직전 7일 평균'이 0이 되면서 영영 안 울린다.
--   111 의 rule check 에 'halt' 를 더한다. 규칙 자체는 orderAlerts.js haltDrop. 주 1회는 스크립트가 최근 7일 기록을 보고 막는다.
-- 운영 적용 금지(사장님 승인 후 팀장이). 되돌리기: supabase/rollbacks/112_order_alert_halt.down.sql

alter table public.order_alert_log drop constraint if exists order_alert_log_rule_check;
alter table public.order_alert_log add constraint order_alert_log_rule_check check (rule in ('fail', 'stale', 'zero', 'halt'));

select '112 order alert halt installed' as status;
