-- 111 되돌리기 — 알림 기록 표와 몰 알림 스위치를 지운다(주문·수집 기록은 그대로).
drop table if exists public.order_alert_log;
alter table public.malls drop column if exists alert_enabled;
select '111 rolled back' as status;
