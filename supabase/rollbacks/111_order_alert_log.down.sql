-- 111 되돌리기 — 알림 기록 표를 지운다(보낸 기록만 사라짐. 주문·수집 기록은 그대로).
drop table if exists public.order_alert_log;
select '111 rolled back' as status;
