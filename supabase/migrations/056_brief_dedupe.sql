-- 같은 기사를 여러 매체가 받아써서 목록이 같은 제목으로 찬다. 읽을 때 한 줄로 묶는다.
--  제목 끝의 ' - 매체명' 도 뗀다 (출처는 따로 보여 주니 두 번 적을 일이 없다).
create or replace function public.morning_brief()
returns json language sql stable security definer set search_path = public as $$
with t as (select (now() at time zone 'Asia/Seoul')::date d),
sel as (
  select kind, source, url, author,
         case when author is not null and title ilike ('% - ' || author)
              then left(title, length(title) - length(author) - 3) else title end ttl,
         snippet,
         coalesce(published_at, created_at) at_ts,
         published_at is null as no_date
    from news_items
),
dedup as (
  select distinct on (kind, lower(regexp_replace(ttl, '\s', '', 'g')))
         kind, source, url, author, ttl title, snippet, at_ts, no_date
    from sel
   order by kind, lower(regexp_replace(ttl, '\s', '', 'g')), at_ts desc
),
pick as (select * from dedup)
select json_build_object(
  'date', (select d from t),
  'ours',     coalesce((select json_agg(z) from (select title, snippet, url, author, source, at_ts, no_date
      from pick where kind = 'review' order by at_ts desc limit 10) z), '[]'::json),
  'industry', coalesce((select json_agg(z) from (select title, snippet, url, author, source, at_ts, no_date
      from pick where kind = 'news'   order by at_ts desc limit 12) z), '[]'::json),
  'trend',    coalesce((select json_agg(z) from (select title, snippet, url, author, source, at_ts, no_date
      from pick where kind = 'trend'  order by at_ts desc limit 12) z), '[]'::json),
  'fresh', (select count(*) from news_items where created_at >= ((select d from t)::timestamp at time zone 'Asia/Seoul'))
);
$$;
notify pgrst, 'reload schema';
