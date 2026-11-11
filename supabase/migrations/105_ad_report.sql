-- 105 게시물별 광고리포트 1단계 (기획 .work/광고리포트/기획.md · 지시 11-11)
--  수집: 엣지함수 ad-report-sync(메타 광고 GET만) → ad_links · ad_daily · ad_post_reach · ad_report_state
--        instagram-sync(매시) → ig_media (피드 게시물, 게시일 KST)
--  화면: SNS 탭 '광고 리포트'가 ad_post_cards(게시물 단위 합산) + ad_report_rules(판정선)를 읽고 판정은 화면 순수함수(adReport.js)가 낸다.
--  권한: 읽기는 MASTER·STAFF(is_staff, 087)만. 쓰기는 service role(엣지함수)만 — authenticated 에 쓰기 정책을 두지 않는다.
--  재실행 안전(if not exists · create or replace · on conflict do nothing).
--  되돌리기: supabase/rollbacks/105_ad_report.down.sql

-- 1) 피드 게시물 — instagram-sync 가 /{ig}/media 최신분을 upsert. 게시 시각은 UTC 그대로, 게시일은 KST 날짜.
create table if not exists public.ig_media (
  media_id    text primary key,
  account_id  uuid references public.ig_accounts(id) on delete cascade,
  brand_id    uuid references public.brands(id) on delete set null,
  posted_at   timestamptz not null,
  posted_day  date not null,                 -- KST 날짜 (업로드 경보 N 계산용)
  media_type  text,
  permalink   text,
  thumb_url   text,                          -- 동영상 thumbnail_url (IG CDN — 만료됨, 매 수집 갱신)
  media_url   text,                          -- 이미지 media_url
  fetched_at  timestamptz not null default now()
);
create index if not exists idx_ig_media_brand_day on public.ig_media(brand_id, posted_day desc);

-- 2) 광고 ↔ 게시물 연결. 게시물 키 = creative.source_instagram_media_id(원래 피드 게시물), 없으면 effective_instagram_media_id.
create table if not exists public.ad_links (
  ad_id            text primary key,
  ad_account_id    text not null,
  currency         text,
  campaign_id      text,
  adset_id         text,
  ad_name          text,
  effective_status text,
  daily_budget     integer,                  -- 광고세트 하루 예산(원)
  adset_end        timestamptz,
  ig_user_id       text,
  media_id         text,                     -- null = 게시물 미연결 광고
  media_src        text check (media_src in ('source', 'effective')),
  brand_id         uuid references public.brands(id) on delete set null,
  permalink        text,
  thumb_url        text,
  created_time     timestamptz,
  updated_time     timestamptz,
  last_ok_at       timestamptz,              -- 이 광고 수치를 마지막으로 받은 시각
  last_fail_at     timestamptz,              -- 마지막 실패 시각(last_ok_at 보다 늦으면 '갱신 실패')
  last_error       text,                     -- scrub 된 사유(토큰 없음)
  updated_at       timestamptz not null default now()
);
create index if not exists idx_ad_links_media on public.ad_links(media_id);

-- 3) 광고 × 날짜(KST, 919 = Asia/Seoul) 수치. 매 수집 최근 8일 덮어쓰기(소급 변경), 09시는 28일.
create table if not exists public.ad_daily (
  ad_id          text not null,
  day            date not null,
  media_id       text,                       -- 그날 연결된 게시물(크리에이티브가 바뀌면 그날부터 새 게시물)
  spend          integer not null default 0, -- 원
  impressions    integer not null default 0,
  reach          integer,                    -- 광고 단위 도달(게시물 합산에 쓰지 않는다)
  profile_visits integer not null default 0,
  follows        integer not null default 0, -- instagram_profile_follow (광고 기여 팔로우)
  currency       text,
  fetched_at     timestamptz not null default now(),
  primary key (ad_id, day)
);
create index if not exists idx_ad_daily_media_day on public.ad_daily(media_id, day);

-- 4) 게시물 단위 기간 도달 — 계정 insights(ad.id IN …) 1회 조회값(광고별 도달을 더하지 않는다: 같은 사람이 겹친다)
create table if not exists public.ad_post_reach (
  media_id   text not null,
  since      date not null,
  until      date not null,
  reach      integer not null,
  fetched_at timestamptz not null default now(),
  primary key (media_id, since, until)
);

