-- 110 광고 인사이트 — 성과 축적(브랜드×속성) + 피로도 판정 근거 (11-17 사장님)
--   사장님: "브랜드마다 광고 성과 데이터가 쌓이니까 그걸로 브랜드에 맞는 광고를 찾아가는 형태도 있어야돼.
--            그리고 광고는 피로도가 쌓이면서 효율이 떨어지니 그것도 객관적 검증할 방법이 필요해"
--
-- 판정 규칙은 SQL 이 아니라 supabase/functions/_shared/ad-insight.js 한 곳에 있다(화면·수집기·테스트가 같이 쓴다).
--   수집기(ad-report-sync)가 매 수집 뒤 그 규칙으로 ad_fatigue 를 채운다. 이 파일은 칸·표·뷰만 만든다.
--
-- 1) ad_daily 칸 추가 — clicks · link_clicks · ctr(메타 값, %) · frequency(그날)
--      + 누적 스냅샷 cum_reach · cum_impressions · cum_frequency(광고 시작~그날, 그날 수집 시점 값).
--      일별 frequency 는 실측 1.00~1.13 으로 움직이지 않아 피로 신호가 못 된다 → 누적값으로 본다.
--      누적값은 '그날 수집했을 때'만 채워진다(과거 날짜는 비어 있음 = 미확인).
-- 2) ad_budget_log — 광고별 하루 예산 스냅샷(세트 예산, 없으면 캠페인 예산). 예산이 바뀐 날을 찾는 데 쓴다.
--      실측: hhh_1010 은 캠페인 예산(5만→8만, 10-15)이라 세트 daily_budget 만 보면 변경을 놓친다.
-- 3) ad_links 칸 — product_tag(상품 수동 지정, 비면 세트 이름 규칙) · 타기팅 요약(나이·성별·지역·한 줄)
-- 4) ig_media 칸 — caption · media_product_type(REELS 구분). instagram-sync 가 채운다.
-- 5) ad_fatigue — 광고×날짜 판정(신선/주의/피로/보류) + 근거(기준→현재 1명당 비용·누적빈도·CTR)
-- 6) 뷰 — v_ad_daily_metrics(일별 + 링크CTR) · v_ad_creative_3d(게시물 첫 3일) · v_ad_fatigue_latest(광고별 최신 판정)
-- 건수 미리 보기: supabase/rehearsals/110_ad_insight_dryrun.sql (읽기만)
-- 운영 적용 금지(사장님 승인 후 팀장이). 되돌리기: supabase/rollbacks/110_ad_insight.down.sql

-- 1) 일별 칸
alter table public.ad_daily
  add column if not exists clicks          integer,
  add column if not exists link_clicks     integer,
  add column if not exists ctr             numeric(7,3),
  add column if not exists frequency       numeric(8,4),
  add column if not exists cum_reach       integer,
  add column if not exists cum_impressions integer,
  add column if not exists cum_frequency   numeric(8,4);

-- 2) 예산 스냅샷 — 하루 한 행(그날 마지막 수집 값)
create table if not exists public.ad_budget_log (
  ad_id         text not null,
  day           date not null,                -- KST
  daily_budget  integer,                      -- 세트 예산, 없으면 캠페인 예산(원)
  budget_level  text check (budget_level in ('adset', 'campaign')),
  seen_at       timestamptz not null default now(),
  primary key (ad_id, day)
);

-- 3) 광고 칸
alter table public.ad_links
  add column if not exists product_tag    text,   -- 손으로 지정한 상품명(세트 이름 규칙보다 우선)
  add column if not exists target_age     text,   -- 예: '25-44'
  add column if not exists target_gender  text,   -- '전체' · '여성' · '남성'
  add column if not exists target_region  text,   -- 예: '대한민국' / '서울 외 2'
  add column if not exists target_summary text;   -- 한 줄 요약(관심사·맞춤타겟 포함). 없으면 화면은 '—'

-- 4) 게시물 칸
alter table public.ig_media
  add column if not exists caption            text,
  add column if not exists media_product_type text;   -- FEED · REELS · STORY …

