-- 085 카페24 몰별 회원수 일별 스냅샷 (10-16 사장님: "탈퇴를 다 체크해야돼? 회원수로 체크하면 되잖아 간단하게")
--   탈퇴 개별 추적은 안 한다. 매일 1회 전체 회원수만 저장 → 화면에서 추이·전일/전월 대비 증감.
--   수집: Edge Function cafe24-members (카페24 GET /customersprivacy/count, 권한 mall.read_privacy).
--   ⚠ 적용 전 조건: 카페24 앱 권한에 '회원 개인정보 읽기' + cafe24-oauth SCOPE 에 mall.read_privacy + 몰별 재인증.
--   되돌리기: select cron.unschedule('cafe24-members-daily'); drop table public.cafe24_member_counts;

create table if not exists public.cafe24_member_counts (
  mall_key     text        not null,
  snap_date    date        not null,             -- KST 날짜
  total        integer     not null check (total >= 0),
  collected_at timestamptz not null default now(),
  primary key (mall_key, snap_date)
);

alter table public.cafe24_member_counts enable row level security;

-- 읽기: 그 몰 브랜드를 볼 수 있는 로그인 사용자만 (channel_orders 와 같은 기준). 쓰기는 service_role(함수)만.
drop policy if exists member_counts_select on public.cafe24_member_counts;
create policy member_counts_select on public.cafe24_member_counts
  for select to authenticated
  using (exists (select 1 from public.malls m where m.mall_key = cafe24_member_counts.mall_key and public.can_access_brand(m.brand_id)));

revoke all on public.cafe24_member_counts from anon;
revoke insert, update, delete, truncate on public.cafe24_member_counts from authenticated;
grant select on public.cafe24_member_counts to authenticated;

-- 매일 KST 06:10 (UTC 21:10) 1회. cafe24-sync 와 같은 x-cron-secret 방식.
-- ⚠ '<CRON_SECRET>' 를 함수 시크릿 CRON_SECRET 값으로 바꿔 SQL Editor 에서 실행(이 파일에 원문을 적지 말 것).
-- select cron.unschedule('cafe24-members-daily') where exists (select 1 from cron.job where jobname = 'cafe24-members-daily');
-- select cron.schedule('cafe24-members-daily', '10 21 * * *', $$
--   select net.http_post(
--     url     := 'https://czaykmmwzlcisozmbxpl.supabase.co/functions/v1/cafe24-members',
--     headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
--     body    := '{}'::jsonb);
-- $$);