-- 5) 판정선 — 사장님 확정값(11-10). 코드는 이 값을 읽기만 한다.
--    CPF(팔로워 1명당 원) ≤ up_max → 증액 추천 · up_max < CPF ≤ stop_over → 유지 · CPF > stop_over → 중단 추천
--    판정 조건: 완결일(어제 KST까지 지출 있는 날) ≥ min_days 그리고 누적 지출 ≥ min_spend
--    1일차 조기종료: 완결 1일 · 그날 지출 ≥ 하루 예산 · (팔로우 0 또는 CPF > stop_over × early_mult) → 중단 추천
create table if not exists public.ad_report_rules (
  brand_id          uuid primary key references public.brands(id) on delete cascade,
  test_daily_budget integer not null,
  min_days          integer not null default 2,
  min_spend         integer not null,
  up_max            integer not null,
  stop_over         integer not null,
  early_mult        numeric not null default 2,
  updated_by        text not null default 'seed-105',
  updated_at        timestamptz not null default now(),
  check (up_max < stop_over)
);
insert into public.ad_report_rules (brand_id, test_daily_budget, min_spend, up_max, stop_over)
select b.id, v.budget, v.budget, v.up_max, v.stop_over
  from public.brands b
  join (values ('하이헤이호', 20000, 800, 1300),
               ('로하이스튜디오', 10000, 1000, 1600),
               ('토비', 10000, 1000, 1600)) v(name, budget, up_max, stop_over) on v.name = b.name
on conflict (brand_id) do nothing;

-- 6) 수집 상태 1행 — 화면 머리줄(수집 시각 · 권한오류 띠 · 부분실패 띠)
create table if not exists public.ad_report_state (
  id          integer primary key default 1 check (id = 1),
  last_run_at timestamptz,
  last_ok_at  timestamptz,                   -- 마지막 성공(ok·partial) 시각 — 6시간 넘으면 화면이 '데이터 지연'
  result      text check (result in ('ok', 'partial', 'error')),
  auth_error  boolean not null default false,
  failed_ads  text[] not null default '{}',
  message     text,                          -- scrub 된 요약
  updated_at  timestamptz not null default now()
);

