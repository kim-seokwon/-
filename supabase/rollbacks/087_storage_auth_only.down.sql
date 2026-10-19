-- 087 되돌리기 — 10-19 운영에 있던 공개 정책 4개를 그대로 복원한다(익명 쓰기가 다시 열린다 — 장애 때만).
drop policy if exists "bhas_select_auth" on storage.objects;
drop policy if exists "bhas_insert_staff" on storage.objects;
drop policy if exists "bhas_update_staff" on storage.objects;
drop policy if exists "bhas_delete_staff" on storage.objects;

drop policy if exists "Public Access" on storage.objects;
drop policy if exists "Public Insert" on storage.objects;
drop policy if exists "Public Update" on storage.objects;
drop policy if exists "Public Delete" on storage.objects;
create policy "Public Access" on storage.objects for select to public using (bucket_id = 'bhas');
create policy "Public Insert" on storage.objects for insert to public with check (bucket_id = 'bhas');
create policy "Public Update" on storage.objects for update to public using (bucket_id = 'bhas');
create policy "Public Delete" on storage.objects for delete to public using (bucket_id = 'bhas');

drop function if exists public.is_staff();
