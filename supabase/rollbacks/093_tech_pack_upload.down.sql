-- 093 되돌리기 — 작업지시서 파일 올리기 칸·버킷·정책을 걷는다.
-- ⚠ 업로드한 지시서(source = 'upload')와 그 파일이 함께 사라진다. 지우기 전에 필요하면 백업:
--   select * from tech_packs where source = 'upload';  · 파일은 Storage 화면에서 tech_pack_files 버킷 내려받기
-- 순서: ① Storage 화면에서 tech_pack_files 버킷을 비운다 ② 이 파일을 돌린다.
-- 대시보드에서 만든 지시서(source = 'made')는 그대로 남는다. is_staff() 는 남긴다(087·091·092 가 쓴다).

drop policy if exists tech_pack_files_select on storage.objects;
drop policy if exists tech_pack_files_insert on storage.objects;
drop policy if exists tech_pack_files_delete on storage.objects;
-- 버킷은 안에 파일이 있으면 지워지지 않는다 — 비운 뒤 지운다(파일이 남아 있으면 이 줄에서 멈춤 = 의도)
delete from storage.buckets where id = 'tech_pack_files';

-- 파일이 없는 업로드 행은 옛 화면에서 빈 도식화로 보이므로 같이 지운다(생산 물품 연결은 013 대로 null 이 된다)
delete from public.tech_packs where source = 'upload';

-- 표 정책은 093 전 모양(026: 직원만)으로 돌린다. 013 의 tech_packs_all(로그인 전체)은 넓어서 되살리지 않는다.
drop policy if exists tech_packs_staff on public.tech_packs;
drop policy if exists tech_packs_select on public.tech_packs;
drop policy if exists tech_packs_write on public.tech_packs;
create policy tech_packs_select on public.tech_packs for select using (get_user_role() in ('MASTER','STAFF'));
create policy tech_packs_write on public.tech_packs for all
  using (get_user_role() in ('MASTER','STAFF')) with check (get_user_role() in ('MASTER','STAFF'));

alter table public.tech_packs drop constraint if exists tech_packs_brand_id_fkey;
alter table public.tech_packs drop constraint if exists tech_packs_source_check;
drop index if exists public.tech_packs_file_path_key;
drop index if exists public.tech_packs_brand_idx;
alter table public.tech_packs
  drop column if exists brand_id,
  drop column if exists file_size,
  drop column if exists file_type,
  drop column if exists file_name,
  drop column if exists file_path,
  drop column if exists source;