-- 7) 게시물 카드 — 게시물(media_id) 단위 합산. 판정은 하지 않는다(화면 adReport.js).
--    완결 = 어제(KST)까지. 오늘 수치는 따로(상세 표 '진행 중').
create or replace view public.ad_post_cards with (security_invoker = true) as
with t as (select (now() at time zone 'Asia/Seoul')::date as today),
mlinks as (
  select distinct media_id, ad_id from (
    select media_id, ad_id from public.ad_daily where media_id is not null
    union all
    select media_id, ad_id from public.ad_links where media_id is not null and effective_status = 'ACTIVE'
  ) u
),
dm as (
  select d.media_id, d.day, sum(d.spend)::bigint spend, sum(d.follows)::bigint follows,
         sum(d.impressions)::bigint impressions, sum(d.profile_visits)::bigint visits
    from public.ad_daily d where d.media_id is not null group by d.media_id, d.day
),
agg as (
  select dm.media_id,
         min(dm.day) filter (where dm.spend > 0) first_day,
         max(dm.day) filter (where dm.spend > 0) last_day,
         count(*) filter (where dm.day < t.today and dm.spend > 0)::int done_days,
         coalesce(sum(dm.spend) filter (where dm.day < t.today), 0)::bigint done_spend,
         coalesce(sum(dm.follows) filter (where dm.day < t.today), 0)::bigint done_follows,
         coalesce(sum(dm.impressions) filter (where dm.day < t.today), 0)::bigint done_impressions,
         coalesce(sum(dm.visits) filter (where dm.day < t.today), 0)::bigint done_visits,
         max(dm.day) filter (where dm.day < t.today and dm.spend > 0) done_until,
         coalesce(sum(dm.spend) filter (where dm.day = t.today), 0)::bigint today_spend,
         coalesce(sum(dm.follows) filter (where dm.day = t.today), 0)::bigint today_follows,
         sum(dm.spend)::bigint total_spend, sum(dm.follows)::bigint total_follows,
         sum(dm.impressions)::bigint total_impressions, sum(dm.visits)::bigint total_visits
    from dm cross join t group by dm.media_id
),
lk as (
  select m.media_id,
         array_agg(distinct m.ad_id order by m.ad_id) ad_ids,
         string_agg(distinct l.ad_name, ' · ') ad_names,
         array_agg(distinct l.ad_account_id) filter (where l.ad_account_id is not null) ad_accounts,
         array_agg(distinct coalesce(l.currency, '?')) currencies,
         bool_or(coalesce(l.effective_status = 'ACTIVE', false)) any_active,
         bool_or(l.last_fail_at is not null and (l.last_ok_at is null or l.last_fail_at > l.last_ok_at)) any_failed,
         (array_agg(l.brand_id) filter (where l.brand_id is not null))[1] brand_id,
         max(l.permalink) ad_permalink, max(l.thumb_url) ad_thumb,
         max(l.adset_end) adset_end
    from mlinks m left join public.ad_links l on l.ad_id = m.ad_id
   group by m.media_id
),
budget as (
  select m.media_id, sum(x.daily_budget)::int daily_budget
    from (select distinct media_id from mlinks) m
    cross join lateral (
      select distinct l.adset_id, l.daily_budget from public.ad_links l
       where l.media_id = m.media_id and l.effective_status = 'ACTIVE' and l.daily_budget is not null) x
   group by m.media_id
)
select lk.media_id, coalesce(lk.brand_id, im.brand_id) brand_id,
       lk.ad_ids, lk.ad_names, lk.ad_accounts, lk.currencies, lk.any_active, coalesce(lk.any_failed, false) any_failed,
       budget.daily_budget, lk.adset_end,
       agg.first_day, agg.last_day, coalesce(agg.done_days, 0) done_days, agg.done_until,
       coalesce(agg.done_spend, 0) done_spend, coalesce(agg.done_follows, 0) done_follows,
       coalesce(agg.done_impressions, 0) done_impressions, coalesce(agg.done_visits, 0) done_visits,
       coalesce(agg.today_spend, 0) today_spend, coalesce(agg.today_follows, 0) today_follows,
       coalesce(agg.total_spend, 0) total_spend, coalesce(agg.total_follows, 0) total_follows,
       coalesce(agg.total_impressions, 0) total_impressions, coalesce(agg.total_visits, 0) total_visits,
       r.reach, r.since reach_since, r.until reach_until,
       im.posted_at, im.posted_day, im.media_type,
       coalesce(im.permalink, lk.ad_permalink) permalink,
       coalesce(im.thumb_url, im.media_url, lk.ad_thumb) thumb_url
  from lk
  left join agg on agg.media_id = lk.media_id
  left join budget on budget.media_id = lk.media_id
  left join public.ig_media im on im.media_id = lk.media_id
  left join lateral (select pr.reach, pr.since, pr.until from public.ad_post_reach pr
                      where pr.media_id = lk.media_id order by pr.fetched_at desc, pr.until desc limit 1) r on true;

-- 8) RLS — 읽기 MASTER·STAFF, 쓰기 service role 만
alter table public.ig_media        enable row level security;
alter table public.ad_links        enable row level security;
alter table public.ad_daily        enable row level security;
alter table public.ad_post_reach   enable row level security;
alter table public.ad_report_rules enable row level security;
alter table public.ad_report_state enable row level security;

do $$
declare t text;
begin
  foreach t in array array['ig_media', 'ad_links', 'ad_daily', 'ad_post_reach', 'ad_report_rules', 'ad_report_state'] loop
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
    execute format('drop policy if exists %I on public.%I', t || '_staff_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_staff())', t || '_staff_read', t);
  end loop;
end $$;
revoke all on public.ad_post_cards from anon, authenticated;
grant select on public.ad_post_cards to authenticated, service_role;

-- 9) 크론 — 이 파일에서는 걸지 않는다(배포 승인 뒤 팀장이 SQL Editor 에서). 09·12·15·18·21시 KST = 00·03·06·09·12 UTC.
--    ⚠ '<CRON_SECRET>' 를 함수 시크릿 CRON_SECRET 값으로 바꿔 실행(이 파일에 원문을 적지 말 것). 함수 시크릿 META_ADS_TOKEN 먼저.
-- select cron.unschedule('ad-report-sync') where exists (select 1 from cron.job where jobname = 'ad-report-sync');
-- select cron.schedule('ad-report-sync', '0 0,3,6,9,12 * * *', $$
--   select net.http_post(
--     url     := 'https://czaykmmwzlcisozmbxpl.supabase.co/functions/v1/ad-report-sync',
--     headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
--     body    := '{}'::jsonb);
-- $$);
