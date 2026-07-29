-- 롤백: 015에서 하이헤이호 자격증명을 로하이로 복사한 것 무효화.
-- 로하이(thehimeseller)는 별도 카페24 계정이라 하이헤이호 앱 client_id/secret이 안 맞음.
-- 잘못된 자격증명 제거 → 로하이 재인증은 그 몰 전용 앱 등록으로 별도 진행.
UPDATE channel_sync_state
SET client_id = NULL, client_secret = NULL, access_token = NULL, refresh_token = NULL
WHERE mall_key = 'rohi';
