-- 101 제품 메모 장은 제품당 하나 — 겹쳐 생긴 장 합치기 + 하나 규칙(유니크) (10-28 지시서 .work/개발/제품리스트-편의.md)
-- ⚠ 장을 지운다(합친 뒤 남는 장) — 사장님 승인 뒤에만 돌린다. 100 과 따로.
--
-- 왜: 자동 저장 첫 생성이 겹쳐 한 제품에 장이 둘 생겼다(10-28 운영: 헨리넥 셋업 어덜트 b0a341ca 13자 · 134a3805 148자, 0.015초 차).
--      화면은 이제 같은 제품 저장을 줄 세워 하나씩 하고(main.js _itemNoteQueue), 이 파일이 DB 에서도 둘째 장을 못 만들게 막는다.
--
-- 합치는 규칙: 먼저 만든 장(created_at, id 순 첫째)을 남기고, 나머지 장의 글(메타 줄 뺀 것)을 만든 순서대로 뒤에 잇는다.
--   잇는 자리에 줄바꿈이 이미 있으면(앞 글 끝·뒷 글 앞) 그대로 붙이고, 없으면 줄바꿈 하나를 넣는다.
--   빈 글이거나 줄 단위로 통째 이미 들어 있는 글이면 잇지 않는다. 사진 줄(![사진](…))도 글이라 같이 옮겨진다.
--   헨리넥: "상의 기존 맨투맨 수정\n" + "\n상의)패턴 솔리드맨투맨-…" → 한 장(161자).
-- 잃지 않게: 지우는 장은 행 전체(jsonb), 남기는 장은 원래 body 를 item_note_dedupe_101 에 남긴다(되돌리기가 그대로 되살린다).
-- 되돌리기: supabase/rollbacks/101_item_note_one.down.sql

create table if not exists public.item_note_dedupe_101 (
  note_id          uuid primary key,    -- 지운 장
  item_id          uuid not null,
  keep_id          uuid not null,       -- 남긴 장
  note_row         jsonb not null,      -- 지운 장 행 전체
  keep_body_before text,
  keep_body_after  text,
  merged_at        timestamptz not null default now()
);
alter table public.item_note_dedupe_101 enable row level security;
revoke all on public.item_note_dedupe_101 from public, anon, authenticated;

--  '이미 들어 있음' = 줄 단위로 통째 들어 있을 때만(각 줄 앞뒤 공백·탭 뺌) — '미입고' 안의 '입고'는 아니다. 화면 main.js _memoHas 와 같다.
create or replace function pg_temp.memo_norm(s text) returns text language sql immutable as $$
  select btrim(coalesce(string_agg(btrim(x, E' \t\r'), E'\n' order by o), ''), E'\n')
    from unnest(string_to_array(coalesce(s, ''), E'\n')) with ordinality as u(x, o) $$;
create or replace function pg_temp.memo_has(t text, m text) returns boolean language sql immutable as $$
  select pg_temp.memo_norm(m) = ''
      or position(E'\n' || pg_temp.memo_norm(m) || E'\n' in E'\n' || pg_temp.memo_norm(t) || E'\n') > 0 $$;

create or replace function pg_temp.note_meta(body text) returns text language plpgsql immutable as $$
declare k int := position('-->' in coalesce(body, ''));
begin
  if body like '<!--p %' and k > 0 and position(E'\n' in substr(body, 1, k)) = 0 then
    return substr(body, 1, k + 2) || case when substr(body, k + 3, 1) = E'\n' then E'\n' else '' end;
  end if;
  return '';
end $$;

do $$
declare
  g record;
  keep record;
  o record;
  meta text;
  t text;
  ot text;
  before text;
begin
  for g in select item_id from public.notes where item_id is not null group by item_id having count(*) > 1 order by item_id loop
    select * into keep from public.notes where item_id = g.item_id order by created_at, id limit 1;
    before := keep.body;
    meta := pg_temp.note_meta(keep.body);
    t := substr(coalesce(keep.body, ''), length(meta) + 1);
    for o in select * from public.notes where item_id = g.item_id and id <> keep.id order by created_at, id loop
      if meta = '' then meta := pg_temp.note_meta(o.body); end if;
      ot := substr(coalesce(o.body, ''), length(pg_temp.note_meta(o.body)) + 1);
      if ot !~ '^\s*$' and not pg_temp.memo_has(t, ot) then
        t := case when t ~ '^\s*$' then ot
                  when right(t, 1) = E'\n' or left(ot, 1) = E'\n' then t || ot
                  else t || E'\n' || ot end;
      end if;
      insert into public.item_note_dedupe_101 (note_id, item_id, keep_id, note_row, keep_body_before)
      values (o.id, g.item_id, keep.id, to_jsonb(o), before);
      delete from public.notes where id = o.id;
    end loop;
    if (meta || t) is distinct from keep.body then
      update public.notes set body = meta || t, updated_at = now() where id = keep.id;
    end if;
    update public.item_note_dedupe_101 set keep_body_after = meta || t where keep_id = keep.id;
  end loop;
end $$;

create unique index if not exists notes_item_one on public.notes (item_id) where item_id is not null;
