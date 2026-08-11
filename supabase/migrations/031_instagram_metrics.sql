-- 인스타그램(SNS) 운영지표: 팔로워 추이 · 주간 게시물 · 주간 스토리.
-- 수동 입력(source='manual')과 메타 그래프 API 자동수집(source='meta')을 같은 테이블로 통합.
--   팔로워 추이 = followers 시계열
--   주간 게시물 = posts_delta 를 ISO주 합산
--   주간 스토리 = stories_delta 를 ISO주 합산
-- posts_delta/stories_delta = "직전 스냅샷 이후 새로 올린 개수"
--   · 자동(일 1회): 그날 새로 올라온 게시물/스토리 수
--   · 수동(주 1회): 그 주에 올린 게시물/스토리 수 (주말일자에 입력)

create table if not exists ig_accounts (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands(id) on delete cascade,
  username text,                       -- @핸들 (표시용)
  ig_business_id text,                 -- 메타 IG 비즈니스 계정 ID (자동수집 시 사용, 비밀 아님)
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id)
);

create table if not exists ig_snapshots (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references ig_accounts(id) on delete cascade,
  snap_date date not null,
  followers integer,                   -- 그 시점 팔로워 수
  posts_delta integer not null default 0,   -- 직전 스냅샷 이후 게시물 수
  stories_delta integer not null default 0, -- 직전 스냅샷 이후 스토리 수
  media_count integer,                 -- (자동) 누적 게시물 수 — delta 계산용
  source text not null default 'manual' check (source in ('manual','meta')),
  note text,
  created_at timestamptz not null default now(),
  unique (account_id, snap_date)
);

create index if not exists idx_ig_snapshots_account_date on ig_snapshots(account_id, snap_date);

-- 팔로워/게시물 지표는 민감정보 아님 → 로그인 사용자(authenticated)가 읽고 쓸 수 있게.
alter table ig_accounts enable row level security;
alter table ig_snapshots enable row level security;

drop policy if exists ig_accounts_rw on ig_accounts;
create policy ig_accounts_rw on ig_accounts
  for all to authenticated using (true) with check (true);

drop policy if exists ig_snapshots_rw on ig_snapshots;
create policy ig_snapshots_rw on ig_snapshots
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on ig_accounts to authenticated;
grant select, insert, update, delete on ig_snapshots to authenticated;

-- 판매 3개 브랜드 계정 자리 미리 생성(핸들/계정ID는 나중에 입력).
insert into ig_accounts (brand_id, username, active)
select b.id, null, true from brands b
where b.name in ('하이헤이호','로하이스튜디오','토비')
on conflict (brand_id) do nothing;
