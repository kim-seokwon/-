-- 메모·미리알림에 '누가 볼 수 있나'를 넣는다.
--  분류(폴더) = ①개인칸(본인만) ②프로젝트별(그 브랜드 접근 권한이 있는 사람) ③공용(로그인한 모두)
--  프로젝트 폴더는 notes.product_id 로 잇고, 접근 판정은 기존 can_access_brand() 를 그대로 쓴다(028과 동일 규칙).

alter table notes     add column if not exists owner text;                       -- 계정 username (개인칸 주인)
alter table notes     add column if not exists scope text not null default 'shared';  -- private | project | shared
alter table reminders add column if not exists owner text;
alter table reminders add column if not exists scope text not null default 'shared';

alter table notes     drop constraint if exists notes_scope_chk;
alter table notes     add  constraint notes_scope_chk check (scope in ('private','project','shared'));
alter table reminders drop constraint if exists rem_scope_chk;
alter table reminders add  constraint rem_scope_chk  check (scope in ('private','project','shared'));

create index if not exists idx_notes_scope on notes(scope, owner);
create index if not exists idx_rem_scope on reminders(scope, owner);

-- 현재 로그인 계정의 username (get_user_role() 과 같은 방식)
create or replace function public.current_username() returns text
language sql stable as $$ select split_part(auth.jwt()->>'email','@',1) $$;

-- 볼 수 있는가: 공용이면 모두 / 개인칸이면 주인만 / 프로젝트면 그 브랜드 접근 권한
create or replace function public.can_see_scope(p_scope text, p_owner text, p_brand uuid)
returns boolean language plpgsql stable security definer set search_path=public as $$
begin
  if p_scope = 'private' then return p_owner is not distinct from current_username(); end if;
  if p_scope = 'project' then return p_brand is null or can_access_brand(p_brand); end if;
  return true;
end $$;

drop policy if exists notes_select on notes;
create policy notes_select on notes for select to authenticated
  using (can_see_scope(scope, owner, brand_id));
drop policy if exists notes_update on notes;
create policy notes_update on notes for update to authenticated
  using (can_see_scope(scope, owner, brand_id));
drop policy if exists notes_delete on notes;
create policy notes_delete on notes for delete to authenticated
  using (get_user_role()='MASTER' or (scope='private' and owner is not distinct from current_username()));

drop policy if exists rem_select on reminders;
create policy rem_select on reminders for select to authenticated
  using (can_see_scope(scope, owner, null));
drop policy if exists rem_update on reminders;
create policy rem_update on reminders for update to authenticated
  using (can_see_scope(scope, owner, null));
drop policy if exists rem_delete on reminders;
create policy rem_delete on reminders for delete to authenticated
  using (get_user_role()='MASTER' or (scope='private' and owner is not distinct from current_username()));

notify pgrst, 'reload schema';
