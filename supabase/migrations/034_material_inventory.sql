-- 원단·부자재 재고관리
-- 완제품 inventory_items와 분리: 소수 단위(m/yd/kg), 거래처, 보관위치, 생산사용 원장을 다룬다.

create table if not exists material_items (
  id             uuid primary key default gen_random_uuid(),
  material_code  text not null unique,
  category       text not null check (category in ('fabric','accessory','packaging','other')),
  name           text not null,
  color          text,
  spec           text,
  unit           text not null default '개',
  on_hand        numeric(14,3) not null default 0 check (on_hand >= 0),
  safety_stock   numeric(14,3) not null default 0 check (safety_stock >= 0),
  unit_cost      numeric(14,2) not null default 0 check (unit_cost >= 0),
  vendor_id      uuid references vendors(id) on delete set null,
  brand_id       uuid references brands(id) on delete set null,
  location       text,
  memo           text,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_material_items_category on material_items(category, active);
create index if not exists idx_material_items_vendor on material_items(vendor_id);
create index if not exists idx_material_items_low_stock on material_items(on_hand, safety_stock) where active;

create table if not exists material_ledger (
  id                uuid primary key default gen_random_uuid(),
  material_item_id  uuid not null references material_items(id) on delete restrict,
  delta             numeric(14,3) not null check (delta <> 0),
  reason            text not null check (reason in ('initial','purchase','production_use','sample_use','waste','return','adjust')),
  ref               text,
  note              text,
  movement_date     date not null default current_date,
  created_at        timestamptz not null default now(),
  created_by        text
);

create index if not exists idx_material_ledger_item on material_ledger(material_item_id, created_at desc);
create index if not exists idx_material_ledger_date on material_ledger(movement_date desc);

-- 동시 입력에서도 재고가 음수로 내려가지 않게 품목 행을 잠그고 원자적으로 반영한다.
create or replace function apply_material_ledger()
returns trigger as $$
declare current_qty numeric(14,3);
begin
  select on_hand into current_qty from material_items where id = new.material_item_id for update;
  if current_qty is null then raise exception '원부자재 품목을 찾을 수 없습니다.'; end if;
  if current_qty + new.delta < 0 then raise exception '재고는 0 미만이 될 수 없습니다.'; end if;
  update material_items set on_hand = on_hand + new.delta, updated_at = now() where id = new.material_item_id;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_material_ledger on material_ledger;
create trigger trg_material_ledger before insert on material_ledger
  for each row execute function apply_material_ledger();

create or replace function touch_material_item()
returns trigger as $$ begin new.updated_at = now(); return new; end; $$ language plpgsql;
drop trigger if exists trg_material_item_touch on material_items;
create trigger trg_material_item_touch before update on material_items
  for each row execute function touch_material_item();

-- 품목과 초기재고를 하나의 트랜잭션으로 등록한다.
create or replace function create_material_item(
  p_material_code text, p_category text, p_name text, p_color text, p_spec text,
  p_unit text, p_initial_qty numeric, p_safety_stock numeric, p_unit_cost numeric,
  p_vendor_id uuid, p_brand_id uuid, p_location text, p_memo text, p_created_by text
) returns uuid as $$
declare new_id uuid;
begin
  insert into material_items(material_code, category, name, color, spec, unit, safety_stock, unit_cost, vendor_id, brand_id, location, memo)
  values (p_material_code, p_category, p_name, nullif(p_color,''), nullif(p_spec,''), p_unit,
          greatest(coalesce(p_safety_stock,0),0), greatest(coalesce(p_unit_cost,0),0), p_vendor_id, p_brand_id, nullif(p_location,''), nullif(p_memo,''))
  returning id into new_id;
  if coalesce(p_initial_qty,0) <> 0 then
    insert into material_ledger(material_item_id, delta, reason, note, created_by)
    values (new_id, p_initial_qty, 'initial', '초기 등록', p_created_by);
  end if;
  return new_id;
end;
$$ language plpgsql;

alter table material_items enable row level security;
alter table material_ledger enable row level security;

drop policy if exists material_items_select on material_items;
drop policy if exists material_items_insert on material_items;
drop policy if exists material_items_update on material_items;
drop policy if exists material_items_delete on material_items;
create policy material_items_select on material_items for select using (get_user_role() in ('MASTER','STAFF'));
create policy material_items_insert on material_items for insert with check (get_user_role() in ('MASTER','STAFF'));
create policy material_items_update on material_items for update using (get_user_role() in ('MASTER','STAFF')) with check (get_user_role() in ('MASTER','STAFF'));
create policy material_items_delete on material_items for delete using (get_user_role() = 'MASTER');

drop policy if exists material_ledger_select on material_ledger;
drop policy if exists material_ledger_insert on material_ledger;
create policy material_ledger_select on material_ledger for select using (get_user_role() in ('MASTER','STAFF'));
create policy material_ledger_insert on material_ledger for insert with check (
  get_user_role() in ('MASTER','STAFF')
  and reason in ('initial','purchase','production_use','sample_use','waste','return','adjust')
);

revoke all on function create_material_item(text,text,text,text,text,text,numeric,numeric,numeric,uuid,uuid,text,text,text) from public;
grant execute on function create_material_item(text,text,text,text,text,text,numeric,numeric,numeric,uuid,uuid,text,text,text) to authenticated;

select 'material inventory schema installed' as status;