-- 5) 피로도 판정
create table if not exists public.ad_fatigue (
  ad_id         text not null,
  day           date not null,                -- 판정 기준일(3일 창의 마지막 날)
  state         text not null check (state in ('fresh', 'warn', 'tired', 'hold')),
  baseline_cpf  integer,                      -- 기준 3일 1명당 비용(원)
  baseline_from date,
  baseline_to   date,
  current_cpf   integer,                      -- 최근 3일 1명당 비용
  worse_pct     numeric(7,3),                 -- current/baseline - 1 (0.30 = 30% 나쁨)
  run_days      integer not null default 0,   -- 나쁜 날 연속 수
  freq_from     numeric(8,4),                 -- 기준 창 끝 누적 빈도
  freq_to       numeric(8,4),                 -- 지금 누적 빈도
  ctr_from      numeric(7,3),                 -- 기준 창 링크 CTR(%)
  ctr_to        numeric(7,3),
  tired_since   date,                         -- 피로 조건을 다 채운 날(같은 나쁜 구간 안에서 유지)
  last_change   date,                         -- 마지막 예산 변경일(기준을 이 뒤로 다시 잡음)
  reasons       jsonb not null default '[]'::jsonb,  -- 화면에 그대로 보이는 근거 문장
  spend_days    integer not null default 0,   -- 지출 있는 날 수
  is_measurable boolean not null default false, -- 장기 판정 가능(지출 6일+). 아니면 화면에서 '단기·측정 제외 N'으로 접는다
  rule_version  text not null default '110-2',
  judged_at     timestamptz not null default now(),
  primary key (ad_id, day)
);
create index if not exists idx_ad_fatigue_ad_day on public.ad_fatigue(ad_id, day desc);
--   판정 대상 구분 칸 — 위 create 가 이미 있던 표(110-1 리허설)에도 붙게
alter table public.ad_fatigue
  add column if not exists spend_days    integer not null default 0,
  add column if not exists is_measurable boolean not null default false;

-- 권한 — 105 와 같은 틀(직원 읽기, 쓰기는 service_role 수집기만)
do $$
declare t text;
begin
  foreach t in array array['ad_budget_log', 'ad_fatigue'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
    execute format('drop policy if exists %I on public.%I', t || '_staff_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_staff())', t || '_staff_read', t);
  end loop;
end $$;

-- 6) 뷰 (security_invoker — 읽는 사람 권한 그대로)
--   6-1 일별 + 링크 CTR(링크클릭/노출). 제외 광고(108)는 뺀다.
create or replace view public.v_ad_daily_metrics with (security_invoker = true) as
select d.ad_id, d.day, d.media_id, l.brand_id, l.adset_id, l.adset_name, l.ad_name,
       d.spend, d.impressions, d.reach, d.follows, d.profile_visits, d.clicks, d.link_clicks, d.ctr, d.frequency,
       d.cum_reach, d.cum_impressions, d.cum_frequency, d.currency,
       case when d.impressions > 0 and d.link_clicks is not null
            then round(d.link_clicks::numeric * 100 / d.impressions, 2) end as link_ctr,
       case when d.follows > 0 then round(d.spend::numeric / d.follows) end as cpf
  from public.ad_daily d
  join public.ad_links l on l.ad_id = d.ad_id
 where not coalesce(l.excluded, false);

--   6-2 게시물(크리에이티브) 첫 3일 — ad-insight.js creativesOf 와 같은 규칙:
--       같은 게시물에 광고가 여럿이면 날짜별로 합치고, 지출 있는 날 앞 3일만 센다. 게시물 없는 광고는 광고 단위.
--       product 는 product_tag 만 담는다(이름 규칙 추출은 JS productOf — 화면이 채움).
create or replace view public.v_ad_creative_3d with (security_invoker = true) as
with keyed as (
  select coalesce('m:' || l.media_id, 'a:' || l.ad_id) as key, l.*
    from public.ad_links l
   where not coalesce(l.excluded, false)
), per_day as (
  select k.key, d.day, sum(d.spend) as spend, sum(d.follows) as follows
    from keyed k join public.ad_daily d on d.ad_id = k.ad_id
   where d.spend > 0
   group by k.key, d.day
), ranked as (
  select p.*, row_number() over (partition by p.key order by p.day) as rn from per_day p
), first3 as (
  select key, count(*)::int as days, min(day) as first_day, sum(spend)::bigint as spend3, sum(follows)::bigint as follows3
    from ranked where rn <= 3 group by key
), meta as (
  select distinct on (key) key, brand_id, media_id, product_tag, adset_name, ad_name
    from keyed order by key, created_time nulls last, ad_id
)
select f.key, m.brand_id, m.media_id, m.product_tag, m.adset_name, m.ad_name,
       g.media_type, g.media_product_type, g.posted_day, g.caption,
       f.days, f.first_day, f.spend3, f.follows3,
       case when f.follows3 > 0 then round(f.spend3::numeric / f.follows3) end as cpf3
  from first3 f
  join meta m on m.key = f.key
  left join public.ig_media g on g.media_id = m.media_id;

--   6-3 광고별 최신 판정 — 화면 기본은 is_measurable 만, 나머지는 '단기·측정 제외 N'으로 접는다(정렬은 화면: is_measurable desc)
create or replace view public.v_ad_fatigue_latest with (security_invoker = true) as
select distinct on (f.ad_id)
       f.*, l.brand_id, l.media_id, l.ad_name, l.adset_name, l.effective_status
  from public.ad_fatigue f
  join public.ad_links l on l.ad_id = f.ad_id
 where not coalesce(l.excluded, false)
 order by f.ad_id, f.day desc;

revoke all on public.v_ad_daily_metrics, public.v_ad_creative_3d, public.v_ad_fatigue_latest from anon, authenticated;
grant select on public.v_ad_daily_metrics, public.v_ad_creative_3d, public.v_ad_fatigue_latest to authenticated, service_role;

select '110 ad insight installed' as status;
