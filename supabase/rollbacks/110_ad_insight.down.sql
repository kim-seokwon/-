-- 110 되돌리기 — 뷰·표·칸을 지운다. 105·107·108 칸은 건드리지 않는다.
--   주의: ad_fatigue(판정 이력)·ad_budget_log(예산 이력)·누적 빈도 스냅샷은 되살릴 수 없다(메타는 과거 누적값을 다시 주지 않는다).
--   지우기 전에 필요하면 내려받아 둘 것:  \copy public.ad_fatigue to 'ad_fatigue.csv' csv header
--   ig_media.caption · ad_links.product_tag(손으로 넣은 상품명)도 같이 사라진다.
drop view if exists public.v_ad_fatigue_latest;
drop view if exists public.v_ad_creative_3d;
drop view if exists public.v_ad_daily_metrics;
drop table if exists public.ad_fatigue;
drop table if exists public.ad_budget_log;
alter table public.ad_daily
  drop column if exists clicks, drop column if exists link_clicks, drop column if exists ctr, drop column if exists frequency,
  drop column if exists cum_reach, drop column if exists cum_impressions, drop column if exists cum_frequency;
alter table public.ad_links
  drop column if exists product_tag, drop column if exists target_age, drop column if exists target_gender,
  drop column if exists target_region, drop column if exists target_summary;
alter table public.ig_media
  drop column if exists caption, drop column if exists media_product_type;
select '110 rolled back' as status;
