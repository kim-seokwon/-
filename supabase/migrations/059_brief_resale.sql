-- 조간에 '중고로 올라온 우리 옷' 칸을 더한다.
--  중고는 소식보다 늦게 올라오기도 해서 기간을 조금 넉넉히(14일) 본다.
create or replace function public.morning_brief(p_days int default 7)
returns json language sql stable security definer set search_path = public as $$
with t as (select (now() at time zone 'Asia/Seoul')::date d),
sel as (
  select kind, source, url, author, thumb, meta,
         case when author is not null and title ilike ('% - ' || author)
              then left(title, length(title) - length(author) - 3) else title end ttl,
         snippet,
         coalesce(published_at, created_at) at_ts,
         published_at is null as no_date
    from news_items
   where case
           --  중고는 '언제 올라왔나' 보다 '우리가 언제 처음 봤나' 가 쓸모 있다.
           --  석 달 전에 올라온 글이라도 오늘 처음 눈에 띄었으면 오늘의 소식이다.
           when kind = 'resale' then created_at >= now() - interval '14 days'
           else coalesce(published_at, created_at) >= now() - (greatest(1, p_days) || ' days')::interval
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
      from dedup where kind = 'news'   order by at_ts desc limit 12) z), '[]'::json),
  'trend',    coalesce((select json_agg(z) from (select title, snippet, url, author, source, thumb, meta, at_ts, no_date
      from dedup where kind = 'trend'  order by at_ts desc limit 12) z), '[]'::json),
  'resale',   coalesce((select json_agg(z) from (select title, snippet, url, author, source, thumb, meta, at_ts, no_date
      from dedup where kind = 'resale' order by at_ts desc limit 10) z), '[]'::json),
  'fresh', (select count(*) from news_items where created_at >= ((select d from t)::timestamp at time zone 'Asia/Seoul'))
);
$$;
revoke all on function public.morning_brief(int) from public, anon;
grant execute on function public.morning_brief(int) to authenticated;
notify pgrst, 'reload schema';
