-- 107 되돌리기 — 추가한 세 열만 지운다(수집이 다시 채우는 값이라 잃는 원본 없음). 먼저 ad-report-sync 를 107 이전 버전으로 되돌린 뒤 실행.
alter table public.ad_links drop column if exists adset_start;
alter table public.ad_links drop column if exists adset_status;
alter table public.ad_links drop column if exists adset_name;
