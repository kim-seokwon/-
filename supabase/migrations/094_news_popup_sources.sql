-- 094 백화점 키즈 팝업 소식 — 뉴스 '경쟁·유통'(bucket=trend) 칸 수집어 (10-26 사장님 "백화점 키즈브랜드 팝업소식 이런것도 추가되면 좋은데")
--  화면 규칙은 supabase/functions/_shared/news-rules.js isPopupNews — 팝업 + 백화점·유통 + 아동·키즈 낱말이 다 있어야 통과.
--  여기는 수집어만 넣는다. 같은 (kind, query, bucket) 이 이미 있으면 안 넣는다(두 번 깔아도 같다).
--  id 는 고정 uuid(…0940~0943) — 되돌리기가 이 id 만 지운다(094 전부터 있던 같은 검색어 줄은 안 건드림).
--  block: 수집 단계에서 아이돌·공연 팝업을 먼저 버린다(스트레이키즈 = '키즈'가 들어가 규칙만으론 새기 쉽다).
--  kind=blog 도 trend 로 들어간다(news-sync: kind 가 아니라 bucket 이 news_items.kind).
-- 운영 적용 금지(사장님 승인 후 팀장이). 되돌리기: supabase/rollbacks/094_news_popup_sources.down.sql

alter table news_sources add column if not exists block text[];

insert into news_sources (id, kind, query, bucket, block, sort)
select v.id::uuid, v.kind, v.query, 'trend',
       array['스트레이키즈','아이돌','콘서트','팬미팅','굿즈','앨범','뮤지컬','공연','아동복지','복지시설'],
       v.sort
from (values
  ('00000000-0000-4000-8000-000000000940', 'news', '백화점 키즈 팝업',   50),
  ('00000000-0000-4000-8000-000000000941', 'news', '키즈 팝업스토어',    51),
  ('00000000-0000-4000-8000-000000000942', 'news', '아동복 팝업',        52),
  ('00000000-0000-4000-8000-000000000943', 'blog', '백화점 키즈 팝업',   53)
) as v(id, kind, query, sort)
where not exists (select 1 from news_sources s where s.kind = v.kind and s.query = v.query and s.bucket = 'trend')
on conflict (id) do nothing;

notify pgrst, 'reload schema';
