-- ============================================================
--  홈 "N분 전 동기화" 가 항상 '동기화 정보 없음' 이던 문제
--  프론트가 malls.last_order_synced_at 을 읽는데 그 컬럼은 malls 에 없다.
--  실제 값은 channel_sync_state 에 있고, 그 테이블은 access_token/client_secret 이 들어 있어
--  RLS 로 서비스롤 전용이라 클라이언트가 읽을 수 없다.
--  → 토큰·비밀키를 뺀 '동기화 상태'만 노출하는 뷰를 따로 만든다.
--  security_invoker 를 쓰지 않는다(=뷰 소유자 권한). 원본 테이블 RLS를 우회해야 하는데,
--  대신 컬럼 자체에 비밀값이 없고 authenticated 에게만 권한을 준다.
-- ============================================================
create or replace view channel_sync_status as
select mall_key, channel, cafe24_mall_id, last_order_synced_at, dry_run, updated_at
from channel_sync_state;

revoke all on channel_sync_status from anon;
grant select on channel_sync_status to authenticated;
