-- 110 적용 전 미리 보기 — 읽기만(아무것도 바꾸지 않는다). 운영에서 110 을 깔기 전에 팀장이 돌린다.
--   110 은 칸·표·뷰 추가뿐이라 기존 행 값이 바뀌지 않는다. 확인할 것은 '깔고 나서 뷰에 무엇이 잡힐지'와 선행 조건.
--   기대값: 적용 직후 새 칸은 모두 null(다음 수집부터 채움), ad_fatigue·ad_budget_log 0행.
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'ad_links' and column_name = 'excluded')       as has_108_excluded,  -- 1 이어야 함(108 선행)
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name in ('ad_fatigue', 'ad_budget_log'))              as already_110_tables, -- 0 이면 첫 적용
  (select count(*) from public.ad_links where not coalesce(excluded, false))                      as live_ads,
  (select count(distinct coalesce('m:' || media_id, 'a:' || ad_id)) from public.ad_links
    where not coalesce(excluded, false))                                                          as creatives,          -- v_ad_creative_3d 최대 행 수
  (select count(*) from (select d.ad_id from public.ad_daily d join public.ad_links l using (ad_id)
                          where d.spend > 0 and not coalesce(l.excluded, false)
                          group by d.ad_id having count(*) >= 3) x)                               as ads_3days,          -- 피로 판정 가능 광고 수(지출 3일+)
  (select count(*) from public.ad_daily)                                                           as ad_daily_rows,
  (select count(*) from public.ig_media)                                                           as ig_media_rows;
