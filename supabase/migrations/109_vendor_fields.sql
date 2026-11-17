-- 109 연락처 칸 정리 — 업체명/담당자/휴대폰/전화/팩스/이메일/주소/사업자등록증/메모/구분 (11-17 사장님)
--   사장님: "업체명 / 담당자 / 전화번호(폰,전화) / 팩스번호 / 이메일 / 주소지 / 사업자등록증 / 메모 이런식으로는 있어야지"
--
-- vendors 에 칸 추가(기존 칸·정책 그대로):
--   mobile         휴대폰. 기존 phone 은 '전화'(유선·대표번호)로 남긴다.
--   biz_file_path  사업자등록증 파일 — vendor_files 버킷 안 경로(<vendor_id>/<uuid>.<확장자>)
--   biz_file_name  원래 파일 이름(한글 그대로)
--   (등록번호는 기존 biz_no 를 그대로 쓴다)
-- 옮기기: phone 이 휴대폰 번호 하나뿐(숫자만 남겨 010·011·016·017·018·019 로 시작, 10~11자리 / +82 형식 포함)이면
--   mobile 로 옮기고 phone 은 비운다. 번호가 둘 이상 섞였거나 유선·대표번호면 phone 에 그대로 둔다.
--   mobile 이 이미 있는 행은 건드리지 않는다(두 번 깔아도 같다).
-- 파일: private 버킷 vendor_files — 공개 주소 없음, 화면은 createSignedUrl(10분)로만 연다.
--   직원(is_staff = MASTER/STAFF) 읽기·올리기·지우기. 10MB · PDF/사진만.
-- 건수 미리 보기: supabase/rehearsals/109_vendor_fields_dryrun.sql (읽기만)
-- 운영 적용 금지(사장님 승인 후 팀장이). 되돌리기: supabase/rollbacks/109_vendor_fields.down.sql

-- 0) 판정 함수 — 087·092·093 과 같은 본문(어느 순서로 깔려도 선다)
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from companies
                  where username = split_part(auth.jwt()->>'email', '@', 1)
                    and role in ('MASTER', 'STAFF'))
$$;
revoke all on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated, service_role;

-- 1) 칸
alter table public.vendors
  add column if not exists mobile        text,
  add column if not exists biz_file_path text,
  add column if not exists biz_file_name text;

alter table public.vendors drop constraint if exists vendors_biz_file_check;
alter table public.vendors add constraint vendors_biz_file_check check (
  (biz_file_path is null and biz_file_name is null) or
  (biz_file_path is not null and biz_file_name is not null and length(biz_file_name) <= 255));

-- 2) 휴대폰 옮기기 — 판정식은 dry-run 파일과 글자 하나까지 같다
update public.vendors
   set mobile = trim(phone), phone = null
 where mobile is null
   and phone is not null
   and (regexp_replace(phone, '[^0-9]', '', 'g') ~ '^01[016789][0-9]{7,8}$'
     or regexp_replace(phone, '[^0-9]', '', 'g') ~ '^821[016789][0-9]{7,8}$');

-- 3) 파일 버킷 — private
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vendor_files', 'vendor_files', false, 10485760, array[
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists vendor_files_select on storage.objects;
drop policy if exists vendor_files_insert on storage.objects;
drop policy if exists vendor_files_delete on storage.objects;
create policy vendor_files_select on storage.objects for select to authenticated
  using (bucket_id = 'vendor_files' and public.is_staff());
create policy vendor_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'vendor_files' and public.is_staff());
create policy vendor_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'vendor_files' and public.is_staff());

select '109 vendors mobile/biz_file + vendor_files bucket installed' as status;
