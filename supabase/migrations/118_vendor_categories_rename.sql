-- 118: 거래처 분류를 생산처·원단·부자재·인쇄·물류·기타 로 맞춘다(개편 2단계 B, 이관표-1118).
--   방법: 이름만 바꾼다(봉제→생산처, 프린트→인쇄). vendors.category 는 080 FK(ON UPDATE CASCADE)로 같이 바뀐다.
--         물류가 없으면 하나 넣는다. 원단·부자재·기타·사용자가 만든 분류는 그대로.
--   ⚠ 자동 병합·삭제 금지: 바꿀 이름(생산처·인쇄)이 이미 있으면 바꾸지 않고 NOTICE 만 남긴다(두 분류를 합치지 않음).
--   되돌리기: 118 이 실제로 바꾼 행을 vendor_categories.id 로 public.mig118_vendor_category_log 에 남긴다.
--             rollbacks/118_vendor_categories_rename.down.sql 은 id 와 118 이 넣은 이름이 둘 다 맞는 행만 되돌린다
--             (118 뒤 사용자가 이름을 바꿨거나 같은 이름 새 행을 만들었으면 건드리지 않음).
--   두 번 돌려도 안전.

create table if not exists public.mig118_vendor_category_log (
  cat_id    uuid primary key,                                  -- vendor_categories.id (이름이 아니라 행으로 기억)
  action    text not null check (action in ('rename', 'insert')),
  old_name  text,
  new_name  text not null,
  done_at   timestamptz not null default now()
);
comment on table public.mig118_vendor_category_log is 'mig118: 거래처 분류 이름 바꾸기 기록(되돌리기용)';
alter table public.mig118_vendor_category_log enable row level security;
revoke all on public.mig118_vendor_category_log from public, anon, authenticated;

do $m$
declare r record; cid uuid;
begin
  for r in select * from (values ('봉제', '생산처'), ('프린트', '인쇄')) v(old_name, new_name) loop
    if exists (select 1 from public.vendor_categories where name = r.new_name) then
      if exists (select 1 from public.vendor_categories where name = r.old_name) then
        raise notice 'mig118: % 이(가) 이미 있어 % 을(를) 그대로 둠(병합 안 함)', r.new_name, r.old_name;
      end if;
      continue;
    end if;
    select id into cid from public.vendor_categories where name = r.old_name;
    if cid is null then raise notice 'mig118: % 없음 — 건너뜀', r.old_name; continue; end if;
    update public.vendor_categories set name = r.new_name where id = cid;   -- vendors.category 는 FK cascade
    insert into public.mig118_vendor_category_log (cat_id, action, old_name, new_name) values (cid, 'rename', r.old_name, r.new_name)
      on conflict (cat_id) do nothing;
    raise notice 'mig118: % → %', r.old_name, r.new_name;
  end loop;

  if not exists (select 1 from public.vendor_categories where name = '물류') then
    insert into public.vendor_categories (name, color, sort_order) values ('물류', '#0ea5e9', 50) returning id into cid;
    insert into public.mig118_vendor_category_log (cat_id, action, old_name, new_name) values (cid, 'insert', null, '물류')
      on conflict (cat_id) do nothing;
    raise notice 'mig118: 물류 추가';
  end if;
end $m$;
