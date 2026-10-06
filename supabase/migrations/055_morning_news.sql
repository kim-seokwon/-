-- 조간을 '소식만' 으로 되돌린다.
--  매출·할 일·시즌은 대시보드가 이미 보여 준다. 아침에 한 번 보는 건 바깥 이야기여야 한다.
--  세 칸으로 나눈다: ① 우리 브랜드 글 ② 아동복 소식 ③ 트렌드(엄마들이 뭘 찾나)
create or replace function public.morning_brief()
returns json language sql stable security definer set search_path = public as $$
with t as (select (now() at time zone 'Asia/Seoul')::date d),
sel as (
  select kind, source, title, snippet, url, author,
         coalesce(published_at, created_at) at_ts,
         published_at is null as no_date
    from news_items
)
select json_build_object(
  'date', (select d from t),
  'ours', coalesce((select json_agg(z) from (
      select title, snippet, url, author, source, at_ts, no_date
        from sel where kind = 'review' order by at_ts desc limit 10) z), '[]'::json),
  'industry', coalesce((select json_agg(z) from (
      select title, snippet, url, author, source, at_ts, no_date
        from sel where kind = 'news' order by at_ts desc limit 12) z), '[]'::json),
  'trend', coalesce((select json_agg(z) from (
      select title, snippet, url, author, source, at_ts, no_date
        from sel where kind = 'trend' order by at_ts desc limit 12) z), '[]'::json),
  -- 어제 이후 새로 들어온 것 수 — 제호 옆에 '오늘 새 소식 n건'
  'fresh', (select count(*) from news_items where created_at >= ((select d from t)::timestamp at time zone 'Asia/Seoul'))
);
$$;

-- 업계 뉴스는 'news' 칸으로 간다 (지금은 트렌드로 섞여 있었다)
update news_sources set bucket = 'news' where kind = 'news';

-- 아동복 소식 검색어를 넓힌다 — 구글 뉴스는 열쇠가 없어도 도니 여기부터 채운다
insert into news_sources (kind, query, cafes, bucket, sort) values
  ('news', '아동복',        null, 'news',  41),
  ('news', '키즈패션',      null, 'news',  42),
  ('news', '유아동 브랜드', null, 'news',  43),
  ('news', '하이헤이호',    null, 'review', 44),
  ('news', '로하이스튜디오', null, 'review', 45)
on conflict do nothing;

notify pgrst, 'reload schema';

-- 먼저 들어와 있던 구글 기사들이 '트렌드' 칸에 섞여 있었다. 트렌드 칸은 카페·블로그 글 자리다.
update news_items set kind = 'news'
 where kind = 'trend' and source in ('google','google_news')
   and not exists (select 1 from news_items n2 where n2.kind='news' and n2.url = news_items.url);
delete from news_items where kind = 'trend' and source in ('google','google_news');

-- 네이버 열쇠가 없는 동안에도 트렌드 칸이 비지 않게 — 트렌드성 검색어를 구글 뉴스로
insert into news_sources (kind, query, cafes, bucket, sort) values
  ('news', '아동복 트렌드',   null, 'trend', 50),
  ('news', '키즈 패션 트렌드', null, 'trend', 51),
  ('news', '육아 트렌드',     null, 'trend', 52)
on conflict do nothing;

-- 이미 들어온 '우리 이야기' 중 우리 이름이 없는 글은 뺀다 (구글이 느슨하게 물어온 것들)
delete from news_items
 where kind = 'review'
   and coalesce(title,'') !~* '(하이헤이호|로하이스튜디오|hiheiho|rohistudio)';
--  '로하이' 만 쓰면 동명이인(철권 선수)이 걸린다. 브랜드 전체 이름으로만 맞춘다.

-- '아동복' 으로 찾으면 '아동복지시설' 기사가 쏟아진다. 검색어마다 걸러낼 말을 둔다.
alter table news_sources add column if not exists block text[];
update news_sources set block = array['아동복지','복지시설','보육원','아동학대']
 where query like '%아동복%' or query like '%육아%';
delete from news_items where coalesce(title,'') ~ '(아동복지|복지시설|보육원|아동학대)';
