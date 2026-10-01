-- 프로젝트별 담당자와 공개 범위.
--  · 프로젝트에 '전체 권한' / '담당자만' 둘 중 하나를 둔다.
--  · 메모는 공개(폴더 권한대로) / 비공개(만든 사람 + 그 프로젝트 담당자만).
-- ※ 화면에서 거르는 건 '보기 좋게' 하는 것일 뿐 보안이 아니다.
--    이 파일을 실행해야 서버가 실제로 막아준다.

alter table products add column if not exists access  text not null default 'all';   -- all | members
alter table products add column if not exists members text[] not null default '{}';  -- 담당자 username 목록
alter table products drop constraint if exists products_access_chk;
alter table products add  constraint products_access_chk check (access in ('all','members'));
create index if not exists idx_products_members on products using gin(members);

-- 이 프로젝트를 볼 수 있나 (브랜드 권한 + 담당자 지정)
create or replace function public.can_access_project(p_id uuid)
returns boolean language sql stable
set search_path = public
as $$
  select case
    when p_id is null then true
    else exists (
      select 1 from products p
       where p.id = p_id
         and (p.brand_id is null or public.can_access_brand(p.brand_id))
         and (p.access = 'all'
              or public.current_username() = any(p.members)
              or public.get_user_role() = 'MASTER')
    )
  end
$$;
revoke all on function public.can_access_project(uuid) from public;
grant execute on function public.can_access_project(uuid) to authenticated;

-- 메모: 프로젝트 권한을 먼저 보고, 비공개면 만든 사람·담당자만
create or replace function public.can_see_note(p_scope text, p_owner text, p_product uuid, p_brand uuid)
returns boolean language sql stable
set search_path = public
as $$
  select public.can_access_project(p_product)
     and (p_brand is null or public.can_access_brand(p_brand))
     and (
       p_scope <> 'private'
       or p_owner is not distinct from public.current_username()
       or public.get_user_role() = 'MASTER'
       or (p_product is not null and exists (
             select 1 from products p
              where p.id = p_product and public.current_username() = any(p.members)))
     )
$$;
revoke all on function public.can_see_note(text, text, uuid, uuid) from public;
grant execute on function public.can_see_note(text, text, uuid, uuid) to authenticated;

drop policy if exists notes_select on notes;
create policy notes_select on notes for select to authenticated
  using (can_see_note(scope, owner, product_id, brand_id));
drop policy if exists notes_update on notes;
create policy notes_update on notes for update to authenticated
  using (can_see_note(scope, owner, product_id, brand_id));

-- 미리알림도 프로젝트에 붙어 있으면 같은 규칙
drop policy if exists rem_select on reminders;
create policy rem_select on reminders for select to authenticated
  using (can_access_project(product_id)
         and (scope <> 'private'
              or owner is not distinct from current_username()
              or get_user_role() = 'MASTER'));
drop policy if exists rem_update on reminders;
create policy rem_update on reminders for update to authenticated
  using (can_access_project(product_id)
         and (scope <> 'private'
              or owner is not distinct from current_username()
              or get_user_role() = 'MASTER'));

-- 할일(todos)도 프로젝트를 따른다
drop policy if exists todos_select_proj on todos;
create policy todos_select_proj on todos for select to authenticated
  using (can_access_project(product_id));

notify pgrst, 'reload schema';
