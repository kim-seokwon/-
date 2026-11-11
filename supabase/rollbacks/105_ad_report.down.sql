-- 105 되돌리기 — 광고리포트 테이블·뷰·크론을 걷는다. 수집값은 메타에서 다시 받을 수 있어 보존하지 않는다.
-- 판정선(ad_report_rules)을 사람이 바꿔 둔 경우(updated_by <> 'seed-105')는 지우지 않고 멈춘다.
do $$
begin
  if to_regclass('public.ad_report_rules') is not null then
    if exists (select 1 from public.ad_report_rules where updated_by <> 'seed-105') then
      raise exception '105 되돌리기: 사람이 바꾼 판정선이 있음 — 값을 옮겨 적은 뒤 다시 실행';
    end if;
  end if;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'ad-report-sync';
  end if;
end $$;

drop view if exists public.ad_post_cards;
drop table if exists public.ad_report_state;
drop table if exists public.ad_report_rules;
drop table if exists public.ad_post_reach;
drop table if exists public.ad_daily;
drop table if exists public.ad_links;
drop table if exists public.ig_media;
