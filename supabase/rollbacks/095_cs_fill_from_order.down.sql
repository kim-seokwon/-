-- 095 되돌리기 — 트리거·함수·인덱스·auto_fill 칸을 걷는다. 이미 채워진 CS 칸 값은 그대로 둔다(맞는 주문에서 온 값).
--  auto_fill(무엇을 자동으로 채웠나 기록)은 사라진다 — 필요하면 먼저: select id, auto_fill from cs_tickets where auto_fill is not null;
drop trigger if exists trg_channel_order_items_cs_fill on public.channel_order_items;
drop trigger if exists trg_channel_orders_cs_fill on public.channel_orders;
drop function if exists public.cs_fill_on_order_item();
drop function if exists public.cs_fill_on_order();
drop function if exists public.cs_fill_from_order(uuid);
drop index if exists public.channel_orders_order_id_idx;
alter table public.cs_tickets drop column if exists auto_fill;
