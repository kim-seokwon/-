-- 106 광고 판정판 — 광고세트 이름·상태·시작일을 ad_links 에 같이 둔다(세트별 팔로우당 비용 화면).
--   lohi 처럼 광고 이름이 세트마다 같은 경우가 있어 세트명은 따로 받아야 한다. 추가만 하고 기존 열은 건드리지 않는다.
--   채우는 곳: ad-report-sync AD_FIELDS adset{name,effective_status,start_time}. 다음 수집 때부터 채워진다(그 전엔 화면이 광고명·광고상태로 대신 보임).
alter table public.ad_links add column if not exists adset_name   text;
alter table public.ad_links add column if not exists adset_status text;
alter table public.ad_links add column if not exists adset_start  timestamptz;
