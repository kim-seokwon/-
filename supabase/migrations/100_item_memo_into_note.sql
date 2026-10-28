-- 100 제품 메모 한 곳으로 — 한 줄 메모(product_items.memo)를 제품 메모 장(notes, item_id)으로 옮긴다 (10-28 지시서 .work/개발/제품리스트-편의.md)
--
-- 왜: 사장님 10-28 "메모랑 기록 두번씩쓰고있네". 제품 페이지에 적는 칸이 둘(위 '메모' 한 줄 + 아래 '기록' 큰 칸)이라
--      어디에 적을지 헷갈려 옮겨 적고(나그랑 맨투맨), 같은 말을 두 번 적었다(니트 비니·벤투스JP).
--      화면은 이제 장 하나만 쓰고, 목록 '메모' 열은 그 장의 첫 줄을 보여준다.
--
-- 옮기는 규칙(화면 main.js _itemMemoText 와 같다 — 옮기기 전에 화면이 보여주던 글 = 옮긴 뒤 장의 글):
--   한 줄 메모 m(앞뒤 공백 뺌), 장의 글 t(맨 앞 메타 줄 <!--p …--> 은 그대로 둔다)
--   · 장이 없으면 m 만 담은 장을 새로 만든다
--   · t 안에 m 이 줄 단위로 통째 있으면 t 그대로(부분 글자 일치는 '있음' 아님 — 옛 '입고' + 장 '미입고' → 둘 다 남김)
--   · t 가 비었으면 m
--   · 아니면 m + 줄바꿈 + t
--   그리고 product_items.memo 를 비운다. 장이 둘인 제품(헨리넥)은 먼저 만든 장에 붙인다 — 두 장 합치기는 101(승인 뒤).
-- 잃지 않게: 옮긴 줄마다 원래 값을 item_memo_merge_100 에 남긴다(되돌리기가 이걸 쓴다). 이 표는 RLS 켜고 정책 없음 = API 로 안 보임.
-- 다시 돌려도 안전: 이미 옮긴 제품은 건너뛴다.
-- 되돌리기: supabase/rollbacks/100_item_memo_into_note.down.sql

create table if not exists public.item_memo_merge_100 (
  item_id      uuid primary key,
  memo         text not null,           -- 원래 한 줄 메모(그대로)
  note_id      uuid not null,
  note_created boolean not null,        -- 100 이 새로 만든 장인가
  body_before  text,                    -- 장의 원래 body(새로 만든 장이면 null)
  body_after   text not null,           -- 100 이 써 넣은 body
  merged_at    timestamptz not null default now()
);
alter table public.item_memo_merge_100 enable row level security;
revoke all on public.item_memo_merge_100 from public, anon, authenticated;

--  '이미 들어 있음' = 줄 단위로 통째 들어 있을 때만(각 줄 앞뒤 공백·탭 뺌) — '미입고' 안의 '입고'는 아니다. 화면 main.js _memoHas 와 같다.
create or replace function pg_temp.memo_norm(s text) returns text language sql immutable as $$
  select btrim(coalesce(string_agg(btrim(x, E' \t\r'), E'\n' order by o), ''), E'\n')
    from unnest(string_to_array(coalesce(s, ''), E'\n')) with ordinality as u(x, o) $$;
create or replace function pg_temp.memo_has(t text, m text) returns boolean language sql immutable as $$
  select pg_temp.memo_norm(m) = ''
      or position(E'\n' || pg_temp.memo_norm(m) || E'\n' in E'\n' || pg_temp.memo_norm(t) || E'\n') > 0 $$;

do $$
declare
  r record;
  n record;
  m text;
  meta text;
  t text;
  nt text;
  k int;
  nid uuid;
begin
  for r in
    select i.id, i.name, i.memo, i.product_id, i.brand_id
      from public.product_items i
     where i.memo is not null and i.memo !~ '^\s*$'
       and not exists (select 1 from public.item_memo_merge_100 b where b.item_id = i.id)
     order by i.id
  loop
    m := btrim(r.memo, E' \t\r\n');
    select * into n from public.notes where item_id = r.id order by created_at, id limit 1;
    if found then
      --  메타 줄: 화면 NOTE_META_RE = /^<!--p (.*?)-->\n?/ — 첫 '-->' 까지(줄바꿈 없이) + 뒤 줄바꿈 하나
      meta := '';
      k := position('-->' in coalesce(n.body, ''));
      if n.body like '<!--p %' and k > 0 and position(E'\n' in substr(n.body, 1, k)) = 0 then
        meta := substr(n.body, 1, k + 2);
        if substr(n.body, k + 3, 1) = E'\n' then meta := meta || E'\n'; end if;
      end if;
      t := substr(coalesce(n.body, ''), length(meta) + 1);
      if pg_temp.memo_has(t, m) then nt := t;
      elsif t ~ '^\s*$' then nt := m;
      else nt := m || E'\n' || t;
      end if;
      if (meta || nt) is distinct from n.body then
        update public.notes set body = meta || nt, updated_at = now() where id = n.id;
      end if;
      insert into public.item_memo_merge_100 (item_id, memo, note_id, note_created, body_before, body_after)
      values (r.id, r.memo, n.id, false, n.body, meta || nt);
    else
      insert into public.notes (title, body, item_id, product_id, brand_id, folder, scope, created_by)
      values (coalesce(nullif(r.name, ''), '제품'), m, r.id, r.product_id, r.brand_id,
              coalesce((select p.name from public.products p where p.id = r.product_id), '제품'),
              case when r.product_id is null then 'shared' else 'project' end, '메모 합치기(100)')
      returning id into nid;
      insert into public.item_memo_merge_100 (item_id, memo, note_id, note_created, body_before, body_after)
      values (r.id, r.memo, nid, true, null, m);
    end if;
    update public.product_items set memo = null where id = r.id;
  end loop;
end $$;
