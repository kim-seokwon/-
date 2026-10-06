-- 7일로 잘랐더니 '아미 키즈 론칭' 같은 트렌드 기사가 통째로 사라졌다.
--  소식마다 유통기한이 다르다 — 우리 글은 일주일이 지나면 묵은 것이지만,
--  시장 흐름을 짚는 기사는 한두 달 지나도 읽을 값어치가 있다. 칸마다 기간을 달리 준다.
--    우리 이야기 7일 · 아동복 소식 21일 · 트렌드 60일 · 중고 14일(우리가 처음 본 날 기준)
create or replace function public.morning_brief(p_days int default 7)
returns json language sql stable security definer set search_path = public as $$
with t as (select (now() at time zone 'Asia/Seoul')::date d),
win as (
  select 'review'::text k, greatest(1, p_days) n union all
  select 'news',   greatest(21, p_days) union all
  select 'trend',  greatest(60, p_days) union all
  select 'resale', 14
),
sel as (
  select i.kind, i.source, i.url, i.author, i.thumb, i.meta,
         case when i.author is not null and i.title ilike ('% - ' || i.author)
              then left(i.title, length(i.title) - length(i.author) - 3) else i.title end ttl,
         i.snippet,
         coalesce(i.published_at, i.created_at) at_ts,
         i.published_at is null as no_date
    from news_items i
    join win w on w.k = i.kind
   where case
           when i.kind = 'resale' then i.created_at >= now() - (w.n || ' days')::interval
           else coalesce(i.published_at, i.created_at) >= now() - (w.n || ' days')::interval
         end
),
dedup as (
  select distinct on (kind, lower(regexp_replace(ttl, '\s', '', 'g')))
         kind, source, url, author, thumb, meta, ttl title, snippet, at_ts, no_date
    from sel
   order by kind, lower(regexp_replace(ttl, '\s', '', 'g')), at_ts desc
)
select json_build_object(
  'date', (select d from t),
  'days', greatest(1, p_days),
  'ours',     coalesce((select json_agg(z) from (select title, snippet, url, author, source, thumb, meta, at_ts, no_date
      from dedup where kind = 'review' order by at_ts desc limit 10) z), '[]'::json),
  'industry', coalesce((select json_agg(z) from (select title, snippet, url, author, source, thumb, meta, at_ts, no_date
      from dedup where kind = 'news'   order by at_ts desc limit 14) z), '[]'::json),
  'trend',    coalesce((select json_agg(z) from (select title, snippet, url, author, source, thumb, meta, at_ts, no_date
      from dedup where kind = 'trend'  order by at_ts desc limit 14) z), '[]'::json),
  'resale',   coalesce((select json_agg(z) from (select title, snippet, url, author, source, thumb, meta, at_ts, no_date
      from dedup where kind = 'resale' order by at_ts desc limit 10) z), '[]'::json),
  'fresh', (select count(*) from news_items where created_at >= ((select d from t)::timestamp at time zone 'Asia/Seoul'))
);
$$;
revoke all on function public.morning_brief(int) from public, anon;
grant execute on function public.morning_brief(int) to authenticated;
notify pgrst, 'reload schema';
