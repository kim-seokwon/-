-- 인스타그램 참여지표: 댓글·좋아요 누적 합계(최근 게시물 50개 기준).
--  스토리는 Graph API로 자동수집 불가 → 보류. 대신 comments_count/like_count(instagram_basic로 조회 가능)를 수집.
--  주간 증감은 팔로워와 동일하게 "그 주 마지막 값 - 직전 주 마지막 값"으로 UI에서 계산.
alter table ig_snapshots add column if not exists comments_total integer;  -- 최근 게시물 댓글 수 합계(누적)
alter table ig_snapshots add column if not exists likes_total integer;     -- 최근 게시물 좋아요 수 합계(누적)
