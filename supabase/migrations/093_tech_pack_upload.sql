-- 093 작업지시서 파일 올리기 — 대시보드에서 만든 지시서 말고, 외부에서 받은 지시서 파일을 그대로 보관 (10-23 사장님)
--
-- tech_packs 에 칸 추가(기존 행·정책 그대로, 기존 행은 source = 'made'):
--   source     'made'(대시보드 제작, 기본) | 'upload'(파일 올리기)
--   file_path  tech_pack_files 버킷 안 경로(uuid.확장자) · file_name 원래 파일 이름(한글 그대로) · file_type · file_size
--   brand_id   브랜드(선택). 업로드는 제품에 안 붙어도 브랜드를 알 수 있게
--   업로드는 config 가 '{}' — 도식화·검수 체크리스트 자동항목이 없다(화면은 기본 검수 항목만)
-- 파일: private 버킷 tech_pack_files — 공개 주소 없음, 화면은 createSignedUrl(10분)로만 연다.
--   직원(is_staff = MASTER/STAFF) 읽기·올리기·지우기. 덮어쓰기(update) 없음. 20MB · PDF/사진/엑셀/한글만(버킷이 서버에서 막는다).
--   공개 bhas 버킷은 쓰지 않는다(087 이후 로그인만 읽기지만 지시서는 따로 둔다).
-- 운영 적용 금지(사장님 승인 후 팀장이). 되돌리기: supabase/rollbacks/093_tech_pack_upload.down.sql

-- 0) 판정 함수 — 087·092 와 같은 본문(어느 순서로 깔려도 선다)
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from companies
                  where username = split_part(auth.jwt()->>'email', '@', 1)
                    and role in ('MASTER', 'STAFF'))
$$;
revoke all on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated, service_role;

-- 1) 칸
alter table public.tech_packs
  add column if not exists source    text not null default 'made',
  add column if not exists file_path text,
  add column if not exists file_name text,
  add column if not exists file_type text,
  add column if not exists file_size bigint,
  add column if not exists brand_id  uuid;

alter table public.tech_packs drop constraint if exists tech_packs_source_check;
alter table public.tech_packs add constraint tech_packs_source_check check (
  (source = 'made') or
  (source = 'upload' and file_path is not null and file_name is not null and length(file_name) <= 255
     and coalesce(file_size, 0) between 1 and 20971520));

create unique index if not exists tech_packs_file_path_key on public.tech_packs (file_path) where file_path is not null;
create index if not exists tech_packs_brand_idx on public.tech_packs (brand_id) where brand_id is not null;

-- 브랜드가 지워지면 칸만 비운다 — brands 표가 있을 때만 건다(로컬 검사 DB 에는 없을 수 있다)
do $$ begin
  if to_regclass('public.brands') is not null
     and not exists (select 1 from pg_constraint where conname = 'tech_packs_brand_id_fkey') then
    alter table public.tech_packs add constraint tech_packs_brand_id_fkey
      foreign key (brand_id) references public.brands(id) on delete set null;
  end if;
end $$;

-- 1-1) 표 정책 — 직원(MASTER/STAFF)만. 013 의 tech_packs_all(로그인 전체 CRUD)이 남아 있으면
--   고객(CLIENT) 계정이 업로드 메타(파일 이름·경로)를 읽고 고칠 수 있다 → 지우고 is_staff() 하나로 묶는다.
--   026(tech_packs_select/write, get_user_role)과 같은 범위. 화면에서 tech_packs 를 읽는 곳은 전부 직원 메뉴(작업지시서·제품·생산·자료실·캘린더).
alter table public.tech_packs enable row level security;
drop policy if exists tech_packs_all on public.tech_packs;
drop policy if exists tech_packs_select on public.tech_packs;
drop policy if exists tech_packs_write on public.tech_packs;
drop policy if exists tech_packs_staff on public.tech_packs;
create policy tech_packs_staff on public.tech_packs for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- 2) 파일 버킷 — private
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tech_pack_files', 'tech_pack_files', false, 20971520, array[
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel',
  'application/x-hwp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists tech_pack_files_select on storage.objects;
drop policy if exists tech_pack_files_insert on storage.objects;
drop policy if exists tech_pack_files_delete on storage.objects;
create policy tech_pack_files_select on storage.objects for select to authenticated
  using (bucket_id = 'tech_pack_files' and public.is_staff());
create policy tech_pack_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'tech_pack_files' and public.is_staff());
create policy tech_pack_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'tech_pack_files' and public.is_staff());

select '093 tech_packs upload columns + tech_pack_files bucket installed' as status;
