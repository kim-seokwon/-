-- 로하이(rohi) 재인증: 카페24 앱 자격증명이 유실됨.
-- 하이헤이호/토비와 같은 이일칠구 파트너 계정 앱을 공유하므로 client_id를 복사.
-- (client_secret은 applyEnvSecret 폴백으로 CAFE24_SECRET_MYHO1129 사용하므로 client_id만 있으면 OAuth 가능)
-- 토큰은 비워서 OAuth 재발급 유도.

-- rohi 행이 없으면 생성(hiheiho 값 기반), 있으면 client_id/secret 갱신
INSERT INTO channel_sync_state (mall_key, channel, cafe24_mall_id, client_id, client_secret, dry_run)
SELECT 'rohi', 'cafe24', 'thehimeseller', h.client_id, h.client_secret, TRUE
FROM channel_sync_state h
WHERE h.mall_key = 'hiheiho'
ON CONFLICT (mall_key) DO UPDATE
SET client_id     = EXCLUDED.client_id,
    client_secret = EXCLUDED.client_secret,
    cafe24_mall_id = 'thehimeseller',
    access_token  = NULL,
    refresh_token = NULL;
