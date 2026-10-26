-- 095 되돌리기 — 트리거·함수만 걷는다. 이미 채워진 CS 칸은 그대로 둔다(맞는 주문에서 온 값).
drop trigger if exists trg_channel_order_items_cs_fill on public.channel_order_items;
drop trigger if exists trg_channel_orders_cs_fill on public.channel_orders;
drop function if exists public.cs_fill_on_order_item();
drop function if exists public.cs_fill_on_order();
drop function if exists public.cs_fill_from_order(uuid);
