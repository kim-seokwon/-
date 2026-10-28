-- 100 되돌리기: 옮긴 한 줄 메모를 product_items.memo 에 되돌리고, 장은 100 전으로.
--   100 뒤에 사람이 그 장을 고쳤으면(body 가 100 이 써 넣은 것과 다름) 장은 건드리지 않는다 — 고친 글을 잃지 않게.
--   이때 한 줄 메모는 되돌아오므로 같은 말이 두 곳에 남을 수 있다(잃는 것은 없음). 그런 제품은 NOTICE 로 알린다.
--   100 이 새로 만든 장은 고친 적 없을 때만 지운다(그 내용은 되돌린 한 줄 메모에 그대로 있다).

do $$
declare
  b record;
  cur text;
begin
  if to_regclass('public.item_memo_merge_100') is null then return; end if;
  for b in select * from public.item_memo_merge_100 order by item_id loop
    update public.product_items set memo = b.memo where id = b.item_id;
    select body into cur from public.notes where id = b.note_id;
    if not found then
      raise notice '100 되돌리기: 제품 % 의 장 % 이 이미 없음(한 줄 메모만 되돌림)', b.item_id, b.note_id;
    elsif cur is distinct from b.body_after then
      raise notice '100 되돌리기: 제품 % 의 장 % 은 100 뒤에 고쳐져 그대로 둠', b.item_id, b.note_id;
    elsif b.note_created then
      delete from public.notes where id = b.note_id;
    elsif b.body_before is distinct from cur then
      update public.notes set body = b.body_before where id = b.note_id;
    end if;
  end loop;
end $$;

drop table if exists public.item_memo_merge_100;
