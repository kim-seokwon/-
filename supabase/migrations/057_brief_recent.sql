-- 조간은 '최근' 만 싣는다. 1년 전 기사가 1면에 걸리면 그건 신문이 아니다.
--  기본 7일. 사진(thumb)과 인스타 반응(좋아요·댓글)도 같이 넘긴다 — 1면에 그림이 들어가야 신문이다.
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
   where coalesce(published_at, created_at) >= now() - (greatest(1, p_days) || ' days')::interval
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
  'fresh', (select count(*) from news_items where created_at >= ((select d from t)::timestamp at time zone 'Asia/Seoul'))
);
$$;
revoke all on function public.morning_brief(int) from public, anon;
grant execute on function public.morning_brief(int) to authenticated;
drop function if exists public.morning_brief();
notify pgrst, 'reload schema';

-- '키즈' 로 찾으면 스트레이 키즈 같은 아이돌 기사가 걸린다. 트렌드 칸에 아이돌은 필요 없다.
update news_sources
   set block = coalesce(block, '{}') ||
       array['스트레이키즈','스트레이 키즈','아이돌','걸그룹','보이그룹','팬미팅','콘서트','신곡','컴백','멤버']
 where query ilike '%키즈%' or query ilike '%트렌드%';
delete from news_items
 where coalesce(title,'') ~ '(스트레이 ?키즈|아이돌|걸그룹|보이그룹|팬미팅|컴백)';

-- 인스타 글은 제목·본문 가르는 방식을 바꿨다. 한 번 비우고 다시 받는다.
delete from news_items where source = 'instagram';
