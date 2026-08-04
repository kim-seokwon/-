-- 판매채널 자격증명은 브라우저에서 직접 읽을 수 없는 서버 전용 영역에 보관한다.
create table if not exists channel_credentials (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  mall_key text not null references malls(mall_key) on delete cascade,
  channel text not null,
  credentials jsonb not null default '{}'::jsonb,
  status text not null default 'credentials_saved'
    check (status in ('credentials_saved','auth_required','testing','connected','error')),
  last_error text,
  last_tested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, channel)
);

alter table channel_credentials enable row level security;
-- 정책을 만들지 않는다. service_role Edge Function/동기화 봇만 접근한다.
revoke all on channel_credentials from anon, authenticated;

create or replace view channel_connection_status as
select brand_id, mall_key, channel, status, last_error, last_tested_at, updated_at
from channel_credentials;

revoke all on channel_connection_status from anon;
grant select on channel_connection_status to authenticated;

