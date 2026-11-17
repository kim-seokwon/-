-- 109 되돌리기 — 휴대폰을 phone 으로 되돌리고 칸·버킷 정책을 지운다.
--   phone 이 비어 있으면 mobile 을 그대로, 둘 다 있으면 'phone / mobile' 로 합친다(번호를 버리지 않는다).
--   주의: 합친 행은 109 를 다시 깔아도 둘로 나뉘지 않는다(번호 둘 = phone 에 남김 규칙).
--   사업자등록증 파일은 버킷에 남는다 — 비어 있을 때만 버킷을 지운다. 파일이 있으면 먼저 내려받아 보관할 것.
--   is_staff() 는 087·092·093 도 쓰므로 지우지 않는다.

-- 두 번 돌려도 깨지지 않게 — mobile 칸이 있을 때만 옮긴다
do $$ begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'vendors' and column_name = 'mobile') then
    update public.vendors
       set phone = case when nullif(trim(phone), '') is null then mobile else phone || ' / ' || mobile end
     where nullif(trim(mobile), '') is not null;
  end if;
end $$;

alter table public.vendors drop constraint if exists vendors_biz_file_check;
alter table public.vendors
  drop column if exists mobile,
  drop column if exists biz_file_path,
  drop column if exists biz_file_name;

drop policy if exists vendor_files_select on storage.objects;
drop policy if exists vendor_files_insert on storage.objects;
drop policy if exists vendor_files_delete on storage.objects;
delete from storage.buckets b
 where b.id = 'vendor_files'
   and not exists (select 1 from storage.objects o where o.bucket_id = 'vendor_files');

select '109 rolled back' as status;
