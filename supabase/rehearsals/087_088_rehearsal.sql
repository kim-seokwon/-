-- 087·088 적용 리허설 테스트. 사용: begin; <087> <088> <이 파일> rollback; 을 한 쿼리로 — 끝의 raise 가 전부 되돌린다.
-- 결과는 에러 메시지 REHEARSAL_RESULT 한 줄. (BAD) 가 하나라도 있으면 실패. 사용자 이름·고객 내용은 출력하지 않는다.
do $t$
declare acc uuid[]; r text := ''; v text; okb text; nob text; j json;
begin
  select brand_access into acc from companies where role='STAFF' limit 1;
  select name into okb from brands b where b.id = any(acc) limit 1;
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

  raise exception 'REHEARSAL_RESULT %', r;
end $t$;
