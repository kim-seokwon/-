-- 082 되돌리기. 실행 전 start_date 값과 99_아카이브 보관 메모를 별도 백업한다.
begin;

drop function if exists public.create_product(uuid, uuid, text, text, date);

create or replace function public.create_product(
  p_company_id uuid, p_brand_id uuid, p_name text, p_deadline text default null)
returns uuid language plpgsql security definer set search_path = public as $function$
declare
  new_id uuid;
  v_role text;
begin
  perform public.require_role('MASTER', 'STAFF');
  v_role := public.get_user_role();
  if not coalesce(public.can_access_brand(p_brand_id), false) then
    raise exception '그 브랜드에 시즌을 만들 수 없습니다.' using errcode = '42501';
  end if;
  if p_company_id is not null then
    if v_role = 'MASTER' then
      if not exists (
        select 1 from companies c
         where c.id = p_company_id
           and (c.brand_id = p_brand_id or c.brand_id is null)
      ) then
        raise exception '그 회사 앞으로는 시즌을 만들 수 없습니다.' using errcode = '42501';
      end if;
    elsif p_company_id::text is distinct from public.get_user_company_id() then
      raise exception '직원은 자기 앞으로만 시즌을 만들 수 있습니다.' using errcode = '42501';
    end if;
  end if;
  insert into products (company_id, brand_id, name, deadline)
  values (p_company_id, p_brand_id, p_name, p_deadline)
  returning id into new_id;
  return new_id;
end;
$function$;

create or replace function public.delete_project_cascade(project_uuid uuid)
returns void language plpgsql security definer set search_path = public as $function$
declare
  v_brand uuid;
  v_company uuid;
  v_role text;
begin
  perform public.require_role('MASTER', 'STAFF');
  v_role := public.get_user_role();
  select p.brand_id, p.company_id into v_brand, v_company from products p where p.id = project_uuid;
  if not found then raise exception '없는 시즌입니다.' using errcode = 'P0002'; end if;
  if not coalesce(public.can_access_brand(v_brand), false) then
    raise exception '그 브랜드의 시즌이 아닙니다.' using errcode = '42501';
  end if;
  if v_role <> 'MASTER' and v_company is not null
     and v_company::text is distinct from public.get_user_company_id() then
    raise exception '다른 담당자 앞으로 된 시즌은 지울 수 없습니다.' using errcode = '42501';
  end if;
  delete from notes          where product_id = project_uuid;
  delete from reminders      where product_id = project_uuid;
  delete from product_items  where product_id = project_uuid;
  delete from todos          where product_id = project_uuid;
  delete from photos         where product_id = project_uuid;
  delete from documents      where product_id = project_uuid;
  delete from memos          where product_id = project_uuid;
  delete from product_stages where product_id = project_uuid;
  delete from history        where product_id = project_uuid;
  delete from products       where id = project_uuid;
end;
$function$;

revoke all on function public.create_product(uuid, uuid, text, text) from public, anon;
revoke all on function public.delete_project_cascade(uuid) from public, anon;
grant execute on function public.create_product(uuid, uuid, text, text) to authenticated;
grant execute on function public.delete_project_cascade(uuid) to authenticated;

alter table public.products drop column if exists start_date;
notify pgrst, 'reload schema';
commit;
