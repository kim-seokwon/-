-- 시즌 단계 모듈 — 시즌을 만들면 이 차례대로 메모가 깔린다
-- 오픈일(products.deadline) 을 0 으로 두고 offset_days 만큼 앞뒤로 날짜가 잡힌다.
create table if not exists season_steps (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid references brands(id) on delete cascade,   -- 비어 있으면 모든 브랜드 공통
  name text not null,
  offset_days int not null default 0,     -- 음수면 오픈 전, 양수면 오픈 뒤
  checklist text[] default '{}',
  icon text default 'ph-circle',
  color text default '#8e8e93',
  sort int not null default 0,
  on_default boolean not null default true,   -- 시즌 만들 때 기본으로 켜져 있나
  active boolean not null default true,
  created_at timestamptz default now(),
  unique (brand_id, name)
);
create index if not exists idx_season_steps_sort on season_steps(sort);

alter table season_steps enable row level security;
drop policy if exists sstep_sel on season_steps;
drop policy if exists sstep_ins on season_steps;
drop policy if exists sstep_upd on season_steps;
drop policy if exists sstep_del on season_steps;
create policy sstep_sel on season_steps for select to authenticated using (true);
create policy sstep_ins on season_steps for insert to authenticated with check (get_user_role() = any (array['MASTER','STAFF']));
create policy sstep_upd on season_steps for update to authenticated using (get_user_role() = any (array['MASTER','STAFF']));
create policy sstep_del on season_steps for delete to authenticated using (get_user_role() = 'MASTER');

-- 기본 모듈 (브랜드 공통). 간격은 사장님 실측(촬영 10/8 · 오픈 10/14)에 맞췄다.
insert into season_steps (brand_id, name, offset_days, sort, icon, color, on_default, checklist) values
 (null, '샘플',   -60, 1, 'ph-scissors',        '#bf5af2', true,  array['원단 확정','샘플 발주','샘플 검토','수정 요청']),
 (null, '제작',   -45, 2, 'ph-factory',         '#6366f1', true,  array['작업지시서 작성','원부자재 발주','생산 투입','검품']),
 (null, '촬영',    -7, 3, 'ph-camera',          '#ff9f0a', true,  array['레퍼런스 정리','모델·스튜디오 예약','촬영','셀렉','보정']),
 (null, '마케팅',  -5, 4, 'ph-megaphone',       '#ff375f', true,  array['상세페이지','배너 제작','SNS 예고','광고 세팅']),
 (null, '오픈',     0, 5, 'ph-storefront',      '#0a84ff', true,  array['상품 등록','가격·재고 확인','오픈 점검']),
 (null, '출고',     1, 6, 'ph-package',         '#30d158', true,  array['포장재 준비','출고','송장 등록']),
 (null, '행사',    14, 7, 'ph-confetti',        '#ffd60a', false, array['장소·일정 확정','집기·배너','인력 배치','정산'])
on conflict (brand_id, name) do nothing;
