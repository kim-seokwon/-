-- 087·088 적용 리허설 테스트. 사용: begin; <087> <088> <이 파일> rollback; 을 한 쿼리로 — 끝의 raise 가 전부 되돌린다.
-- 결과는 에러 메시지 REHEARSAL_RESULT 한 줄. (BAD) 가 하나라도 있으면 실패. 사용자 이름·고객 내용은 출력하지 않는다.
do $t$
declare acc uuid[]; r text := ''; bid uuid; oid2 uuid; ck text; cnm text; cph text; clast timestamptz; e0 json; e1 json; okid uuid; cid uuid; dupid uuid; before_n int; after_n int; master_n int; stafjwt text; v text; okb text; nob text; j json;
begin
  select brand_access into acc from companies where role='STAFF' limit 1;
  -- 허용 브랜드 중 주문 많은 것(okb)·적은 것(C, 동명 리허설에서 권한 밖으로 옮길 대상)
  select b.id, b.name into okid, okb from brands b join malls m on m.brand_id=b.id join channel_orders o on o.mall_key=m.mall_key
   where b.id = any(acc) group by b.id, b.name order by count(*) desc limit 1;
  select b.id into cid from brands b join malls m on m.brand_id=b.id join channel_orders o on o.mall_key=m.mall_key
   where b.id = any(acc) and b.id <> okid group by b.id order by count(*) asc limit 1;
  select name into nob from brands b where not (b.id = any(coalesce(acc,'{}'))) limit 1;

  -- 1) 익명: 업로드·목록
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  begin insert into storage.objects(bucket_id, name) values ('bhas','rehearsal/anon.txt'); r := r || 'anon_insert=ALLOWED(BAD) ';
  exception when others then r := r || 'anon_insert=denied(' || sqlstate || ') '; end;
  select count(*)::text into v from storage.objects where bucket_id='bhas'; r := r || 'anon_list=' || v || ' ';
  begin update storage.objects set name = name where bucket_id='bhas'; get diagnostics v = row_count; r := r || 'anon_update_rows=' || v || ' ';
  exception when others then r := r || 'anon_update=denied(' || sqlstate || ') '; end;
  begin delete from storage.objects where bucket_id='bhas'; get diagnostics v = row_count; r := r || 'anon_delete_rows=' || v || ' ';
  exception when others then r := r || 'anon_delete=denied(' || sqlstate || ') '; end;
  begin perform public.brand_customers(okb); r := r || 'anon_bc=ALLOWED(BAD) ';
  exception when others then r := r || 'anon_bc=denied(' || sqlstate || ') '; end;
  reset role;

  -- 2) 회사 없는 로그인 사용자
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"no-such-user-rehearsal@x"}', true);
  set local role authenticated;
  begin insert into storage.objects(bucket_id, name) values ('bhas','rehearsal/nocompany.txt'); r := r || 'nocomp_insert=ALLOWED(BAD) ';
  exception when others then r := r || 'nocomp_insert=denied(' || sqlstate || ') '; end;
  begin perform public.brand_gone_counts(okb); r := r || 'nocomp_bg=ALLOWED(BAD) ';
  exception when others then r := r || 'nocomp_bg=denied(' || sqlstate || ') '; end;
  reset role;

  -- 3) STAFF (brand_access 3개)
  perform set_config('request.jwt.claims', json_build_object('role','authenticated','email',(select username from companies where role='STAFF' limit 1)||'@x')::text, true);
  set local role authenticated;
  select count(*)::text into v from storage.objects where bucket_id='bhas'; r := r || 'staff_list=' || v || ' ';
  begin insert into storage.objects(bucket_id, name) values ('bhas','rehearsal/staff.txt'); r := r || 'staff_insert=ok ';
  exception when others then r := r || 'staff_insert=DENIED(BAD ' || sqlstate || ') '; end;
  begin j := public.brand_customers(okb, null, null, 'all', 90, 5); r := r || 'staff_bc_own=ok(len ' || json_array_length(j) || ') ';
  exception when others then r := r || 'staff_bc_own=DENIED(BAD ' || sqlstate || ') '; end;
  begin j := public.brand_gone_counts(okb); r := r || 'staff_bg_own=ok(customers ' || (j->>'customers') || ') ';
  exception when others then r := r || 'staff_bg_own=DENIED(BAD ' || sqlstate || ') '; end;
  begin perform public.brand_customers(nob); r := r || 'staff_bc_other=ALLOWED(BAD) ';
  exception when others then r := r || 'staff_bc_other=denied(' || sqlstate || ') '; end;
  begin perform public.brand_gone_counts(nob); r := r || 'staff_bg_other=ALLOWED(BAD) ';
  exception when others then r := r || 'staff_bg_other=denied(' || sqlstate || ') '; end;
  begin perform public.brand_customers('없는브랜드'); r := r || 'staff_bc_missing=ALLOWED(BAD) ';
  exception when others then r := r || 'staff_bc_missing=denied(' || sqlstate || ') '; end;
  reset role;

  -- 4) MASTER — 4개 브랜드 전부
  perform set_config('request.jwt.claims', json_build_object('role','authenticated','email',(select username from companies where role='MASTER' limit 1)||'@x')::text, true);
  set local role authenticated;
  begin j := public.brand_gone_counts(nob); r := r || 'master_bg_any=ok(customers ' || (j->>'customers') || ') ';
  exception when others then r := r || 'master_bg_any=DENIED(BAD ' || sqlstate || ') '; end;
  reset role;

  -- 5) service_role
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
  begin j := public.brand_gone_counts(nob); r := r || 'svc_bg=ok ';
  exception when others then r := r || 'svc_bg=DENIED(BAD ' || sqlstate || ') '; end;
  reset role;

  -- 6) 동명 브랜드(10-19 코덱스 반려 회귀): okb 와 이름이 같은 권한 밖 브랜드 B 를 만들고 C 의 몰을 B 로 옮긴다.
  --    STAFF 의 okb 결과는 그대로여야 하고(섞이지 않음), MASTER 는 B 까지 보여 늘어난다(섞일 데이터가 실제로 있다는 확인).
  stafjwt := json_build_object('role','authenticated','email',(select username from companies where role='STAFF' limit 1)||'@x')::text;
  perform set_config('request.jwt.claims', stafjwt, true); set local role authenticated;
  before_n := (public.brand_gone_counts(okb)->>'customers')::int;
  reset role;
  insert into brands(name) values (okb) returning id into dupid;
  update malls set brand_id = dupid where brand_id = cid;
  perform set_config('request.jwt.claims', stafjwt, true); set local role authenticated;
  begin
    after_n := (public.brand_gone_counts(okb)->>'customers')::int;
    r := r || case when after_n = before_n then 'staff_dup_bg=same(ok) ' else 'staff_dup_bg=CHANGED(BAD) ' end;
    j := public.brand_customers(okb, null, null, 'all', 90, 1000);
    r := r || 'staff_dup_bc=ok(len ' || json_array_length(j) || ') ';
  exception when others then r := r || 'staff_dup=ERR(BAD ' || sqlstate || ') '; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('role','authenticated','email',(select username from companies where role='MASTER' limit 1)||'@x')::text, true);
  set local role authenticated;
  master_n := (public.brand_gone_counts(okb)->>'customers')::int;
  r := r || case when master_n > before_n then 'master_dup_bg=grew(ok) ' else 'master_dup_bg=SAME(BAD: 리허설 데이터 무효) ' end;
  reset role;

  -- 7) 보조조회(10-19 2차 반려 회귀): okb 의 구매액 1위 고객과 같은 전화·이름·주문시각으로 권한 밖 브랜드 B 에 주문·상품·CS 를 넣는다.
  --    STAFF 의 okb 결과에서 그 고객의 cs·last_items 가 그대로여야 한다(B 상품명·CS 가 섞이지 않음).
  select coalesce(nullif(o.receiver_phone,''), o.receiver_name, o.buyer_name), max(o.receiver_name), max(o.receiver_phone), max(o.order_date)
    into ck, cnm, cph, clast
    from channel_orders o join malls m on m.mall_key = o.mall_key
   where m.brand_id = okid and coalesce(nullif(o.receiver_phone,''), o.receiver_name, o.buyer_name) is not null
     and coalesce(o.channel_status,'') !~ '^[CR]'
   group by 1 order by sum(coalesce(o.pay_amount,0)) desc limit 1;
  perform set_config('request.jwt.claims', stafjwt, true); set local role authenticated;
  e0 := public.brand_customers(okb, null, null, 'all', 90, 1) -> 0;
  reset role;
  insert into brands(name) values ('REHEARSAL_B_' || md5(random()::text)) returning id into bid;
  insert into malls(mall_key, label, brand_id) values ('rehearsal_mall_b', 'rehearsal', bid);
  insert into channel_orders(order_id, mall_key, receiver_phone, receiver_name, buyer_name, order_date, pay_amount, op_status)
    values ('REHEARSAL-LEAK-1', 'rehearsal_mall_b', cph, cnm, cnm, clast, 0, 'new') returning id into oid2;
  insert into channel_order_items(channel_order_id, product_name) values (oid2, 'REHEARSAL_LEAK_ITEM');
  insert into cs_tickets(customer_name, brand_id, order_no, occurred_on) values (cnm, bid, 'REHEARSAL-LEAK-1', current_date);
  insert into cs_tickets(customer_name, brand_id, order_no, occurred_on) values ('rehearsal-nobody', null, 'REHEARSAL-LEAK-1', current_date);
  perform set_config('request.jwt.claims', stafjwt, true); set local role authenticated;
  begin
    e1 := public.brand_customers(okb, null, null, 'all', 90, 1) -> 0;
    r := r || case when (e1->>'phone') is not distinct from (e0->>'phone') then '' else 'staff_side_row=DIFF(BAD) ' end;
    r := r || case when (e1->>'cs') is not distinct from (e0->>'cs') then 'staff_side_cs=same(ok) ' else 'staff_side_cs=CHANGED(BAD) ' end;
    r := r || case when coalesce(e1->>'last_items','') not like '%REHEARSAL_LEAK%' and (e1->>'last_items') is not distinct from (e0->>'last_items')
                   then 'staff_side_items=same(ok) ' else 'staff_side_items=LEAK(BAD) ' end;
  exception when others then r := r || 'staff_side=ERR(BAD ' || sqlstate || ') '; end;
  reset role;

  raise exception 'REHEARSAL_RESULT %', r;
end $t$;
