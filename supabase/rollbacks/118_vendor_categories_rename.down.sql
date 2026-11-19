-- 118 되돌리기: 118 이 기록한 행(id)만 되돌린다. 두 번 돌려도 안전.
--   id 와 118 이 넣은 이름이 둘 다 맞을 때만 손댄다. 118 뒤 사용자가 그 행 이름을 바꿨거나(생산처→공장)
--   같은 이름으로 새 행을 만들었으면(새 생산처) 그 행·그 거래처는 건드리지 않고 기록만 지운다.
--   이름: 생산처→봉제, 인쇄→프린트 (옛 이름이 그새 다시 생겼으면 병합하지 않고 남김). vendors.category 는 FK cascade.
--   물류: 118 이 넣었고 아무 거래처도 안 쓸 때만 지운다(쓰는 거래처가 있으면 남김 — 거래처 분류를 '기타'로 떨어뜨리지 않는다).
do $d$
declare r record; left_n int := 0;
begin
  if to_regclass('public.mig118_vendor_category_log') is null then return; end if;
  for r in select * from public.mig118_vendor_category_log order by action desc, new_name loop
    if not exists (select 1 from public.vendor_categories where id = r.cat_id and name = r.new_name) then
      raise notice '118-down: % (id %) 이(가) 118 뒤에 바뀌었거나 없어져 그대로 둠', r.new_name, r.cat_id;
      delete from public.mig118_vendor_category_log where cat_id = r.cat_id; continue;
    end if;
    if r.action = 'rename' then
      if exists (select 1 from public.vendor_categories where name = r.old_name) then
        raise notice '118-down: % 이(가) 다시 생겨 % 을(를) 남김', r.old_name, r.new_name; left_n := left_n + 1; continue;
      end if;
      update public.vendor_categories set name = r.old_name where id = r.cat_id and name = r.new_name;
    else
      if exists (select 1 from public.vendors where category = r.new_name) then
        raise notice '118-down: % 을(를) 쓰는 거래처가 있어 남김', r.new_name; left_n := left_n + 1; continue;
      end if;
      delete from public.vendor_categories where id = r.cat_id and name = r.new_name;
    end if;
    delete from public.mig118_vendor_category_log where cat_id = r.cat_id;
  end loop;
  if left_n = 0 then drop table public.mig118_vendor_category_log; end if;
end $d$;
