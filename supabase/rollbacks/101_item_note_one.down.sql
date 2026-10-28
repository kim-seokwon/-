-- 101 되돌리기: 하나 규칙을 풀고, 지운 장을 행 그대로 되살리고, 남긴 장 body 를 101 전으로.
--   101 뒤에 남긴 장을 사람이 고쳤으면 body 는 그대로 둔다(고친 글을 잃지 않게) — 되살린 장과 글이 겹칠 수 있다. NOTICE 로 알린다.

drop index if exists public.notes_item_one;

do $$
declare
  b record;
  cur text;
begin
  if to_regclass('public.item_note_dedupe_101') is null then return; end if;
  for b in select * from public.item_note_dedupe_101 order by merged_at, note_id loop
    insert into public.notes select * from jsonb_populate_record(null::public.notes, b.note_row)
      on conflict (id) do nothing;
  end loop;
  for b in select distinct on (keep_id) * from public.item_note_dedupe_101 order by keep_id loop
    select body into cur from public.notes where id = b.keep_id;
    if found and cur is not distinct from b.keep_body_after then
      update public.notes set body = b.keep_body_before where id = b.keep_id;
    elsif found then
      raise notice '101 되돌리기: 남긴 장 % 은 101 뒤에 고쳐져 body 그대로 둠', b.keep_id;
    end if;
  end loop;
end $$;

drop table if exists public.item_note_dedupe_101;
