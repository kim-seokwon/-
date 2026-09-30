-- 메모·미리알림이 느린 근본 원인을 없앤다.
--
-- 지금은 정책이 행마다 can_see_scope() 를 부르는데, 이 함수가 plpgsql + security definer 라
-- 플래너가 질의 안으로 펼치지 못한다. 그 안에서 current_username() 이 JWT 를 매번 다시 파싱한다.
-- 메모 200줄이면 JWT 파싱 200번. 줄이 늘수록 느려진다.
--
-- 고치는 방법: 같은 뜻의 SQL 함수로 바꾼다. SQL + stable 이면 플래너가 인라인해서
-- current_username() 을 질의당 한 번만 계산한다. security definer 는 떼야 인라인된다 —
-- 이 함수는 테이블을 직접 읽지 않고(can_access_brand 가 제 권한을 그대로 들고 있다) 안전하다.

-- 1) 사용자 이름: SQL·stable 그대로 두되 안전한 search_path 를 못 박는다
create or replace function public.current_username() returns text
language sql stable
set search_path = public
as $$ select split_part(auth.jwt()->>'email','@',1) $$;

-- 2) 볼 수 있는가: plpgsql + security definer → SQL + stable (인라인 대상)
create or replace function public.can_see_scope(p_scope text, p_owner text, p_brand uuid)
returns boolean
language sql stable
set search_path = public
as $$
  select case
    when p_scope = 'private' then p_owner is not distinct from public.current_username()
    when p_scope = 'project' then p_brand is null or public.can_access_brand(p_brand)
    else true
  end
$$;

-- 3) 자주 훑는 자리에 인덱스
create index if not exists idx_notes_folder_updated on notes(folder, updated_at desc);
create index if not exists idx_notes_owner_scope    on notes(owner, scope);
create index if not exists idx_rem_done_due         on reminders(done, due_date);

-- 4) 권한(기존과 동일하게 유지)
revoke all on function public.can_see_scope(text, text, uuid) from public;
grant execute on function public.can_see_scope(text, text, uuid) to authenticated;
revoke all on function public.current_username() from public;
grant execute on function public.current_username() to authenticated;

notify pgrst, 'reload schema';

-- 확인용 (선택): 인라인됐는지 보려면
--   explain analyze select * from notes where folder <> '스티커' order by updated_at desc limit 200;
--   → 'Function Scan on can_see_scope' 가 사라지고 조건이 펼쳐져 있으면 성공.
