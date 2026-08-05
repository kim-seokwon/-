-- 상태 화면은 보이되 토큰 테이블을 뷰 소유자 권한으로 직접 노출하지 않는다.
-- 원본 테이블에는 API 토큰/시크릿이 있어, 상태값은 마스터 전용 RPC에서만 만든다.

CREATE OR REPLACE FUNCTION get_channel_operational_status()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF get_user_role() <> 'MASTER' THEN
    RETURN jsonb_build_object('sync', '[]'::jsonb, 'connections', '[]'::jsonb);
  END IF;

  RETURN jsonb_build_object(
    'sync', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'mall_key', mall_key,
        'channel', channel,
        'cafe24_mall_id', cafe24_mall_id,
        'last_order_synced_at', last_order_synced_at,
        'dry_run', dry_run,
        'updated_at', updated_at
      ))
      FROM channel_sync_state
    ), '[]'::jsonb),
    'connections', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'brand_id', brand_id,
        'mall_key', mall_key,
        'channel', channel,
        'status', status,
        'last_error', last_error,
        'last_tested_at', last_tested_at,
        'updated_at', updated_at
      ))
      FROM channel_credentials
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION get_channel_operational_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_channel_operational_status() TO authenticated;

-- 기존 뷰는 RLS 우회 없이 동작하도록 전환한다.
ALTER VIEW channel_connection_status SET (security_invoker = true);
ALTER VIEW channel_sync_status SET (security_invoker = true);
ALTER VIEW inventory_allocation SET (security_invoker = true);

SELECT 'secure status access installed' AS status;
