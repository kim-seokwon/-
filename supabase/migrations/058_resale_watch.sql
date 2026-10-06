-- 우리 옷이 중고로 올라오는지 지켜본다.
--  번개장터 공개 검색을 브랜드 이름으로 긁고, 글 제목에 그 이름이 든 것만 남긴다.
--  (중고나라·당근은 네이버 카페 검색 쪽에 붙는다 — 그건 API 키가 있어야 돈다.)
insert into news_sources (kind, query, cafes, bucket, sort) values
  ('bunjang', '하이헤이호',     null, 'resale', 60),
  ('bunjang', '로하이스튜디오',  null, 'resale', 61),
  ('bunjang', '로하이 스튜디오', null, 'resale', 62),
  ('bunjang', 'hiheyho',       null, 'resale', 63)
on conflict do nothing;

-- 중고나라 글은 네이버 카페 검색으로 (키가 들어오면 바로 돈다)
insert into news_sources (kind, query, cafes, bucket, sort) values
  ('cafe', '하이헤이호',    array['중고나라','중고나라 카페'], 'resale', 64),
  ('cafe', '로하이스튜디오', array['중고나라','중고나라 카페'], 'resale', 65)
on conflict do nothing;

notify pgrst, 'reload schema';

-- 중고 거래는 헤이든(네이버 카페)에서 돈다. 여기가 본줄기고 번개장터는 덤이다.
--  카페 검색이라 네이버 API 키가 들어오면 그때부터 잡힌다.
insert into news_sources (kind, query, cafes, bucket, sort) values
  ('cafe', '하이헤이호',     array['헤이든'], 'resale', 70),
  ('cafe', '하이헤이호 판매', array['헤이든'], 'resale', 71),
  ('cafe', '로하이스튜디오',  array['헤이든'], 'resale', 72),
  ('cafe', '토비 아동복',    array['헤이든'], 'resale', 73)
on conflict do nothing;
