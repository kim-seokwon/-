-- 프로젝트 메모(댓글)·할일을 맥 '메모'·'미리알림' 형태로 재구현
--  기존 memos(product_id,text) / todos(product_id,text)는 프로젝트에 종속이라
--  프로젝트 없는 메모·할일을 담지 못했다(둘 다 0건, 사실상 미사용).
--  → 독립적으로도 쓰고 프로젝트에 붙이기도 하는 구조로 새로 만든다. 노션 이관분(노트 104·할일 74)이 여기 들어간다.

create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  body text,
  folder text not null default '메모',            -- 맥 메모의 '폴더'
  product_id uuid references products(id) on delete set null,   -- 프로젝트에 붙이면 그 프로젝트의 댓글처럼 보인다
  brand_id uuid references brands(id) on delete set null,
  pinned boolean not null default false,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_notes_updated on notes(updated_at desc);
create index if not exists idx_notes_product on notes(product_id);

create table if not exists reminders (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  memo text,
  list_name text not null default '내 할 일',      -- 맥 미리알림의 '목록'
  due_date date,
  done boolean not null default false,
  done_at timestamptz,
  product_id uuid references products(id) on delete set null,
  assignee text,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists idx_rem_due on reminders(due_date);
create index if not exists idx_rem_done on reminders(done);
create index if not exists idx_rem_product on reminders(product_id);

-- 수정 시각 자동 갱신(메모 목록 정렬 기준)
create or replace function touch_note() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists trg_note_touch on notes;
create trigger trg_note_touch before update on notes for each row execute function touch_note();

alter table notes enable row level security;
alter table reminders enable row level security;

-- 업무 화면이라 로그인 사용자는 읽고 쓰고, 삭제만 MASTER (028 규칙과 동일)
drop policy if exists notes_select on notes;
create policy notes_select on notes for select to authenticated using (true);
drop policy if exists notes_insert on notes;
create policy notes_insert on notes for insert to authenticated with check (true);
drop policy if exists notes_update on notes;
create policy notes_update on notes for update to authenticated using (true);
drop policy if exists notes_delete on notes;
create policy notes_delete on notes for delete to authenticated using (get_user_role()='MASTER');

drop policy if exists rem_select on reminders;
create policy rem_select on reminders for select to authenticated using (true);
drop policy if exists rem_insert on reminders;
create policy rem_insert on reminders for insert to authenticated with check (true);
drop policy if exists rem_update on reminders;
create policy rem_update on reminders for update to authenticated using (true);
drop policy if exists rem_delete on reminders;
create policy rem_delete on reminders for delete to authenticated using (get_user_role()='MASTER');

notify pgrst, 'reload schema';
