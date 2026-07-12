-- ============================================
-- 카페24 동기화 스케줄 (Supabase pg_cron + pg_net)
-- Edge Function 배포 후, 아래 URL/KEY 채워서 SQL Editor에서 실행하세요.
-- (선택) 외부 cron(맥 로컬/cron.org)으로 대체 가능.
-- ============================================
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 기존 잡 제거(재실행 안전)
SELECT cron.unschedule('cafe24-sync') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cafe24-sync');

-- 10분마다 cafe24-sync 호출
-- ⚠️ '<PROJECT_REF>' 와 '<SERVICE_ROLE_KEY>' 를 실제 값으로 치환하세요.
SELECT cron.schedule(
  'cafe24-sync',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/cafe24-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- 확인
SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'cafe24-sync';
