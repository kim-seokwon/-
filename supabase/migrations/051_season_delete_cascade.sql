-- 시즌을 지우면 그 시즌의 페이지(메모)·미리알림·제품도 같이 지운다.
--  notes/reminders/product_items 의 FK 는 set null 이라, 지금은 시즌만 사라지고
--  페이지들은 주인 없는 '공용' 메모로 남아 목록을 어지럽혔다.
--  메모 삭제도 마스터만 가능해서, 남은 찌꺼기를 직원이 치울 수가 없었다.
create or replace function public.delete_project_cascade(project_uuid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from notes          where product_id = project_uuid;
  delete from reminders      where product_id = project_uuid;
  delete from product_items  where product_id = project_uuid;
  delete from todos          where product_id = project_uuid;
  delete from photos         where product_id = project_uuid;
  delete from documents      where product_id = project_uuid;
  delete from memos          where product_id = project_uuid;
  delete from product_stages where product_id = project_uuid;
  delete from history        where product_id = project_uuid;
  delete from products       where id = project_uuid;
end $$;

-- 메모·미리알림 삭제 권한을 '고칠 수 있으면 지울 수도 있다'로 맞춘다.
--  지금은 내용을 통째로 지워 빈 메모로 만들 수는 있는데 삭제만 막혀 있어서,
--  권한이 아니라 그냥 불편함이었다.
drop policy if exists notes_delete on notes;
create policy notes_delete on notes for delete to authenticated
  using (can_see_scope(scope, owner, brand_id));

drop policy if exists rem_delete on reminders;
create policy rem_delete on reminders for delete to authenticated
  using (can_see_scope(scope, owner, null));

notify pgrst, 'reload schema';
