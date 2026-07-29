-- 로하이(rohi) 재인증: 자기 계정(thehimeseller)의 앱 BHAS재고연동 client_id 등록.
-- client_secret은 applyEnvSecret 폴백으로 Supabase 볼트 CAFE24_SECRET_THEHIMESELLER 사용(사용자가 넣음).
-- Redirect URI는 이미 함수URL과 일치 확인됨. 토큰은 비워 OAuth 재발급 유도.
INSERT INTO channel_sync_state (mall_key, channel, cafe24_mall_id, client_id, dry_run)
VALUES ('rohi', 'cafe24', 'thehimeseller', 'H0YjEAvpNhQjNSA8m2KC4A', TRUE)
ON CONFLICT (mall_key) DO UPDATE
SET cafe24_mall_id = 'thehimeseller',
    client_id      = 'H0YjEAvpNhQjNSA8m2KC4A',
    access_token   = NULL,
    refresh_token  = NULL;
