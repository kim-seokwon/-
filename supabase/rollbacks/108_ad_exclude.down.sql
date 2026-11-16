-- 108 되돌리기 — 뷰를 105 정의로 되돌리고 트리거·열을 지운다(제외 표시만 사라지고 원본 수치는 그대로).
--   먼저 화면(adPanel.js 제외 처리)을 108 이전으로 되돌리지 않아도 된다 — 열이 없으면 화면은 제외 없이 계산한다.
drop trigger if exists trg_ad_links_inherit_excluded on public.ad_links;
drop function if exists public.ad_links_inherit_excluded();
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

alter table public.ad_links drop column if exists excluded_reason;
alter table public.ad_links drop column if exists excluded;
