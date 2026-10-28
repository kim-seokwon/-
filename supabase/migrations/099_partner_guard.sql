-- 099 파트너(컨설팅 클라이언트, 역할 CLIENT) 계정 막기 — 자기 브랜드 생산만 '보기' (10-28 지시서 .work/개발/파트너계정.md)
--
-- 왜: 지금 정책 대부분이 'auth.uid() IS NOT NULL'(로그인만 하면) 또는 'true' 라서, 외부 계정을 하나 만들면
--      메모·할일·기록·사진·문서·인스타·뉴스·싱크로그·시즌(brand NULL) 등을 브랜드 상관없이 읽고 일부는 쓸 수 있었다(10-28 pg_policies 확인).
--
-- 방법: 기존 정책(전부 PERMISSIVE)은 하나도 안 건드리고, public 의 RLS 켜진 모든 표에 RESTRICTIVE 정책 4개(읽기·넣기·고치기·지우기)를 얹는다.
--   RESTRICTIVE 는 기존 정책과 AND 로 묶인다 → 직원(MASTER·STAFF, is_staff())은 지금과 똑같고, 그 밖의 로그인 계정은
--   아래 '파트너가 읽어도 되는 것'만 읽고 아무것도 못 쓴다. 대상은 authenticated 만 — anon·service_role(엣지함수)은 지금 그대로.
--   파트너가 읽어도 되는 것(그것도 기존 정책을 통과한 것 중에서만):
--     companies      자기 계정 행 하나
--     brands         자기 브랜드(can_access_brand)
--     products       자기 브랜드 시즌(brand_id NULL 시즌은 안 보임)
--     product_stages·photos  자기 브랜드 시즌에 붙은 것
--     season_steps   시즌 단계 틀(공통 틀 = brand_id NULL 포함)
--   product_items 는 표를 막고, 안전한 열만 내주는 partner_items() 로 준다(memo·vendor_id·quote_id·tech_pack_id·pattern_no·trims·checked·created_by 빠짐).
--   보기는 security_invoker 라 밑 표의 막힘을 그대로 따른다(10-28 확인: 17개 모두 security_invoker=true).
-- SECURITY DEFINER 함수(RLS 를 안 탄다) 중 로그인 계정이 부를 수 있고 직원 전용 자료를 돌려주는 6개는 첫머리에 직원 검사(require_staff)를 넣는다:
--   morning_brief · get_channel_operational_status · reap_apify_runs · brand_customers · brand_gone_counts · brand_vip_rank_changes
--   (weekly_brief 는 이미 전 브랜드 권한이 없으면 42501 — 파트너는 거절됨. create_*/delete_* 는 require_role 로 이미 막힘)
--   본문은 운영에 깔린 정의를 그대로 읽어(pg_get_functiondef) 검사 한 줄만 끼운다 → 운영 본문과 어긋날 일이 없다.
-- storage.objects 도 같은 방식으로 읽기를 직원만(bhas 버킷 파일 목록). bhas 는 public 버킷이라 주소를 아는 파일은 여전히 열린다.
-- 새 표를 만들면 이 정책이 자동으로 안 붙는다 → 이 파일을 다시 돌리면 붙는다(재실행 안전).
-- 되돌리기: supabase/rollbacks/099_partner_guard.down.sql

-- 1) 직원 검사: 로그인 계정(JWT role authenticated·anon)인데 직원이 아니면 42501. 엣지함수(service_role)·크론(JWT 없음)은 통과.
create or replace function public.require_staff()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(auth.jwt()->>'role', '') in ('authenticated', 'anon') and not public.is_staff() then
    raise exception 'forbidden: staff only' using errcode = '42501';
  end if;
end $$;
revoke all on function public.require_staff() from public, anon;
grant execute on function public.require_staff() to authenticated, service_role;

