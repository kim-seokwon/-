-- 092 도움말 센터 — 공지 · 공지 읽음 · 불편접수 + 첨부 private 버킷 (10-22 코덱스 팀장 배정)
--
-- 화면: 로그인한 모든 화면 우측 하단 ? 버튼 → 공지 / 사용설명서 / 불편접수 3탭 (helpCenter.js)
-- 권한(직원 = companies.role MASTER/STAFF, 관리자 = MASTER):
--   공지          읽기 = 직원(게시된 것만, 관리자는 숨김글까지) · 쓰기/고치기/고정/지우기 = 관리자
--   공지 읽음      자기 것만 남기고 본다 · 관리자는 전체 읽음 현황을 본다 · 고치기/지우기 없음
--   불편접수       직원은 자기 건만 넣고 본다(상태는 '접수'로만 시작) · 관리자는 전체를 보고 상태·메모만 고친다
--   첨부(feedback) private 버킷 — 공개 URL 없음. 올리기 = 직원·자기 이름 폴더만 · 보기(signed URL) = 본인 폴더 또는 관리자
--                  이미지(png/jpeg/webp/gif) 5MB 까지 — 버킷 설정으로 서버에서 막는다(화면 검사와 별개)
-- 이름 판정은 기존 current_username()(038, JWT email 앞부분) · is_staff()(087) 를 그대로 쓴다.
-- 운영 적용 금지(사장님 승인 후 팀장이). 되돌리기: supabase/rollbacks/092_help_center.down.sql

-- 0) 판정 함수 — is_staff·is_master 는 087·091(운영 적용됨)과 같은 본문 create or replace(어느 순서로 깔려도 선다)
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from companies
                  where username = split_part(auth.jwt()->>'email', '@', 1)
                    and role in ('MASTER', 'STAFF'))
$$;
revoke all on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated, service_role;

create or replace function public.is_master()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from companies
                  where username = split_part(auth.jwt()->>'email', '@', 1)
                    and role = 'MASTER')
$$;
revoke all on function public.is_master() from public, anon;
grant execute on function public.is_master() to authenticated, service_role;

-- 1) 공지
create table if not exists public.notices (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(btrim(title)) between 1 and 100),
  body        text not null default '' check (char_length(body) <= 5000),
  pinned      boolean not null default false,
  published   boolean not null default true,
  created_by  text not null default public.current_username(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists notices_list_idx on public.notices (pinned desc, created_at desc);

-- 2) 공지 읽음 — (공지, 사람) 한 줄. 읽은 적 있으면 점이 사라진다
create table if not exists public.notice_reads (
  notice_id   uuid not null references public.notices(id) on delete cascade,
  username    text not null default public.current_username(),
  read_at     timestamptz not null default now(),
  primary key (notice_id, username)
);

-- 3) 불편접수
create table if not exists public.feedback_reports (
  id          uuid primary key default gen_random_uuid(),
  username    text not null default public.current_username(),
  screen      text not null default '' check (char_length(screen) <= 200),
  screen_meta jsonb not null default '{}'::jsonb check (pg_column_size(screen_meta) <= 4000),
  body        text not null check (char_length(btrim(body)) between 1 and 2000),
  image_path  text check (image_path is null or char_length(image_path) <= 300),
  status      text not null default '접수' check (status in ('접수', '처리중', '완료')),
  admin_note  text not null default '' check (char_length(admin_note) <= 1000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists feedback_reports_user_idx on public.feedback_reports (username, created_at desc);
create index if not exists feedback_reports_status_idx on public.feedback_reports (status, created_at desc);

-- 4) RLS
alter table public.notices enable row level security;
alter table public.notice_reads enable row level security;
alter table public.feedback_reports enable row level security;

revoke all on public.notices, public.notice_reads, public.feedback_reports from anon;
grant select, insert, update, delete on public.notices to authenticated;
grant select, insert on public.notice_reads to authenticated;
grant select, insert on public.feedback_reports to authenticated;
-- 관리자가 고칠 수 있는 칸은 상태·메모·고친 시각뿐(본문·작성자·첨부는 못 바꾼다)
grant update (status, admin_note, updated_at) on public.feedback_reports to authenticated;

drop policy if exists notices_select on public.notices;
drop policy if exists notices_insert on public.notices;
drop policy if exists notices_update on public.notices;
drop policy if exists notices_delete on public.notices;
create policy notices_select on public.notices for select to authenticated
  using (public.is_master() or (published and public.is_staff()));
create policy notices_insert on public.notices for insert to authenticated
  with check (public.is_master() and created_by = public.current_username());
create policy notices_update on public.notices for update to authenticated
  using (public.is_master()) with check (public.is_master());
create policy notices_delete on public.notices for delete to authenticated
  using (public.is_master());

drop policy if exists notice_reads_select on public.notice_reads;
drop policy if exists notice_reads_insert on public.notice_reads;
create policy notice_reads_select on public.notice_reads for select to authenticated
  using (username = public.current_username() or public.is_master());
create policy notice_reads_insert on public.notice_reads for insert to authenticated
  with check (public.is_staff() and username = public.current_username());

drop policy if exists feedback_select on public.feedback_reports;
drop policy if exists feedback_insert on public.feedback_reports;
drop policy if exists feedback_update on public.feedback_reports;
create policy feedback_select on public.feedback_reports for select to authenticated
  using ((public.is_staff() and username = public.current_username()) or public.is_master());
create policy feedback_insert on public.feedback_reports for insert to authenticated
  with check (public.is_staff() and username = public.current_username() and status = '접수' and admin_note = ''
              and (image_path is null or split_part(image_path, '/', 1) = public.current_username()));
create policy feedback_update on public.feedback_reports for update to authenticated
  using (public.is_master()) with check (public.is_master());

-- 5) 첨부 버킷 — private. 화면은 createSignedUrl(10분)로만 연다
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('feedback', 'feedback', false, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists feedback_obj_insert on storage.objects;
drop policy if exists feedback_obj_select on storage.objects;
create policy feedback_obj_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'feedback' and public.is_staff()
              and (storage.foldername(name))[1] = public.current_username());
create policy feedback_obj_select on storage.objects for select to authenticated
  using (bucket_id = 'feedback'
         and ((public.is_staff() and (storage.foldername(name))[1] = public.current_username()) or public.is_master()));
drop policy if exists feedback_obj_delete on storage.objects;
-- 지우기는 '아직 접수에 안 붙은 내 파일'만 — 사진은 올렸는데 접수 저장이 실패했을 때 앱이 방금 올린 파일을 치운다(고아 파일 방지).
--   접수에 붙은 첨부는 올린 사람도 못 지운다(증거 보존). update 정책 없음 = 덮어쓰기 못 함.
create policy feedback_obj_delete on storage.objects for delete to authenticated
  using (bucket_id = 'feedback' and public.is_staff()
         and (storage.foldername(name))[1] = public.current_username()
         and not exists (select 1 from public.feedback_reports r where r.image_path = objects.name));
