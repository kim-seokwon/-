-- 121 광고 중단선 알림 기록 — 같은 세트를 판정이 바뀔 때까지 한 번만 알리기 위한 표 (11-19 G)
--   배경: 11-18 중단선 넘은 광고가 1~3일 더 돌아 113,789원 지출(사장님 '하루 11만원 낭비').
--   channel-bots/telegram/ad-stop-alert.mjs 가 보내기 전에 세트를 잡고(claim) 보낸다. 규칙은 adStopAlerts.js.
--   세트가 대상(판정 중단 + 켜진 광고 있음)에서 빠지면 스크립트가 행을 지운다 → 다시 걸리면 또 알린다.
-- 운영 적용 금지(사장님 승인 후 팀장이). 되돌리기: supabase/rollbacks/121_ad_stop_alert.down.sql

--   조직 격리(코덱스 반려 11-19): 113 뒤 광고 표는 org_id 를 가진다. 기록도 조직별로 — PK(org_id, adset_id), 읽기는 그 조직 사람·플랫폼 관리자만.
create table if not exists public.ad_stop_alert (
  org_id       uuid not null,
  adset_id     text not null,
  brand_id     uuid references public.brands(id) on delete set null,
  alerted_day  date not null,                          -- KST 보낸 날
  detail       jsonb not null default '{}'::jsonb,     -- 보낼 때 세트명·팔로워당·중단선·어제 지출
  sent_at      timestamptz not null default now(),
  primary key (org_id, adset_id)
);

-- 권한 — 같은 조직 사람만 읽기, 쓰기는 service_role(알림 스크립트)만. 정책 안 조직표 조회는 definer 함수로(120 dv_can_read 와 같은 틀)
alter table public.ad_stop_alert enable row level security;
revoke all on table public.ad_stop_alert from anon, authenticated;
grant select on table public.ad_stop_alert to authenticated;
grant all on table public.ad_stop_alert to service_role;
create or replace function public.ad_stop_alert_can_read(p_org uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
      or exists (select 1 from public.org_memberships where org_id = p_org and user_id = auth.uid()) $$;
revoke all on function public.ad_stop_alert_can_read(uuid) from public, anon;
grant execute on function public.ad_stop_alert_can_read(uuid) to authenticated;
drop policy if exists ad_stop_alert_staff_read on public.ad_stop_alert;
drop policy if exists ad_stop_alert_org_read on public.ad_stop_alert;
create policy ad_stop_alert_org_read on public.ad_stop_alert for select to authenticated using (public.ad_stop_alert_can_read(org_id));

select '121 ad stop alert installed' as status;