-- 2) 파트너 제품 목록 — 자기 브랜드 제품의 보여도 되는 열만. 시즌 이름은 같은 브랜드(또는 공통) 시즌일 때만.
create or replace function public.partner_items()
returns table (id uuid, brand_id uuid, product_id uuid, season_name text, name text, sale_names text[],
               status text, ship_date date, open_date date, sort integer, created_at timestamptz, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select i.id, i.brand_id, i.product_id,
         case when p.brand_id is null or p.brand_id = i.brand_id then p.name end,
         i.name, i.sale_names, i.status, i.ship_date, i.open_date, i.sort, i.created_at, i.updated_at
    from product_items i
    left join products p on p.id = i.product_id
   where i.brand_id is not null
     and public.can_access_brand(i.brand_id)
   order by i.sort nulls last, i.created_at desc
$$;
revoke all on function public.partner_items() from public, anon;
grant execute on function public.partner_items() to authenticated, service_role;

-- 3) 모든 표에 RESTRICTIVE 정책
do $$
declare
  t text;
  allow text;
  own_season text := 'exists (select 1 from public.products p where p.id = %I.product_id and p.brand_id is not null and public.can_access_brand(p.brand_id))';
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
     order by 1
  loop
    allow := case t
      when 'companies'      then 'id::text = (select public.get_user_company_id())'
      when 'brands'         then 'public.can_access_brand(id)'
      when 'products'       then 'brand_id is not null and public.can_access_brand(brand_id)'
      when 'product_stages' then format(own_season, t)
      when 'photos'         then format(own_season, t)
      when 'season_steps'   then 'brand_id is null or public.can_access_brand(brand_id)'
      else 'false'
    end;
    execute format('drop policy if exists partner_guard_select on public.%I', t);
    execute format('drop policy if exists partner_guard_insert on public.%I', t);
    execute format('drop policy if exists partner_guard_update on public.%I', t);
    execute format('drop policy if exists partner_guard_delete on public.%I', t);
    execute format('create policy partner_guard_select on public.%I as restrictive for select to authenticated using ((select public.is_staff()) or (%s))', t, allow);
    execute format('create policy partner_guard_insert on public.%I as restrictive for insert to authenticated with check ((select public.is_staff()))', t);
    execute format('create policy partner_guard_update on public.%I as restrictive for update to authenticated using ((select public.is_staff())) with check ((select public.is_staff()))', t);
    execute format('create policy partner_guard_delete on public.%I as restrictive for delete to authenticated using ((select public.is_staff()))', t);
  end loop;
end $$;

-- 4) 스토리지 파일 목록 읽기도 직원만(쓰기·지우기는 087·092·093 에서 이미 직원만)
drop policy if exists partner_guard_select on storage.objects;
create policy partner_guard_select on storage.objects as restrictive for select to authenticated using ((select public.is_staff()));

-- 5) SECURITY DEFINER 함수 6개 첫머리에 직원 검사 — 운영 정의를 읽어 한 줄만 끼운다(이미 끼웠으면 건너뜀)
--    sql 함수: 본문 첫 문장으로 'select public.require_staff();' (sql 함수는 마지막 문장 결과를 돌려준다)
--    plpgsql 함수: 첫 begin 바로 뒤에 'perform public.require_staff();'
--    끼운 줄 끝에 줄바꿈을 붙인다 — 원래 본문이 'AS $function$ select …'·'begin …' 처럼 같은 줄에 이어지면 주석(--)에 먹히기 때문
do $$
declare
  f record;
  d text;
  k int;
  head text;
  body text;
begin
  for f in
    select p.oid, l.lanname from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_language l on l.oid = p.prolang
     where n.nspname = 'public'
       and p.proname in ('morning_brief', 'get_channel_operational_status', 'reap_apify_runs',
                         'brand_customers', 'brand_gone_counts', 'brand_vip_rank_changes')
  loop
    d := pg_get_functiondef(f.oid);
    continue when position('-- 099 partner guard' in d) > 0;
    k := position('AS $function$' in d);
    if k = 0 then raise exception '099: % 정의에서 본문 시작을 못 찾음', f.oid::regprocedure; end if;
    head := substr(d, 1, k + length('AS $function$') - 1);
    body := substr(d, k + length('AS $function$'));
    if f.lanname = 'sql' then
      body := E'\nselect public.require_staff(); -- 099 partner guard\n' || body;
    elsif f.lanname = 'plpgsql' then
      if body !~* '\mbegin\M' then raise exception '099: % 에 begin 이 없음', f.oid::regprocedure; end if;
      body := regexp_replace(body, '\m(begin)\M', E'\\1\n  perform public.require_staff(); -- 099 partner guard\n', 'i');
    else
      raise exception '099: % 언어 % 는 처리 안 함', f.oid::regprocedure, f.lanname;
    end if;
    execute head || body;
  end loop;
end $$;
