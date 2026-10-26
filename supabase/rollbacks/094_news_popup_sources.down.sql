-- 094 되돌리기 — 094 가 넣은 팝업 수집어 4줄만 지운다. 이미 모인 news_items 는 그대로 둔다(화면 규칙을 되돌리면 경쟁·유통 칸에서 빠진다).
--  094 전부터 있던 같은 검색어 줄은 남긴다 — 094 가 넣은 줄만 sort 50~53 + 094 block 배열로 알아본다.
--  block 칸은 055 가 만든 것이라 남긴다.
delete from news_sources
 where bucket = 'trend'
   and (kind, query, sort) in (('news', '백화점 키즈 팝업', 50), ('news', '키즈 팝업스토어', 51), ('news', '아동복 팝업', 52), ('blog', '백화점 키즈 팝업', 53))
   and block = array['스트레이키즈','아이돌','콘서트','팬미팅','굿즈','앨범','뮤지컬','공연','아동복지','복지시설'];

notify pgrst, 'reload schema';
