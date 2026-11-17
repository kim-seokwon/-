-- 112 되돌리기 — halt 기록을 지우고 rule check 를 111 로 돌린다
delete from public.order_alert_log where rule = 'halt';
alter table public.order_alert_log drop constraint if exists order_alert_log_rule_check;
alter table public.order_alert_log add constraint order_alert_log_rule_check check (rule in ('fail', 'stale', 'zero'));
