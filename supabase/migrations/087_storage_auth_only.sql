-- 087 스토리지 bhas 버킷 — 익명 쓰기·목록 차단 (10-19 RLS점검 위험2: .work/상용화/RLS점검.md)
--
-- 운영 확인(10-19 읽기전용): storage.objects 정책 'Public Access/Insert/Update/Delete' 가 전부 roles={public}
--   → 공개키만 가진 누구나 bhas 38개 파일을 목록·업로드·덮어쓰기·삭제할 수 있었다.
-- 바꾼 뒤:
--   목록·조회(SELECT)          = 로그인 사용자(authenticated)
--   올리기·덮어쓰기·지우기      = 로그인 + 직원(MASTER/STAFF) — 지금 계정 4개가 전부 MASTER/STAFF
--   화면 업로드 4곳(main.js 노트·제품사진·시즌사진·문서)은 모두 upload(upsert:false)=INSERT 만 쓴다.
-- 버킷은 public=true 그대로 둔다 → getPublicUrl(/object/public/…) 링크는 RLS 를 안 타서 계속 열린다.
--   private 버킷 + signed URL 전환(R3)은 이번 범위 밖 — 후속 일감.
-- service_role(엣지함수)은 RLS 를 우회하므로 영향 없음.
-- 되돌리기: supabase/rollbacks/087_storage_auth_only.down.sql

-- 직원 판정 — get_user_role() 은 search_path 가 고정돼 있지 않아 storage API 연결에서 companies 를 못 찾을 수 있다.
-- 그래서 search_path 를 고정한 작은 함수를 따로 둔다.
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from companies
                  where username = split_part(auth.jwt()->>'email', '@', 1)
                    and role in ('MASTER', 'STAFF'))
$$;
revoke all on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated, service_role;

drop policy if exists "Public Access" on storage.objects;
drop policy if exists "Public Insert" on storage.objects;
drop policy if exists "Public Update" on storage.objects;
drop policy if exists "Public Delete" on storage.objects;

drop policy if exists "bhas_select_auth" on storage.objects;
drop policy if exists "bhas_insert_staff" on storage.objects;
drop policy if exists "bhas_update_staff" on storage.objects;
drop policy if exists "bhas_delete_staff" on storage.objects;

create policy "bhas_select_auth" on storage.objects
  for select to authenticated
  using (bucket_id = 'bhas');

create policy "bhas_insert_staff" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'bhas' and public.is_staff());

create policy "bhas_update_staff" on storage.objects
  for update to authenticated
  using (bucket_id = 'bhas' and public.is_staff())
  with check (bucket_id = 'bhas' and public.is_staff());

create policy "bhas_delete_staff" on storage.objects
  for delete to authenticated
  using (bucket_id = 'bhas' and public.is_staff());
