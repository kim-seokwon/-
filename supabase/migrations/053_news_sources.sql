-- 뉴스 수집 설정 — '어디서 무엇을 찾을지' 를 코드가 아니라 표에 둔다.
--  카페 이름은 네이버 검색 API 가 글마다 cafename 으로 돌려주는 값과 맞춰 거른다.
--  (API 는 카페를 지정해서 못 찾는다. 검색어로 긁은 다음 카페 이름으로 거르는 수밖에 없다.)
create table if not exists news_sources (
  id uuid primary key default gen_random_uuid(),
  kind text not null,                -- cafe | blog | news
  query text not null,               -- 검색어
  cafes text[],                      -- kind='cafe' 일 때만: 이 카페 글만 남긴다
  bucket text not null default 'trend',  -- news_items.kind 로 들어갈 값 (review | trend)
  brand_id uuid references brands(id) on delete set null,
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
alter table news_sources enable row level security;
drop policy if exists ns_sel on news_sources;
create policy ns_sel on news_sources for select to authenticated using (true);
drop policy if exists ns_wr on news_sources;
create policy ns_wr on news_sources for all to authenticated
  using (get_user_role() in ('MASTER','STAFF')) with check (get_user_role() in ('MASTER','STAFF'));

-- 사장님이 지목한 카페 세 곳. 검색어는 아동복 쪽 관심사 + 우리 브랜드 이름.
insert into news_sources (kind, query, cafes, bucket, sort) values
  ('cafe', '아동복',        array['헤이든','맘이베베','맘스홀릭베이비'], 'trend', 10),
  ('cafe', '아기옷 추천',   array['헤이든','맘이베베','맘스홀릭베이비'], 'trend', 11),
  ('cafe', '유아복 공구',   array['헤이든','맘이베베','맘스홀릭베이비'], 'trend', 12),
  ('cafe', '하이헤이호',    array['헤이든','맘이베베','맘스홀릭베이비'], 'review', 20),
  ('cafe', '로하이스튜디오', array['헤이든','맘이베베','맘스홀릭베이비'], 'review', 21),
  ('cafe', '토비 아동복',   array['헤이든','맘이베베','맘스홀릭베이비'], 'review', 22),
  ('blog', '하이헤이호',    null, 'review', 30),
  ('blog', '로하이스튜디오', null, 'review', 31),
  ('news', '아동복 시장',   null, 'trend', 40)
on conflict do nothing;

notify pgrst, 'reload schema';
