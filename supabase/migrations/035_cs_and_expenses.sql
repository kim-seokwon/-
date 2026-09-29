-- 노션 → 대시보드 이관: 실제로 쓰던 두 기능만 옮긴다.
--  노션 사용 실측(2026-09-29 내보내기 분석):
--   · 하이헤이호/로하이 CS 323건 — 2026-09-29까지 계속 기록 중. 유일하게 살아 있던 표.
--     교환 149 · 반품 128(=86%) / 카톡채널 275(=85%) / 공홈 291(=90%) / 상태는 314건이 '완료'
--     → 단계 관리는 사실상 안 썼고 "누가 무엇을 왜 교환/반품했나" 기록장으로 썼다.
--   · 법인카드 지출 448건 5,547만원 — 2026-02까지. 사용자·요청·계산서 칼럼은 448건 전부 빈칸 → 만들지 않는다.
--  나머지(독서기록·감정·습관·Second Brain·PARA)는 정착 실패라 옮기지 않는다.

-- ── CS(교환·반품) ─────────────────────────────────────────────
create table if not exists cs_tickets (
  id uuid primary key default gen_random_uuid(),
  occurred_on date not null default (now() at time zone 'Asia/Seoul')::date,
  customer_name text not null,
  kind text not null default '교환',           -- 교환·반품·오배송·불량·수선·기타
  status text not null default '접수',          -- 접수·수거접수·수거완료·완료
  purchase_from text,                           -- 공홈·키디키디·29cm·팝업·기타
  contact_channel text,                         -- 카톡채널·카톡오픈채팅·게시판·DM·전화
  brand_id uuid references brands(id),
  order_no text,                                -- 카페24 주문번호 (channel_orders.order_id)
  channel_order_id uuid references channel_orders(id) on delete set null,
  product_name text,
  exchange_product text,
  invoice_no text,                              -- 원송장번호
  memo text,
  created_by text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists idx_cs_occurred on cs_tickets(occurred_on desc);
create index if not exists idx_cs_status on cs_tickets(status);
create index if not exists idx_cs_order_no on cs_tickets(order_no);

-- ── 법인카드 지출 ──────────────────────────────────────────────
create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  spent_on date not null default (now() at time zone 'Asia/Seoul')::date,
  vendor text not null,                         -- 사용처
  amount numeric not null default 0,
  company text,                                 -- 하이헤이호·모마레·더하임프로모션·로하이스튜디오·브하스
  memo text,
  done boolean not null default false,          -- 노션 '완료' 체크
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists idx_exp_spent on expenses(spent_on desc);

-- ── 권한 ──────────────────────────────────────────────────────
-- 직원이 일상적으로 쓰는 업무 화면이라 조회·등록·수정은 로그인 사용자 전체,
-- 삭제만 MASTER (028의 "업무 이력이 실수로 사라지지 않게" 규칙과 동일).
alter table cs_tickets enable row level security;
alter table expenses  enable row level security;

drop policy if exists cs_select on cs_tickets;
create policy cs_select on cs_tickets for select to authenticated using (true);
drop policy if exists cs_insert on cs_tickets;
create policy cs_insert on cs_tickets for insert to authenticated with check (true);
drop policy if exists cs_update on cs_tickets;
create policy cs_update on cs_tickets for update to authenticated using (true);
drop policy if exists cs_delete on cs_tickets;
create policy cs_delete on cs_tickets for delete to authenticated using (get_user_role()='MASTER');

drop policy if exists exp_select on expenses;
create policy exp_select on expenses for select to authenticated using (true);
drop policy if exists exp_insert on expenses;
create policy exp_insert on expenses for insert to authenticated with check (true);
drop policy if exists exp_update on expenses;
create policy exp_update on expenses for update to authenticated using (true);
drop policy if exists exp_delete on expenses;
create policy exp_delete on expenses for delete to authenticated using (get_user_role()='MASTER');

notify pgrst, 'reload schema';
