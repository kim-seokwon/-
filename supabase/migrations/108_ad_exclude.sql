-- 108 광고 데이터 제외 — 목표를 잘못 설정한 광고세트를 판정·합계에서 뺀다(데이터는 지우지 않는다).
--   사장님 2026-11-16: "광고데이터중에 저번에 목표잘못설정해서 과도하게 높게나온건 데이터로 잡지마"
--   대상: 11/11 API로 만든 optimization_goal=VISIT_INSTAGRAM_PROFILE 세트 4개(팀장 Graph 확인) — 지출 84,553원·팔로우 18.
--   · ad_links.excluded / excluded_reason — 표시만. ad-report-sync upsert 는 이 두 열을 보내지 않아 덮어쓰지 않는다.
--   · 같은 세트에 광고가 새로 들어와도 제외가 따라가게 insert 트리거(세트에 제외 광고가 하나라도 있으면 같이 제외).
--   · 화면 판정판(adPanel.js)은 excluded 행을 빼고 '제외 N세트' 를 작게 보인다. 게시물 카드 뷰(ad_post_cards)도 제외분을 뺀다.
--   되돌리기: supabase/rollbacks/108_ad_exclude.down.sql
alter table public.ad_links add column if not exists excluded        boolean not null default false;
alter table public.ad_links add column if not exists excluded_reason text;

update public.ad_links
   set excluded = true,
       excluded_reason = '목표 오류(VISIT_INSTAGRAM_PROFILE, 11/11 생성) — 팔로우당 비용 과대'
 where adset_id in ('120255644017600038',   -- hhh_멜로우오버롤
                    '120255644017680038',   -- lohi_FW피그먼트
                    '120255644017700038',   -- lohi_플리스재킷
                    '120255666999860038');  -- tovee_0901가을_boost

create or replace function public.ad_links_inherit_excluded() returns trigger
language plpgsql set search_path = public as $$
begin
  if not new.excluded and new.adset_id is not null then
    select true, l.excluded_reason into new.excluded, new.excluded_reason
      from public.ad_links l where l.adset_id = new.adset_id and l.excluded and l.ad_id <> new.ad_id limit 1;
    new.excluded := coalesce(new.excluded, false);
  end if;
  return new;
end $$;
drop trigger if exists trg_ad_links_inherit_excluded on public.ad_links;
create trigger trg_ad_links_inherit_excluded before insert on public.ad_links
  for each row execute function public.ad_links_inherit_excluded();

-- 게시물 카드 뷰 — 105 정의 그대로에 제외 광고만 뺀다(열·순서 동일, create or replace 가능)
create or replace view public.ad_post_cards with (security_invoker = true) as
with t as (select (now() at time zone 'Asia/Seoul')::date as today),
mlinks as (
  select distinct media_id, ad_id from (
    select d.media_id, d.ad_id from public.ad_daily d where d.media_id is not null
       and not exists (select 1 from public.ad_links x where x.ad_id = d.ad_id and x.excluded)
    union all
    select media_id, ad_id from public.ad_links where media_id is not null and effective_status = 'ACTIVE' and not excluded
  ) u
),
dm as (
  select d.media_id, d.day, sum(d.spend)::bigint spend, sum(d.follows)::bigint follows,
         sum(d.impressions)::bigint impressions, sum(d.profile_visits)::bigint visits
    from public.ad_daily d where d.media_id is not null
       and not exists (select 1 from public.ad_links x where x.ad_id = d.ad_id and x.excluded)
     group by d.media_id, d.day
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
       where l.media_id = m.media_id and l.effective_status = 'ACTIVE' and l.daily_budget is not null and not l.excluded) x
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
