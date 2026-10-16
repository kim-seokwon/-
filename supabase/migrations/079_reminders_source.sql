-- 할 일(reminders)에 '어디서 만든 할 일인지' 출처 칸을 단다. (양방향 연동 1단계 — 설계서 .work/양방향연동/설계서.md '변경')
--
-- 왜: 캘린더 빠른 추가·3단계(제품·거래처·시즌 화면)에서 만든 할 일을 그 화면으로 되돌아가게(출처 칩) 하려면 출처가 있어야 한다.
--     메모 [ ] 줄은 여기로 복사하지 않는다 — 메모 줄 자체가 원본이고 화면에서 읽어 합친다.
--
-- 바뀌는 것 (칸 추가만 — 기존 행·정책 그대로, 기존 2건은 source_kind = null = 직접 추가):
--   source_kind  text  note·item·season·vendor·calendar·manual 중 하나(또는 null)
--   source_id    text  출처 행 id (메모·제품·시즌·거래처 id 를 글자로)
--   item_id      uuid  → product_items, 제품이 지워지면 null
--   vendor_id    uuid  → vendors, 거래처가 지워지면 null
--   (시즌은 기존 product_id 칸을 쓴다)
--
-- delete_project_cascade(077): 시즌 삭제 때 reminders 는 product_id 로 이미 지운다.
--   item_id 는 그 뒤 product_items 삭제 때 on delete set null 이라 막히지 않는다 → 077 수정 불필요.
-- 되돌리기: alter table public.reminders drop column if exists source_kind, drop column if exists source_id,
--           drop column if exists item_id, drop column if exists vendor_id;

alter table public.reminders
  add column if not exists source_kind text,
  add column if not exists source_id   text,
  add column if not exists item_id     uuid references public.product_items(id) on delete set null,
  add column if not exists vendor_id   uuid references public.vendors(id) on delete set null;

alter table public.reminders drop constraint if exists reminders_source_kind_check;
alter table public.reminders add constraint reminders_source_kind_check
  check (source_kind is null or source_kind in ('note', 'item', 'season', 'vendor', 'calendar', 'manual'));

create index if not exists reminders_source_idx on public.reminders (source_kind, source_id);
create index if not exists reminders_item_id_idx on public.reminders (item_id) where item_id is not null;
create index if not exists reminders_vendor_id_idx on public.reminders (vendor_id) where vendor_id is not null;

notify pgrst, 'reload schema';
