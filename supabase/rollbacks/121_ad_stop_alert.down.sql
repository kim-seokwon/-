-- 121 되돌리기 — 알림 기록 표만 지운다(광고 데이터는 안 건드림). 지우면 다음 알림 때 진행 중인 중단 세트가 한 번씩 다시 온다.
drop table if exists public.ad_stop_alert;
drop function if exists public.ad_stop_alert_can_read(uuid);
