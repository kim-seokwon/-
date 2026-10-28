-- 운영 DB 10-28 읽기 전용 스냅숏: public 표(열만) · RLS 켜짐 여부 · 정책 156개 원문 · public 함수 정의 원문(트리거 제외).
-- 099 파트너 계정 막기 테스트가 이 위에 099 를 깔아 본다. 데이터·비밀값 없음. 다시 뜨려면 .work 기록 참고.
set check_function_bodies = off;
create table public."_bak_20261010_channel_orders" ("id" uuid default gen_random_uuid(), "mall_key" text, "order_id" text, "status" text, "channel_status" text);
alter table public."_bak_20261010_channel_orders" enable row level security;
create table public."_bak_20261010_cs_tickets" ("id" uuid default gen_random_uuid(), "occurred_on" date, "channel_order_id" uuid, "order_no" text, "created_at" timestamp with time zone default now());
alter table public."_bak_20261010_cs_tickets" enable row level security;
create table public."ad_status" ("brand" text, "active_ads" integer, "total_ads" integer, "ad_account" text, "detail" jsonb, "updated_at" timestamp with time zone default now());
alter table public."ad_status" enable row level security;
grant select, insert, update, delete on public."ad_status" to authenticated;
create table public."apify_runs" ("id" bigint, "actor" text, "run_id" text, "dataset_id" text, "purpose" text, "status" text, "harvested" boolean, "payload" jsonb, "created_at" timestamp with time zone default now(), "done_at" timestamp with time zone);
alter table public."apify_runs" enable row level security;
grant select, insert, update, delete on public."apify_runs" to authenticated;
create table public."board_cards" ("id" uuid default gen_random_uuid(), "title" text, "body" text, "status" text, "brand_id" uuid, "assignee" text, "due_date" date, "sort_order" integer, "created_at" timestamp with time zone default now(), "updated_at" timestamp with time zone default now(), "created_by" text);
alter table public."board_cards" enable row level security;
grant select, insert, update, delete on public."board_cards" to authenticated;
create table public."brand_settings" ("brand_id" uuid, "courier" text, "updated_at" timestamp with time zone default now());
alter table public."brand_settings" enable row level security;
grant select, insert, update, delete on public."brand_settings" to authenticated;
create table public."brands" ("id" uuid default gen_random_uuid(), "name" text, "brand_color" text, "created_at" timestamp with time zone default now(), "status" text);
alter table public."brands" enable row level security;
grant select, insert, update, delete on public."brands" to authenticated;
create table public."cafe24_member_counts" ("mall_key" text, "snap_date" date, "total" integer, "collected_at" timestamp with time zone);
alter table public."cafe24_member_counts" enable row level security;
grant select, insert, update, delete on public."cafe24_member_counts" to authenticated;
create table public."calendar_routine_occurrences" ("id" uuid default gen_random_uuid(), "routine_id" uuid, "occurrence_date" date, "status" text, "override_data" jsonb, "completed_at" timestamp with time zone, "processed_on" date, "actual_amount" numeric, "updated_by" uuid, "updated_at" timestamp with time zone default now());
alter table public."calendar_routine_occurrences" enable row level security;
grant select, insert, update, delete on public."calendar_routine_occurrences" to authenticated;
create table public."calendar_routines" ("id" uuid default gen_random_uuid(), "title" text, "kind" text, "recurrence_type" text, "weekdays" int2[], "month_day" smallint, "use_month_end" boolean, "year_month" smallint, "year_day" smallint, "starts_on" date, "ends_on" date, "time_of_day" time without time zone, "memo" text, "assignee_ids" uuid[], "visibility" text, "active" boolean, "creator_user_id" uuid, "created_by" text, "vendor_id" uuid, "settlement_direction" text, "amount" numeric, "service_name" text, "billing_cycle" text, "payment_day" smallint, "payment_method_name" text, "payment_last4" text, "cancel_on" date, "created_at" timestamp with time zone default now(), "updated_at" timestamp with time zone default now());
alter table public."calendar_routines" enable row level security;
grant select, insert, update, delete on public."calendar_routines" to authenticated;
create table public."channel_credentials" ("id" uuid default gen_random_uuid(), "brand_id" uuid, "mall_key" text, "channel" text, "credentials" jsonb, "status" text, "last_error" text, "last_tested_at" timestamp with time zone, "created_at" timestamp with time zone default now(), "updated_at" timestamp with time zone default now());
alter table public."channel_credentials" enable row level security;
create table public."channel_listings" ("id" uuid default gen_random_uuid(), "inventory_item_id" uuid, "channel" text, "channel_product_no" text, "channel_variant_code" text, "channel_sku" text, "created_at" timestamp with time zone default now(), "mall_key" text, "allocated" integer, "sold" integer);
alter table public."channel_listings" enable row level security;
grant select, insert, update, delete on public."channel_listings" to authenticated;
create table public."channel_order_items" ("id" uuid default gen_random_uuid(), "channel_order_id" uuid, "variant_code" text, "product_name" text, "option_name" text, "quantity" integer, "inventory_item_id" uuid);
alter table public."channel_order_items" enable row level security;
grant select, insert, update, delete on public."channel_order_items" to authenticated;
create table public."channel_orders" ("id" uuid default gen_random_uuid(), "channel" text, "order_id" text, "order_date" timestamp with time zone, "buyer_name" text, "receiver_name" text, "receiver_phone" text, "receiver_zipcode" text, "receiver_address" text, "pay_amount" numeric, "channel_status" text, "status" text, "courier" text, "invoice_no" text, "memo" text, "raw" jsonb, "collected_at" timestamp with time zone, "shipped_at" timestamp with time zone, "mall_key" text, "order_amount" numeric, "actual_paid_amount" numeric, "refund_amount" numeric, "refunded_at" timestamp with time zone, "op_status" text, "fin_order_amount" numeric, "fin_unpaid" boolean, "fin_is_return" boolean, "fin_return_done" boolean);
alter table public."channel_orders" enable row level security;
grant select, insert, update, delete on public."channel_orders" to authenticated;
create table public."channel_sync_state" ("mall_key" text, "channel" text, "cafe24_mall_id" text, "client_id" text, "client_secret" text, "access_token" text, "refresh_token" text, "expires_at" timestamp with time zone, "last_order_synced_at" timestamp with time zone, "dry_run" boolean, "updated_at" timestamp with time zone default now());
alter table public."channel_sync_state" enable row level security;
grant select, insert, update, delete on public."channel_sync_state" to authenticated;
create table public."clients" ("id" uuid default gen_random_uuid(), "name" text, "biz_no" text, "ceo" text, "contact" text, "tel" text, "email" text, "memo" text, "created_at" timestamp with time zone default now());
alter table public."clients" enable row level security;
grant select, insert, update, delete on public."clients" to authenticated;
create table public."companies" ("id" uuid default gen_random_uuid(), "name" text, "brand_color" text, "created_at" timestamp with time zone default now(), "role" text, "username" text, "password" text, "brand_id" uuid, "auth_user_id" uuid, "menu_access" text[], "brand_access" uuid[]);
alter table public."companies" enable row level security;
grant select, insert, update, delete on public."companies" to authenticated;
create table public."competitor_snapshots" ("id" uuid default gen_random_uuid(), "competitor_id" uuid, "snap_date" date, "followers" integer, "media_count" integer, "posts_delta" integer, "avg_likes" numeric, "avg_comments" numeric, "created_at" timestamp with time zone default now());
alter table public."competitor_snapshots" enable row level security;
grant select, insert, update, delete on public."competitor_snapshots" to authenticated;
create table public."competitors" ("id" uuid default gen_random_uuid(), "name" text, "handle" text, "ig_business_id" text, "memo" text, "active" boolean, "created_at" timestamp with time zone default now());
alter table public."competitors" enable row level security;
grant select, insert, update, delete on public."competitors" to authenticated;
create table public."cs_tickets" ("id" uuid default gen_random_uuid(), "occurred_on" date, "customer_name" text, "kind" text, "status" text, "purchase_from" text, "contact_channel" text, "brand_id" uuid, "order_no" text, "channel_order_id" uuid, "product_name" text, "exchange_product" text, "invoice_no" text, "memo" text, "created_by" text, "created_at" timestamp with time zone default now(), "resolved_at" timestamp with time zone, "date_suspect" boolean, "auto_fill" jsonb, "items" jsonb, "items_total" integer, "created_by_uid" uuid);
alter table public."cs_tickets" enable row level security;
grant select, insert, update, delete on public."cs_tickets" to authenticated;
create table public."cs_tickets_trash" ("id" uuid default gen_random_uuid(), "row_data" jsonb, "deleted_by" text, "deleted_by_uid" uuid, "deleted_at" timestamp with time zone);
alter table public."cs_tickets_trash" enable row level security;
grant select, insert, update, delete on public."cs_tickets_trash" to authenticated;
create table public."deploy_backup_20261016_calendar_occurrences" ("id" uuid default gen_random_uuid(), "routine_id" uuid, "occurrence_date" date, "status" text, "override_data" jsonb, "completed_at" timestamp with time zone, "processed_on" date, "actual_amount" numeric, "updated_by" uuid, "updated_at" timestamp with time zone default now());
alter table public."deploy_backup_20261016_calendar_occurrences" enable row level security;
create table public."deploy_backup_20261016_calendar_routines" ("id" uuid default gen_random_uuid(), "title" text, "kind" text, "recurrence_type" text, "weekdays" int2[], "month_day" smallint, "use_month_end" boolean, "year_month" smallint, "year_day" smallint, "starts_on" date, "ends_on" date, "time_of_day" time without time zone, "memo" text, "assignee_ids" uuid[], "visibility" text, "active" boolean, "creator_user_id" uuid, "created_by" text, "vendor_id" uuid, "settlement_direction" text, "amount" numeric, "service_name" text, "billing_cycle" text, "payment_day" smallint, "payment_method_name" text, "payment_last4" text, "cancel_on" date, "created_at" timestamp with time zone default now(), "updated_at" timestamp with time zone default now());
alter table public."deploy_backup_20261016_calendar_routines" enable row level security;
create table public."deploy_backup_20261016_products_082" ("id" uuid default gen_random_uuid(), "company_id" uuid, "name" text, "deadline" text, "created_at" timestamp with time zone default now(), "brand_id" uuid, "access" text, "members" text[]);
alter table public."deploy_backup_20261016_products_082" enable row level security;
create table public."deploy_backup_20261016_season_home_notes_082" ("id" uuid default gen_random_uuid(), "title" text, "body" text, "folder" text, "product_id" uuid, "brand_id" uuid, "pinned" boolean, "created_by" text, "created_at" timestamp with time zone default now(), "updated_at" timestamp with time zone default now(), "owner" text, "scope" text, "item_id" uuid);
alter table public."deploy_backup_20261016_season_home_notes_082" enable row level security;
create table public."deploy_backup_20261016_vendor_categories" ("id" uuid default gen_random_uuid(), "name" text, "color" text, "sort_order" integer, "created_at" timestamp with time zone default now(), "updated_at" timestamp with time zone default now());
alter table public."deploy_backup_20261016_vendor_categories" enable row level security;
create table public."deploy_backup_20261016_vendors" ("id" uuid default gen_random_uuid(), "name" text, "category" text, "biz_no" text, "ceo_name" text, "phone" text, "address" text, "lat" double precision, "lng" double precision, "email" text, "memo" text, "created_at" timestamp with time zone default now(), "updated_at" timestamp with time zone default now());
alter table public."deploy_backup_20261016_vendors" enable row level security;
create table public."documents" ("id" uuid default gen_random_uuid(), "product_id" uuid, "name" text, "url" text, "type" text, "status" text, "created_by" uuid, "created_at" timestamp with time zone default now());
alter table public."documents" enable row level security;
grant select, insert, update, delete on public."documents" to authenticated;
create table public."expenses" ("id" uuid default gen_random_uuid(), "spent_on" date, "vendor" text, "amount" numeric, "company" text, "memo" text, "done" boolean, "created_by" text, "created_at" timestamp with time zone default now());
alter table public."expenses" enable row level security;
grant select, insert, update, delete on public."expenses" to authenticated;
create table public."feedback" ("id" uuid default gen_random_uuid(), "created_at" timestamp with time zone default now(), "author_email" text, "author_name" text, "category" text, "page" text, "message" text, "status" text, "resolved_at" timestamp with time zone, "resolved_by" text);
alter table public."feedback" enable row level security;
grant select, insert, update, delete on public."feedback" to authenticated;
create table public."feedback_reports" ("id" uuid default gen_random_uuid(), "username" text, "screen" text, "screen_meta" jsonb, "body" text, "image_path" text, "status" text, "admin_note" text, "created_at" timestamp with time zone default now(), "updated_at" timestamp with time zone default now());
alter table public."feedback_reports" enable row level security;
grant select, insert, update, delete on public."feedback_reports" to authenticated;
create table public."global_documents" ("id" uuid default gen_random_uuid(), "date" text, "name" text, "category" text, "product_id" uuid, "brand_id" uuid, "memo" text, "created_by" uuid, "created_at" timestamp with time zone default now());
alter table public."global_documents" enable row level security;
grant select, insert, update, delete on public."global_documents" to authenticated;
create table public."history" ("id" uuid default gen_random_uuid(), "product_id" uuid, "stage_id" text, "date" text, "note" text, "created_at" timestamp with time zone default now());
alter table public."history" enable row level security;
grant select, insert, update, delete on public."history" to authenticated;
create table public."ig_accounts" ("id" uuid default gen_random_uuid(), "brand_id" uuid, "username" text, "ig_business_id" text, "active" boolean, "created_at" timestamp with time zone default now(), "updated_at" timestamp with time zone default now(), "page_id" text, "ig_id" text);
alter table public."ig_accounts" enable row level security;
grant select, insert, update, delete on public."ig_accounts" to authenticated;
create table public."ig_snapshots" ("id" uuid default gen_random_uuid(), "account_id" uuid, "snap_date" date, "followers" integer, "posts_delta" integer, "stories_delta" integer, "media_count" integer, "source" text, "note" text, "created_at" timestamp with time zone default now(), "comments_total" integer, "likes_total" integer);
alter table public."ig_snapshots" enable row level security;
grant select, insert, update, delete on public."ig_snapshots" to authenticated;
create table public."ig_token" ("id" integer, "token" text, "updated_at" timestamp with time zone default now());
alter table public."ig_token" enable row level security;
create table public."inventory_items" ("id" uuid default gen_random_uuid(), "sku" text, "name" text, "option_name" text, "brand_id" uuid, "product_id" uuid, "on_hand" integer, "safety_stock" integer, "active" boolean, "created_at" timestamp with time zone default now(), "updated_at" timestamp with time zone default now(), "mall_key" text);
alter table public."inventory_items" enable row level security;
grant select, insert, update, delete on public."inventory_items" to authenticated;
create table public."inventory_ledger" ("id" uuid default gen_random_uuid(), "inventory_item_id" uuid, "delta" integer, "reason" text, "ref" text, "note" text, "created_at" timestamp with time zone default now(), "created_by" text);
alter table public."inventory_ledger" enable row level security;
grant select, insert, update, delete on public."inventory_ledger" to authenticated;
create table public."malls" ("mall_key" text, "label" text, "channel" text, "cafe24_mall_id" text, "brand_id" uuid, "active" boolean, "connected" boolean, "created_at" timestamp with time zone default now());
alter table public."malls" enable row level security;
grant select, insert, update, delete on public."malls" to authenticated;
create table public."material_items" ("id" uuid default gen_random_uuid(), "material_code" text, "category" text, "name" text, "color" text, "spec" text, "unit" text, "on_hand" numeric, "safety_stock" numeric, "unit_cost" numeric, "vendor_id" uuid, "brand_id" uuid, "location" text, "memo" text, "active" boolean, "created_at" timestamp with time zone default now(), "updated_at" timestamp with time zone default now());
alter table public."material_items" enable row level security;
grant select, insert, update, delete on public."material_items" to authenticated;
create table public."material_ledger" ("id" uuid default gen_random_uuid(), "material_item_id" uuid, "delta" numeric, "reason" text, "ref" text, "note" text, "movement_date" date, "created_at" timestamp with time zone default now(), "created_by" text);
alter table public."material_ledger" enable row level security;
grant select, insert, update, delete on public."material_ledger" to authenticated;
create table public."memos" ("id" uuid default gen_random_uuid(), "product_id" uuid, "text" text, "created_at" timestamp with time zone default now(), "created_by" uuid);
alter table public."memos" enable row level security;
grant select, insert, update, delete on public."memos" to authenticated;
create table public."news_items" ("id" uuid default gen_random_uuid(), "kind" text, "source" text, "brand_id" uuid, "competitor_id" uuid, "title" text, "snippet" text, "url" text, "author" text, "thumb" text, "score" numeric, "published_at" timestamp with time zone, "meta" jsonb, "created_at" timestamp with time zone default now());
alter table public."news_items" enable row level security;
grant select, insert, update, delete on public."news_items" to authenticated;
create table public."news_sources" ("id" uuid default gen_random_uuid(), "kind" text, "query" text, "cafes" text[], "bucket" text, "brand_id" uuid, "active" boolean, "sort" integer, "created_at" timestamp with time zone default now(), "block" text[], "tag_id" text);
alter table public."news_sources" enable row level security;
grant select, insert, update, delete on public."news_sources" to authenticated;
create table public."note_folders" ("name" text, "access" text, "members" text[], "updated_at" timestamp with time zone default now());
alter table public."note_folders" enable row level security;
grant select, insert, update, delete on public."note_folders" to authenticated;
create table public."notes" ("id" uuid default gen_random_uuid(), "title" text, "body" text, "folder" text, "product_id" uuid, "brand_id" uuid, "pinned" boolean, "created_by" text, "created_at" timestamp with time zone default now(), "updated_at" timestamp with time zone default now(), "owner" text, "scope" text, "item_id" uuid);
alter table public."notes" enable row level security;
grant select, insert, update, delete on public."notes" to authenticated;
create table public."notice_reads" ("notice_id" uuid, "username" text, "read_at" timestamp with time zone);
alter table public."notice_reads" enable row level security;
grant select, insert, update, delete on public."notice_reads" to authenticated;
create table public."notices" ("id" uuid default gen_random_uuid(), "title" text, "body" text, "pinned" boolean, "published" boolean, "created_by" text, "created_at" timestamp with time zone default now(), "updated_at" timestamp with time zone default now());
alter table public."notices" enable row level security;
grant select, insert, update, delete on public."notices" to authenticated;
create table public."operation_audit" ("id" uuid default gen_random_uuid(), "actor_id" uuid, "actor_email" text, "action" text, "entity_type" text, "entity_id" text, "result" text, "detail" jsonb, "created_at" timestamp with time zone default now());
alter table public."operation_audit" enable row level security;
grant select, insert, update, delete on public."operation_audit" to authenticated;
create table public."pages" ("id" uuid default gen_random_uuid(), "title" text, "icon" text, "parent_id" uuid, "brand_id" uuid, "content" text, "sort_order" integer, "created_at" timestamp with time zone default now(), "updated_at" timestamp with time zone default now(), "created_by" text);
alter table public."pages" enable row level security;
grant select, insert, update, delete on public."pages" to authenticated;
create table public."photos" ("id" uuid default gen_random_uuid(), "product_id" uuid, "url" text, "created_by" uuid, "created_at" timestamp with time zone default now());
alter table public."photos" enable row level security;
grant select, insert, update, delete on public."photos" to authenticated;
create table public."product_items" ("id" uuid default gen_random_uuid(), "brand_id" uuid, "name" text, "pattern_no" text, "status" text, "memo" text, "trims" boolean, "checked" boolean, "vendor_id" uuid, "product_id" uuid, "ship_date" date, "open_date" date, "tech_pack_id" uuid, "quote_id" uuid, "sort" integer, "created_by" text, "created_at" timestamp with time zone default now(), "updated_at" timestamp with time zone default now(), "sale_names" text[]);
alter table public."product_items" enable row level security;
grant select, insert, update, delete on public."product_items" to authenticated;
create table public."product_stages" ("id" uuid default gen_random_uuid(), "product_id" uuid, "stage_id" text, "status" text, "due_date" text, "note" text, "updated_at" timestamp with time zone default now());
alter table public."product_stages" enable row level security;
grant select, insert, update, delete on public."product_stages" to authenticated;
create table public."products" ("id" uuid default gen_random_uuid(), "company_id" uuid, "name" text, "deadline" text, "created_at" timestamp with time zone default now(), "brand_id" uuid, "access" text, "members" text[], "start_date" date);
alter table public."products" enable row level security;
grant select, insert, update, delete on public."products" to authenticated;
create table public."quotes" ("id" uuid default gen_random_uuid(), "quote_no" text, "client_name" text, "client_biz_no" text, "client_ceo" text, "client_contact" text, "client_tel" text, "client_email" text, "items" jsonb, "supply_amount" bigint, "tax_amount" bigint, "total_amount" bigint, "quote_date" date, "valid_until" date, "status" text, "memo" text, "created_at" timestamp with time zone default now(), "updated_at" timestamp with time zone default now(), "terms" text, "tax_status" text, "tax_mgtkey" text, "tax_supply_date" date, "tax_issued_at" timestamp with time zone, "tax_last_error" text, "item_id" uuid);
alter table public."quotes" enable row level security;
grant select, insert, update, delete on public."quotes" to authenticated;
create table public."reminders" ("id" uuid default gen_random_uuid(), "title" text, "memo" text, "list_name" text, "due_date" date, "done" boolean, "done_at" timestamp with time zone, "product_id" uuid, "assignee" text, "created_by" text, "created_at" timestamp with time zone default now(), "owner" text, "scope" text, "source_kind" text, "source_id" text, "item_id" uuid, "vendor_id" uuid);
alter table public."reminders" enable row level security;
grant select, insert, update, delete on public."reminders" to authenticated;
create table public."season_steps" ("id" uuid default gen_random_uuid(), "brand_id" uuid, "name" text, "offset_days" integer, "checklist" text[], "icon" text, "color" text, "sort" integer, "on_default" boolean, "active" boolean, "created_at" timestamp with time zone default now(), "kind" text);
alter table public."season_steps" enable row level security;
grant select, insert, update, delete on public."season_steps" to authenticated;
create table public."shipment_jobs" ("id" uuid default gen_random_uuid(), "mall_key" text, "order_id" text, "courier" text, "invoice_no" text, "provider_request_id" text, "status" text, "attempts" integer, "last_error" text, "issued_at" timestamp with time zone, "registered_at" timestamp with time zone, "created_by" uuid, "created_at" timestamp with time zone default now(), "updated_at" timestamp with time zone default now());
alter table public."shipment_jobs" enable row level security;
grant select, insert, update, delete on public."shipment_jobs" to authenticated;
create table public."sync_log" ("id" uuid default gen_random_uuid(), "run_at" timestamp with time zone, "channel" text, "type" text, "result" text, "detail" jsonb);
alter table public."sync_log" enable row level security;
grant select, insert, update, delete on public."sync_log" to authenticated;
create table public."tech_packs" ("id" uuid default gen_random_uuid(), "style_name" text, "style_no" text, "config" jsonb, "created_at" timestamp with time zone default now(), "item_id" uuid, "source" text, "file_path" text, "file_name" text, "file_type" text, "file_size" bigint, "brand_id" uuid);
alter table public."tech_packs" enable row level security;
grant select, insert, update, delete on public."tech_packs" to authenticated;
create table public."todos" ("id" uuid default gen_random_uuid(), "product_id" uuid, "text" text, "completed" boolean, "assignee_id" uuid, "due_date" text, "created_at" timestamp with time zone default now(), "created_by" text);
alter table public."todos" enable row level security;
grant select, insert, update, delete on public."todos" to authenticated;
create table public."ui_events" ("id" bigint, "user_id" uuid, "screen" text, "action" text, "at" timestamp with time zone);
alter table public."ui_events" enable row level security;
grant select, insert, update, delete on public."ui_events" to authenticated;
create table public."ui_events_config" ("id" boolean, "ends_at" timestamp with time zone, "finalized_at" timestamp with time zone);
alter table public."ui_events_config" enable row level security;
create table public."ui_usage_summary" ("id" bigint, "made_at" timestamp with time zone, "metric" text, "day" date, "screen" text, "action" text, "n" bigint, "value" numeric);
alter table public."ui_usage_summary" enable row level security;
grant select, insert, update, delete on public."ui_usage_summary" to authenticated;
create table public."vendor_categories" ("id" uuid default gen_random_uuid(), "name" text, "color" text, "sort_order" integer, "created_at" timestamp with time zone default now(), "updated_at" timestamp with time zone default now());
alter table public."vendor_categories" enable row level security;
grant select, insert, update, delete on public."vendor_categories" to authenticated;
create table public."vendor_jobs" ("id" uuid default gen_random_uuid(), "vendor_id" uuid, "title" text, "stage" text, "qty" integer, "due_date" date, "status" text, "memo" text, "created_at" timestamp with time zone default now(), "qc_status" text, "qc_checklist" jsonb, "qc_photos" jsonb, "quick_status" jsonb, "tech_pack_id" uuid, "item_id" uuid);
alter table public."vendor_jobs" enable row level security;
grant select, insert, update, delete on public."vendor_jobs" to authenticated;
create table public."vendors" ("id" uuid default gen_random_uuid(), "name" text, "category" text, "biz_no" text, "ceo_name" text, "phone" text, "address" text, "lat" double precision, "lng" double precision, "email" text, "memo" text, "created_at" timestamp with time zone default now(), "updated_at" timestamp with time zone default now(), "status" text, "contact_name" text, "fax" text);
alter table public."vendors" enable row level security;
grant select, insert, update, delete on public."vendors" to authenticated;
CREATE OR REPLACE FUNCTION public.apply_channel_inventory_adjustment(p_inventory_item_id uuid, p_listing_id uuid, p_delta integer, p_reason text, p_ref text, p_note text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  inserted_id UUID;
BEGIN
  IF p_delta = 0 OR p_ref IS NULL OR p_reason NOT IN ('cafe24_order','channel_reconcile') THEN
    RETURN FALSE;
  END IF;

  INSERT INTO inventory_ledger(inventory_item_id, delta, reason, ref, note, created_by)
  VALUES (p_inventory_item_id, p_delta, p_reason, p_ref, p_note, 'channel-sync')
  ON CONFLICT DO NOTHING
  RETURNING id INTO inserted_id;

  IF inserted_id IS NULL THEN RETURN FALSE; END IF;

  IF p_listing_id IS NOT NULL THEN
    UPDATE channel_listings
       SET allocated = GREATEST(COALESCE(allocated, 0) + p_delta, 0),
           sold = GREATEST(COALESCE(sold, 0) - p_delta, 0)
     WHERE id = p_listing_id;
  END IF;
  RETURN TRUE;
END;
$function$;
CREATE OR REPLACE FUNCTION public.brand_customers(p_brand text, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_kind text DEFAULT 'all'::text, p_days integer DEFAULT 90, p_limit integer DEFAULT 300)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ids uuid[];
begin
  -- 브랜드 검사: 이름이 p_brand 인 브랜드 중 로그인 사용자가 볼 수 있는 것(can_access_brand — RLS 와 같은 규칙)의 id 만 확정한다.
  -- 엣지함수(service_role)는 RLS 를 우회하는 것과 같게 전부 허용. 하나도 없으면 42501.
  -- 본문은 이 id 로만 조인한다 — 이름이 같은 권한 밖 브랜드가 생겨도 섞이지 않게(brands.name 에 유일 제약 없음).
  select array_agg(b.id) into v_ids
    from brands b
   where b.name = p_brand
     and (coalesce(auth.jwt()->>'role', '') = 'service_role' or public.can_access_brand(b.id));
  if v_ids is null then
    raise exception 'forbidden: brand' using errcode = '42501';
  end if;
  return (
with c as (
  select coalesce(nullif(o.receiver_phone,''), o.receiver_name, o.buyer_name) cust,
         max(o.receiver_name) nm,
         max(o.receiver_phone) phone,
         count(*) n,
         sum(coalesce(o.pay_amount,0)) spend,
         min(o.order_date) first_at,
         max(o.order_date) last_at,
         (array_agg(distinct m.label))[1:3] malls
    from channel_orders o
    join malls m on m.mall_key = o.mall_key
    join brands b on b.id = m.brand_id
   where b.id = any(v_ids)
     and coalesce(nullif(o.receiver_phone,''), o.receiver_name, o.buyer_name) is not null
     and coalesce(o.channel_status,'') !~ '^[CR]'
     and (p_from is null or o.order_date >= p_from)
     and (p_to   is null or o.order_date <  p_to)
   group by 1
),
-- 떠난 이유의 단서: 그 고객의 CS(교환·반품) 와 마지막으로 산 상품
x as (
  select c.*,
         (now()::date - c.last_at::date) gone_days,
         -- CS 는 허용 브랜드 것만: brand_id 가 v_ids 안, 또는 brand_id 가 비었으면 주문번호로 이어진 주문이 허용 브랜드 몰일 때만.
         -- (brand_id·주문 둘 다 없는 CS 는 브랜드를 알 수 없어 세지 않는다)
         (select count(*) from cs_tickets t
           where (t.brand_id = any(v_ids)
                  or (t.brand_id is null and exists (
                        select 1 from channel_orders o4 join malls m4 on m4.mall_key = o4.mall_key
                         where m4.brand_id = any(v_ids)
                           and o4.order_id = regexp_replace(coalesce(t.order_no,''),'\s','','g'))))
             and (t.customer_name = c.nm or regexp_replace(coalesce(t.order_no,''),'\s','','g') in
                 (select o2.order_id from channel_orders o2
                    join malls m2 on m2.mall_key = o2.mall_key
                   where m2.brand_id = any(v_ids)
                     and coalesce(nullif(o2.receiver_phone,''), o2.receiver_name, o2.buyer_name) = c.cust))) cs_n,
         (select string_agg(distinct left(i.product_name, 24), ', ')
            from channel_orders o3
            join malls m3 on m3.mall_key = o3.mall_key
            join channel_order_items i on i.channel_order_id = o3.id
           where m3.brand_id = any(v_ids)
             and coalesce(nullif(o3.receiver_phone,''), o3.receiver_name, o3.buyer_name) = c.cust
             and o3.order_date = c.last_at) last_items
    from c
)
select coalesce(json_agg(s.r order by s.sort_key desc), '[]'::json) from (
  select json_build_object(
           'name', nm, 'phone', phone, 'orders', n, 'spend', spend,
           'first', first_at::date, 'last', last_at::date, 'gone_days', gone_days,
           'cs', cs_n, 'last_items', last_items, 'malls', malls
         ) r,
         case when p_kind = 'gone' then gone_days::numeric else spend end sort_key
    from x
   where case
           when p_kind = 'once'   then n = 1
           when p_kind = 'repeat' then n >= 2
           when p_kind = 'loyal'  then n >= 10
           when p_kind = 'vip'    then true
           when p_kind = 'gone'   then gone_days >= p_days
           -- 'n3' 처럼 정확히 몇 회 산 사람 (분포 막대를 눌렀을 때)
           when p_kind ~ '^n[0-9]+$' then n = substring(p_kind from 2)::int
           else true
         end
   order by sort_key desc
   limit greatest(1, least(p_limit, 1000))
) s
  );
end
$function$;
CREATE OR REPLACE FUNCTION public.brand_gone_counts(p_brand text, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ids uuid[];
begin
  -- 브랜드 검사: 이름이 p_brand 인 브랜드 중 로그인 사용자가 볼 수 있는 것(can_access_brand — RLS 와 같은 규칙)의 id 만 확정한다.
  -- 엣지함수(service_role)는 RLS 를 우회하는 것과 같게 전부 허용. 하나도 없으면 42501.
  -- 본문은 이 id 로만 조인한다 — 이름이 같은 권한 밖 브랜드가 생겨도 섞이지 않게(brands.name 에 유일 제약 없음).
  select array_agg(b.id) into v_ids
    from brands b
   where b.name = p_brand
     and (coalesce(auth.jwt()->>'role', '') = 'service_role' or public.can_access_brand(b.id));
  if v_ids is null then
    raise exception 'forbidden: brand' using errcode = '42501';
  end if;
  return (
with c as (
  select coalesce(nullif(o.receiver_phone,''), o.receiver_name, o.buyer_name) cust,
         count(*) n,
         sum(coalesce(o.pay_amount,0)) spend,
         max(o.order_date) last_at
    from channel_orders o
    join malls m on m.mall_key = o.mall_key
    join brands b on b.id = m.brand_id
   where b.id = any(v_ids)
     and coalesce(nullif(o.receiver_phone,''), o.receiver_name, o.buyer_name) is not null
     and coalesce(o.channel_status,'') !~ '^[CR]'
     and (p_from is null or o.order_date >= p_from)
     and (p_to   is null or o.order_date <  p_to)
   group by 1
), d as (select *, (now()::date - last_at::date) gone from c)
select json_build_object(
  'customers', (select count(*) from d),
  'd90',   (select count(*) from d where gone >= 90),
  'd180',  (select count(*) from d where gone >= 180),
  'd365',  (select count(*) from d where gone >= 365),
  -- 떠난 분들이 쥐고 있던 돈 — 되돌릴 값어치를 가늠하려고
  'lost90_spend', (select coalesce(sum(spend),0) from d where gone >= 90),
  'repeat90',     (select count(*) from d where gone >= 90 and n >= 2)
)
  );
end
$function$;
CREATE OR REPLACE FUNCTION public.brand_order_types(p_brand text, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS json
 LANGUAGE sql
 STABLE
AS $function$ with base as ( select o.id oid, coalesce(nullif(o.receiver_phone,''), o.receiver_name, o.buyer_name) cust, bool_or(i.option_name ~* '프리오더|pre-?order' or i.product_name ~* '프리오더|pre-?order') pre, bool_or(i.product_name ~* '특가|기획|세일|sale') evt from channel_orders o join malls m on m.mall_key=o.mall_key join brands b on b.id=m.brand_id left join channel_order_items i on i.channel_order_id=o.id where b.name=p_brand and coalesce(nullif(o.receiver_phone,''), o.receiver_name, o.buyer_name) is not null and coalesce(o.pay_amount,0)>0 and (p_from is null or o.order_date >= p_from) and (p_to is null or o.order_date < p_to) group by o.id, 2 ), ord as ( select oid, cust, case when evt then 'event' when pre then 'preorder' else 'regular' end otype from base ), cu as ( select cust, bool_or(otype='event') be, bool_or(otype='preorder') bp, bool_or(otype='regular') br, count(*) n from ord group by cust ) select json_build_object( 'orders_total',(select count(*) from ord), 'orders_event',(select count(*) filter(where otype='event') from ord), 'orders_preorder',(select count(*) filter(where otype='preorder') from ord), 'orders_regular',(select count(*) filter(where otype='regular') from ord), 'customers',(select count(*) from cu), 'seg_event_only',(select count(*) from cu where be and not bp and not br), 'seg_preorder_only',(select count(*) from cu where bp and not be and not br), 'seg_regular_only',(select count(*) from cu where br and not be and not bp), 'seg_mixed',(select count(*) from cu where (be::int+bp::int+br::int)>=2) ) $function$;
CREATE OR REPLACE FUNCTION public.brand_repurchase(p_brand text, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS json
 LANGUAGE sql
 STABLE
AS $function$ with c as ( select coalesce(nullif(o.receiver_phone,''), o.receiver_name, o.buyer_name) cust, max(o.receiver_name) nm, count(*) n, sum(coalesce(o.pay_amount,0)) spend, max(o.order_date) last from channel_orders o join malls m on m.mall_key=o.mall_key join brands b on b.id=m.brand_id where b.name=p_brand and coalesce(nullif(o.receiver_phone,''), o.receiver_name, o.buyer_name) is not null and (p_from is null or o.order_date >= p_from) and (p_to is null or o.order_date < p_to) group by 1 ) select json_build_object( 'customers', count(*), 'repeat_customers', count(*) filter (where n>=2), 'rate', round(100.0*count(*) filter (where n>=2)/nullif(count(*),0),1), 'avg_orders', round(avg(n),2), 'avg_spend', round(avg(spend)), 'once', count(*) filter (where n=1), 'twice', count(*) filter (where n=2), 'three_plus', count(*) filter (where n>=3), 'loyal', count(*) filter (where n>=10), 'max_orders', coalesce(max(n),0), 'dist', (select json_agg(json_build_object('bucket', bk, 'ord', ord, 'c', cc) order by ord) from (select (case when n>=10 then 10 else n end) ord, (case when n>=10 then '10+' else n::text end) bk, count(*) cc from c group by 1,2) d), 'top', (select json_agg(t) from (select nm, n, spend, last from c order by spend desc limit 12) t) ) from c $function$;
CREATE OR REPLACE FUNCTION public.brand_vip_rank_changes(p_brand text, p_start timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 1000)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
with current_totals as (
  select coalesce(nullif(o.receiver_phone,''), o.receiver_name, o.buyer_name) cust,
         max(o.receiver_name) name,
         max(o.receiver_phone) phone,
         count(*) orders,
         sum(coalesce(o.pay_amount,0)) spend,
         min(o.order_date) first_at,
         max(o.order_date) last_at,
         (array_agg(distinct m.label))[1:3] malls
    from channel_orders o
    join malls m on m.mall_key = o.mall_key
    join brands b on b.id = m.brand_id
   where b.name = p_brand
     and coalesce(public.can_access_brand(b.id), false)
     and coalesce(nullif(o.receiver_phone,''), o.receiver_name, o.buyer_name) is not null
     and coalesce(o.channel_status,'') !~ '^[CR]'
   group by 1
),
current_ranked as (
  select c.*, rank() over (order by spend desc) rank
    from current_totals c
),
current_limited as (
  select * from current_ranked order by rank, cust limit greatest(1, least(p_limit, 1000))
),
start_totals as (
  select coalesce(nullif(o.receiver_phone,''), o.receiver_name, o.buyer_name) cust,
         sum(coalesce(o.pay_amount,0)) spend
    from channel_orders o
    join malls m on m.mall_key = o.mall_key
    join brands b on b.id = m.brand_id
   where p_start is not null
     and b.name = p_brand
     and coalesce(public.can_access_brand(b.id), false)
     and coalesce(nullif(o.receiver_phone,''), o.receiver_name, o.buyer_name) is not null
     and coalesce(o.channel_status,'') !~ '^[CR]'
     and o.order_date < p_start
   group by 1
),
start_ranked as (
  select s.*, rank() over (order by spend desc) start_rank from start_totals s
)
select coalesce(json_agg(json_build_object(
  'name', c.name, 'phone', c.phone, 'orders', c.orders, 'spend', c.spend,
  'first', c.first_at::date, 'last', c.last_at::date,
  'gone_days', now()::date - c.last_at::date, 'malls', c.malls,
  'rank', c.rank, 'start_rank', s.start_rank,
  'rank_move', case
    when p_start is null then 'same'
    when s.start_rank is null then 'new'
    when s.start_rank > c.rank then 'up'
    when s.start_rank < c.rank then 'down'
    else 'same' end,
  'rank_delta', case when s.start_rank is null then null else abs(s.start_rank - c.rank) end,
  'cs', (select count(*) from cs_tickets t
          where t.customer_name = c.name or regexp_replace(coalesce(t.order_no,''),'\s','','g') in
                (select o2.order_id from channel_orders o2
                  where coalesce(nullif(o2.receiver_phone,''), o2.receiver_name, o2.buyer_name) = c.cust)),
  'last_items', (select string_agg(distinct left(i.product_name, 24), ', ')
                   from channel_orders o3
                   join channel_order_items i on i.channel_order_id = o3.id
                  where coalesce(nullif(o3.receiver_phone,''), o3.receiver_name, o3.buyer_name) = c.cust
                    and o3.order_date = c.last_at)
) order by c.rank, c.cust), '[]'::json)
from current_limited c
left join start_ranked s on s.cust = c.cust;
$function$;
CREATE OR REPLACE FUNCTION public.cafe24_state_sig(r jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  select coalesce(r->>'shipping_status', '') || '|' || coalesce(r->>'order_status', '') || '|' ||
    coalesce((
      select string_agg(c, ',' order by c collate "C")
      from (
        select coalesce(nullif(i->>'status', ''), nullif(i->>'order_status', ''), '') as c
        from jsonb_array_elements(case when jsonb_typeof(r->'items') = 'array' then r->'items' else '[]'::jsonb end) i
      ) s
    ), '')
$function$;
CREATE OR REPLACE FUNCTION public.can_access_brand(p_brand_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE p companies%ROWTYPE;
BEGIN
  SELECT * INTO p FROM companies
   WHERE username=split_part(auth.jwt()->>'email','@',1) LIMIT 1;
  IF p.id IS NULL THEN RETURN FALSE; END IF;
  IF p.role='MASTER' THEN RETURN TRUE; END IF;
  IF p.role='STAFF' THEN
    RETURN p.brand_access IS NOT NULL AND p_brand_id=ANY(p.brand_access);
  END IF;
  RETURN p_brand_id IS NOT NULL AND (
    p_brand_id=p.brand_id OR
    (p.brand_access IS NOT NULL AND p_brand_id=ANY(p.brand_access))
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.can_access_project(p_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select case
    when p_id is null then true
    else exists (
      select 1 from products p
       where p.id = p_id
         and (p.brand_id is null or public.can_access_brand(p.brand_id))
         and (p.access = 'all'
              or public.current_username() = any(p.members)
              or public.get_user_role() = 'MASTER')
    )
  end
$function$;
CREATE OR REPLACE FUNCTION public.can_complete_calendar_routine(r calendar_routines)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL AND get_user_role() IN ('MASTER','STAFF') AND (
    get_user_role() = 'MASTER' OR NULLIF(BTRIM(get_user_company_id()), '') = ANY(r.assignee_ids::text[])
  )
$function$;
CREATE OR REPLACE FUNCTION public.can_manage_calendar_routine(r calendar_routines)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL AND get_user_role() IN ('MASTER','STAFF')
    AND (get_user_role() = 'MASTER' OR r.creator_user_id = auth.uid())
$function$;
CREATE OR REPLACE FUNCTION public.can_see_folder(p_folder text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when p_folder is null then true
    when get_user_role() = 'MASTER' then true
    else not exists (
      select 1 from note_folders f
       where f.name = p_folder
         and f.access = 'members'
         and not (public.current_username() = any(f.members))
    )
  end
$function$;
CREATE OR REPLACE FUNCTION public.can_see_note(p_scope text, p_owner text, p_product uuid, p_brand uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select public.can_access_project(p_product)
     and (p_brand is null or public.can_access_brand(p_brand))
     and (
       p_scope <> 'private'
       or p_owner is not distinct from public.current_username()
       or public.get_user_role() = 'MASTER'
       or (p_product is not null and exists (
             select 1 from products p
              where p.id = p_product and public.current_username() = any(p.members)))
     )
$function$;
CREATE OR REPLACE FUNCTION public.can_see_scope(p_scope text, p_owner text, p_brand uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select case
    when p_scope = 'private' then p_owner is not distinct from public.current_username()
    when p_scope = 'project' then p_brand is null or public.can_access_brand(p_brand)
    else true
  end
$function$;
CREATE OR REPLACE FUNCTION public.can_view_calendar_routine(r calendar_routines)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL AND get_user_role() IN ('MASTER','STAFF') AND (
    get_user_role() = 'MASTER'
    OR r.creator_user_id = auth.uid()
    OR r.visibility = 'all'
    OR (r.visibility = 'assignees' AND NULLIF(BTRIM(get_user_company_id()), '') = ANY(r.assignee_ids::text[]))
  )
$function$;
CREATE OR REPLACE FUNCTION public.claim_shipment_job(p_mall_key text, p_order_id text, p_courier text, p_actor uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  rec shipment_jobs%ROWTYPE;
  new_id UUID;
BEGIN
  INSERT INTO shipment_jobs(mall_key, order_id, courier, status, attempts, created_by)
  VALUES (p_mall_key, p_order_id, p_courier, 'pending', 1, p_actor)
  ON CONFLICT (mall_key, order_id) DO NOTHING
  RETURNING id INTO new_id;
  IF new_id IS NOT NULL THEN RETURN TRUE; END IF;

  SELECT * INTO rec FROM shipment_jobs
   WHERE mall_key = p_mall_key AND order_id = p_order_id FOR UPDATE;
  IF rec.invoice_no IS NOT NULL OR rec.status IN ('pending','registering','registered') THEN
    RETURN FALSE;
  END IF;
  UPDATE shipment_jobs SET status='pending', attempts=attempts+1, last_error=NULL,
         updated_at=now(), created_by=COALESCE(created_by,p_actor)
   WHERE id=rec.id;
  RETURN TRUE;
END;
$function$;
CREATE OR REPLACE FUNCTION public.claim_shipment_registration(p_mall_key text, p_order_id text, p_invoice_no text, p_courier text, p_actor uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  rec shipment_jobs%ROWTYPE;
BEGIN
  SELECT * INTO rec FROM shipment_jobs
   WHERE mall_key=p_mall_key AND order_id=p_order_id FOR UPDATE;

  IF rec.id IS NULL THEN
    INSERT INTO shipment_jobs(
      mall_key, order_id, courier, invoice_no, status, attempts, created_by
    ) VALUES (
      p_mall_key, p_order_id, p_courier, p_invoice_no, 'registering', 1, p_actor
    );
    RETURN 'claimed';
  END IF;

  IF rec.invoice_no IS NOT NULL AND rec.invoice_no <> p_invoice_no THEN
    RETURN 'invoice_conflict';
  END IF;
  IF rec.status = 'registered' THEN RETURN 'registered'; END IF;
  IF rec.status = 'registering' THEN RETURN 'busy'; END IF;

  UPDATE shipment_jobs
     SET courier=p_courier, invoice_no=p_invoice_no, status='registering',
         attempts=attempts+1, last_error=NULL, updated_at=now(),
         created_by=COALESCE(created_by,p_actor)
   WHERE id=rec.id;
  RETURN 'claimed';
END;
$function$;
CREATE OR REPLACE FUNCTION public.claim_tax_invoice(p_quote_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE claimed UUID;
BEGIN
  UPDATE quotes SET tax_status='issuing', tax_last_error=NULL, updated_at=now()
   WHERE id=p_quote_id AND COALESCE(tax_status,'none') IN ('none','failed')
   RETURNING id INTO claimed;
  RETURN claimed IS NOT NULL;
END;
$function$;
CREATE OR REPLACE FUNCTION public.claim_vendor_quick(p_job_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE claimed UUID;
BEGIN
  UPDATE vendor_jobs
     SET quick_status=jsonb_build_object('status','requesting','claimed_at',now())
   WHERE id=p_job_id AND qc_status='passed'
     AND (quick_status IS NULL OR quick_status->>'status'='failed')
   RETURNING id INTO claimed;
  RETURN claimed IS NOT NULL;
END;
$function$;
CREATE OR REPLACE FUNCTION public.create_company(p_name text, p_role text, p_username text, p_brand_id uuid DEFAULT NULL::uuid, p_auth_user_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  new_id UUID;
BEGIN
  PERFORM public.require_role('MASTER');
  INSERT INTO companies (name, role, username, brand_id, auth_user_id)
  VALUES (p_name, p_role, p_username, p_brand_id, p_auth_user_id)
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$function$;
CREATE OR REPLACE FUNCTION public.create_material_item(p_material_code text, p_category text, p_name text, p_color text, p_spec text, p_unit text, p_initial_qty numeric, p_safety_stock numeric, p_unit_cost numeric, p_vendor_id uuid, p_brand_id uuid, p_location text, p_memo text, p_created_by text)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
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
$function$;
CREATE OR REPLACE FUNCTION public.create_product(p_company_id uuid, p_brand_id uuid, p_name text, p_deadline text DEFAULT NULL::text, p_start_date date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  insert into products (company_id, brand_id, name, deadline, start_date)
  values (p_company_id, p_brand_id, p_name, p_deadline, p_start_date)
  returning id into new_id;
  return new_id;
end;
$function$;
CREATE OR REPLACE FUNCTION public.cs_fill_from_order(p_order uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  o record; v_brand uuid; v_prod text; v_name text; t record; f jsonb; n int;
  pk jsonb; v_claim jsonb; v_total int; auto_prod boolean; auto_items boolean;
begin
  select id, order_id, mall_key, order_date, receiver_name, buyer_name into o
    from channel_orders where id = p_order;
  if not found or order_no_norm(o.order_id) = '' then return; end if;

  select count(*) into n from channel_orders where order_no_norm(order_id) = order_no_norm(o.order_id);
  if n <> 1 then
    --  몰끼리 같은 주문번호(정규화 기준) → 어느 주문인지 모른다. 앞서 자동으로 채운 칸만 빈칸으로 되돌린다.
    for t in select c.* from cs_tickets c where order_no_norm(c.order_no) = order_no_norm(o.order_id) and c.auto_fill is not null loop
      begin
        f := t.auto_fill;
        update cs_tickets c set
          customer_name    = case when f ? 'customer_name' and c.customer_name is not distinct from f->>'customer_name'
                                  then '(이름없음)' else c.customer_name end,
          channel_order_id = case when f ? 'channel_order_id' and c.channel_order_id::text is not distinct from f->>'channel_order_id'
                                  then null else c.channel_order_id end,
          brand_id         = case when f ? 'brand_id' and c.brand_id::text is not distinct from f->>'brand_id'
                                  then null else c.brand_id end,
          product_name     = case when f ? 'product_name' and c.product_name is not distinct from f->>'product_name'
                                  then null else c.product_name end,
          items            = case when f ? 'items' and c.items is not distinct from f->'items' then null else c.items end,
          items_total      = case when f ? 'items' and c.items is not distinct from f->'items' then null else c.items_total end,
          auto_fill        = null
        where c.id = t.id;
      exception when others then
        raise warning 'cs_fill_from_order: cs % 되돌리기 실패 — %', t.id, sqlerrm;
      end;
    end loop;
    return;
  end if;

  select m.brand_id into v_brand from malls m where m.mall_key = o.mall_key;
  pk := cs_order_pick(o.id);
  v_claim := pk->'claim';
  v_total := nullif((pk->>'total')::int, 0);
  if jsonb_array_length(v_claim) > 0 then
    v_prod := pk->>'summary';                                   -- 신청한 줄만
  else
    v_claim := null;                                            -- 클레임 전 — 직원이 고르기 전까지 앞 3개(095 그대로)
    select string_agg(s.product_name, ', ') into v_prod
      from (select i.product_name from channel_order_items i
             where i.channel_order_id = o.id and coalesce(i.product_name, '') <> '' limit 3) s;
  end if;
  v_name := coalesce(nullif(o.receiver_name, ''), nullif(o.buyer_name, ''));

  for t in
    select c.* from cs_tickets c
     where order_no_norm(c.order_no) = order_no_norm(o.order_id)
       and (c.channel_order_id is null or c.channel_order_id = o.id)
       and (o.order_date is null or c.occurred_on is null
            or c.occurred_on >= (o.order_date at time zone 'Asia/Seoul')::date)
  loop
    begin
      --  상품이 비었거나 자동값 그대로면 '자동' — 직원이 적은 상품·고른 줄은 아니다
      auto_prod  := coalesce(t.product_name, '') = ''
                    or (t.auto_fill ? 'product_name' and t.product_name is not distinct from t.auto_fill->>'product_name');
      auto_items := t.items is null or (t.auto_fill ? 'items' and t.items is not distinct from t.auto_fill->'items');
      --  이번에 채우는 칸만 모은다(빈칸·자동값 + 채울 값 있음 + 지금 값과 다름)
      f := jsonb_strip_nulls(jsonb_build_object(
        'customer_name',    case when coalesce(nullif(t.customer_name, ''), '(이름없음)') = '(이름없음)' then v_name end,
        'channel_order_id', case when t.channel_order_id is null then o.id::text end,
        'brand_id',         case when t.brand_id is null then v_brand::text end,
        'product_name',     case when auto_prod and auto_items and t.product_name is distinct from v_prod
                                  and (v_claim is not null or coalesce(t.product_name, '') = '') then v_prod end,
        'items',            case when auto_prod and auto_items and v_claim is not null
                                  and t.items is distinct from v_claim then v_claim end));
      if f = '{}'::jsonb and (t.items_total is not null or v_total is null) then continue; end if;
      update cs_tickets c set
        customer_name    = coalesce(f->>'customer_name', c.customer_name),
        channel_order_id = coalesce((f->>'channel_order_id')::uuid, c.channel_order_id),
        brand_id         = coalesce((f->>'brand_id')::uuid, c.brand_id),
        product_name     = coalesce(f->>'product_name', c.product_name),
        items            = coalesce(f->'items', c.items),
        items_total      = coalesce(c.items_total, v_total),
        auto_fill        = case when f = '{}'::jsonb then c.auto_fill else coalesce(c.auto_fill, '{}'::jsonb) || f end
      where c.id = t.id;
    exception when others then
      raise warning 'cs_fill_from_order: cs % 못 채움 — %', t.id, sqlerrm;
    end;
  end loop;
end $function$;
CREATE OR REPLACE FUNCTION public.cs_items_summary(p_items jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select string_agg(case when q > 1 then nm || ' ×' || q else nm end, ', ' order by first_n)
    from (select e->>'name' nm, sum(coalesce((e->>'qty')::int, 1)) q, min(n) first_n
            from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality x(e, n)
           where coalesce(e->>'name', '') <> '' group by e->>'name') s
$function$;
CREATE OR REPLACE FUNCTION public.cs_order_lines(p_order uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select jsonb_agg(jsonb_build_object(
              'code', e->>'order_item_code', 'name', e->>'product_name', 'option', e->>'option_value',
              'qty', coalesce(nullif(e->>'quantity', '')::int, 1), 'status', e->>'order_status',
              'claim', nullif(e->>'claim_code', ''), 'reason', nullif(e->>'claim_reason', ''),
              'cq', coalesce(nullif(e->>'claim_quantity', '')::int, 0)) order by n)
       from channel_orders o, jsonb_array_elements(o.raw->'items') with ordinality x(e, n)
      where o.id = p_order and o.channel = 'cafe24' and jsonb_typeof(o.raw->'items') = 'array'),
    (select jsonb_agg(jsonb_build_object('code', null, 'name', i.product_name, 'option', i.option_name,
              'qty', coalesce(i.quantity, 1), 'status', null, 'claim', null, 'reason', null, 'cq', 0) order by i.id)
       from channel_order_items i where i.channel_order_id = p_order),
    '[]'::jsonb)
$function$;
CREATE OR REPLACE FUNCTION public.cs_order_pick(p_order uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare l jsonb; c jsonb; k text;
begin
  l := cs_order_lines(p_order);
  select coalesce(jsonb_agg(e - 'cq' || jsonb_build_object('qty', case when (e->>'cq')::int > 0 then (e->>'cq')::int else (e->>'qty')::int end) order by n), '[]'::jsonb)
    into c
    from jsonb_array_elements(l) with ordinality x(e, n)
   where coalesce(e->>'status', '') ~ '^[REC]' and coalesce(e->>'claim', '') <> '';
  select case when bool_and(e->>'status' like 'R%') then '반품' when bool_and(e->>'status' like 'E%') then '교환' end
    into k from jsonb_array_elements(c) e;
  return jsonb_build_object(
    'lines', (select coalesce(jsonb_agg(e - 'cq' order by n), '[]'::jsonb) from jsonb_array_elements(l) with ordinality x(e, n)),
    'claim', c, 'kind', k, 'total', jsonb_array_length(l),
    'summary', cs_items_summary(c));
end $function$;
CREATE OR REPLACE FUNCTION public.cs_order_shipments(p_ids uuid[])
 RETURNS TABLE(channel_order_id uuid, channel text, tracking_no text, courier text, shipped_date text, product_name text, option_name text, quantity integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select o.id as channel_order_id, o.channel,
         nullif(btrim(coalesce(i->>'tracking_no', i->>'invoiceNo', o.invoice_no, '')), '') as tracking_no,
         nullif(btrim(coalesce(i->>'shipping_company_name', i->>'deliveryCompanyName', o.courier, '')), '') as courier,
         nullif(coalesce(i->>'shipped_date', i->>'deliveryStartedAt', o.shipped_at::text, ''), '') as shipped_date,
         nullif(coalesce(i->>'product_name', i->>'itemName', ''), '') as product_name,
         nullif(coalesce(i->>'option_value',
                         (select string_agg(v, ', ') from jsonb_array_elements_text(
                            case when jsonb_typeof(i->'optionValueList') = 'array' then i->'optionValueList' else '[]'::jsonb end) v), ''), '') as option_name,
         case when coalesce(i->>'quantity', i->>'orderCount') ~ '^[0-9]{1,6}$' then coalesce(i->>'quantity', i->>'orderCount')::int end as quantity
    from channel_orders o
    left join lateral jsonb_array_elements(
           case when jsonb_typeof(o.raw->'items') = 'array' then o.raw->'items' else '[]'::jsonb end) i on true
   where o.id = any ((p_ids)[1:200])
$function$;
CREATE OR REPLACE FUNCTION public.cs_restore(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r cs_tickets_trash;
begin
  select * into r from cs_tickets_trash where id = p_id for update;
  if not found then raise exception '되돌릴 CS 가 없습니다'; end if;
  if not coalesce(is_master() or r.deleted_by_uid = auth.uid(), false) then
    raise exception '지운 사람만 되돌릴 수 있습니다(관리자는 모두)';
  end if;
  perform set_config('cs.restoring', '1', true);
  insert into cs_tickets select * from jsonb_populate_record(null::cs_tickets, r.row_data);
  perform set_config('cs.restoring', '', true);
  delete from cs_tickets_trash where id = p_id;
end $function$;
CREATE OR REPLACE FUNCTION public.cs_trash(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t cs_tickets; me text;
begin
  select * into t from cs_tickets where id = p_id for update;
  if not found then raise exception '없는 CS 입니다'; end if;
  if t.status = '완료' then raise exception '완료된 CS 는 지울 수 없습니다'; end if;
  if not coalesce(is_master() or t.created_by_uid = auth.uid(), false) then   -- NULL(098 전 행·비로그인)은 거절
    raise exception '직접 쓴 CS 만 지울 수 있습니다(관리자는 모두)';
  end if;
  select name into me from companies where username = current_username() limit 1;
  insert into cs_tickets_trash (id, row_data, deleted_by, deleted_by_uid)
    values (t.id, to_jsonb(t), coalesce(me, current_username()), auth.uid())
    on conflict (id) do update set row_data = excluded.row_data, deleted_by = excluded.deleted_by,
      deleted_by_uid = excluded.deleted_by_uid, deleted_at = now();
  delete from cs_tickets where id = p_id;
end $function$;
CREATE OR REPLACE FUNCTION public.current_username()
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$ select split_part(auth.jwt()->>'email','@',1) $function$;
CREATE OR REPLACE FUNCTION public.delete_auth_user_by_email(user_email text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  auth_id UUID;
BEGIN
  PERFORM public.require_role('MASTER');
  SELECT id INTO auth_id FROM auth.users WHERE email = user_email;
  IF auth_id IS NOT NULL THEN
    DELETE FROM auth.users WHERE id = auth_id;
  END IF;
END;
$function$;
CREATE OR REPLACE FUNCTION public.delete_brand_cascade(brand_uuid uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  p RECORD;
  c RECORD;
BEGIN
  PERFORM public.require_role('MASTER');
  -- 1. 소속 계정의 FK 참조 해제
  FOR c IN SELECT id FROM companies WHERE brand_id = brand_uuid LOOP
    UPDATE products  SET company_id  = NULL WHERE company_id  = c.id;
    UPDATE products  SET created_by  = NULL WHERE created_by  = c.id::text;
    UPDATE todos     SET assignee_id = NULL WHERE assignee_id = c.id;
    UPDATE todos     SET created_by  = NULL WHERE created_by  = c.id::text;
    UPDATE documents SET created_by  = NULL WHERE created_by  = c.id::text;
    UPDATE photos    SET created_by  = NULL WHERE created_by  = c.id::text;
    UPDATE memos     SET created_by  = NULL WHERE created_by  = c.id::text;
  END LOOP;
  -- 2. 소속 계정 삭제
  DELETE FROM companies WHERE brand_id = brand_uuid;
  -- 3. 프로젝트 하위 데이터 삭제
  FOR p IN SELECT id FROM products WHERE brand_id = brand_uuid LOOP
    DELETE FROM todos          WHERE product_id = p.id;
    DELETE FROM photos         WHERE product_id = p.id;
    DELETE FROM documents      WHERE product_id = p.id;
    DELETE FROM memos          WHERE product_id = p.id;
    DELETE FROM product_stages WHERE product_id = p.id;
    DELETE FROM history        WHERE product_id = p.id;
  END LOOP;
  -- 4. 소속 프로젝트 삭제
  DELETE FROM products WHERE brand_id = brand_uuid;
  -- 5. 전역 문서 삭제
  DELETE FROM global_documents WHERE brand_id = brand_uuid;
  -- 6. 브랜드 삭제
  DELETE FROM brands WHERE id = brand_uuid;
END;
$function$;
CREATE OR REPLACE FUNCTION public.delete_project_cascade(project_uuid uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  update notes
     set product_id = null,
         brand_id = coalesce(brand_id, v_brand),
         folder = '99_아카이브',
         title = case when title like '% (보관)' then title else title || ' (보관)' end
   where product_id = project_uuid
     and body like '%"embed":"season-home"%';
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
CREATE OR REPLACE FUNCTION public.delete_user_by_id(user_uuid uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.require_role('MASTER');
  DELETE FROM auth.users WHERE id = user_uuid;
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_channel_operational_status()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select jsonb_build_object( 'sync', coalesce((select jsonb_agg(jsonb_build_object('mall_key', mall_key, 'last_order_synced_at', last_sync_at)) from (select split_part(type,':',1) mall_key, max(run_at) last_sync_at from sync_log where channel='cafe24' and type like '%:pull_orders' and result='ok' group by 1) s), '[]'::jsonb), 'connections', '[]'::jsonb ) $function$;
CREATE OR REPLACE FUNCTION public.get_user_brand_id()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
    SELECT brand_id::text FROM companies WHERE username = split_part(auth.jwt()->>'email', '@', 1)                                                                      
    LIMIT 1;      
  $function$;
CREATE OR REPLACE FUNCTION public.get_user_company_id()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$                                                                                                                                                    
    SELECT id::text FROM companies WHERE username = split_part(auth.jwt()->>'email', '@', 1)
    LIMIT 1;
  $function$;
CREATE OR REPLACE FUNCTION public.get_user_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$                                                                                                                                                    
    SELECT role FROM companies WHERE username = split_part(auth.jwt()->>'email', '@', 1)                                                                                
    LIMIT 1;
  $function$;
CREATE OR REPLACE FUNCTION public.is_master()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from companies
                  where username = split_part(auth.jwt()->>'email', '@', 1)
                    and role = 'MASTER')
$function$;
CREATE OR REPLACE FUNCTION public.is_staff()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from companies
                  where username = split_part(auth.jwt()->>'email', '@', 1)
                    and role in ('MASTER', 'STAFF'))
$function$;
CREATE OR REPLACE FUNCTION public.morning_brief(p_days integer DEFAULT 7)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
with t as (select (now() at time zone 'Asia/Seoul')::date d),
win as (
  select 'review'::text k, greatest(1, p_days) n union all
  select 'news',   greatest(21, p_days) union all
  select 'trend',  greatest(60, p_days) union all
  select 'resale', 14
),
sel as (
  select i.kind, i.source, i.url, i.author, i.thumb, i.meta,
         case when i.author is not null and i.title ilike ('% - ' || i.author)
              then left(i.title, length(i.title) - length(i.author) - 3) else i.title end ttl,
         i.snippet,
         coalesce(i.published_at, i.created_at) at_ts,
         i.published_at is null as no_date
    from news_items i
    join win w on w.k = i.kind
   where case
           when i.kind = 'resale' then i.created_at >= now() - (w.n || ' days')::interval
           else coalesce(i.published_at, i.created_at) >= now() - (w.n || ' days')::interval
         end
),
dedup as (
  select distinct on (kind, lower(regexp_replace(ttl, '\s', '', 'g')))
         kind, source, url, author, thumb, meta, ttl title, snippet, at_ts, no_date
    from sel
   order by kind, lower(regexp_replace(ttl, '\s', '', 'g')), at_ts desc
)
select json_build_object(
  'date', (select d from t),
  'days', greatest(1, p_days),
  'ours',     coalesce((select json_agg(z) from (select title, snippet, url, author, source, thumb, meta, at_ts, no_date
      from dedup where kind = 'review' order by at_ts desc limit 10) z), '[]'::json),
  'industry', coalesce((select json_agg(z) from (select title, snippet, url, author, source, thumb, meta, at_ts, no_date
      from dedup where kind = 'news'   order by at_ts desc limit 14) z), '[]'::json),
  'trend',    coalesce((select json_agg(z) from (select title, snippet, url, author, source, thumb, meta, at_ts, no_date
      from dedup where kind = 'trend'  order by at_ts desc limit 14) z), '[]'::json),
  'resale',   coalesce((select json_agg(z) from (select title, snippet, url, author, source, thumb, meta, at_ts, no_date
      from dedup where kind = 'resale' order by at_ts desc limit 10) z), '[]'::json),
  'fresh', (select count(*) from news_items where created_at >= ((select d from t)::timestamp at time zone 'Asia/Seoul'))
);
$function$;
CREATE OR REPLACE FUNCTION public.order_fin_amount(p_order_amount numeric, p_raw jsonb)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  select case when jsonb_typeof(p_raw->'initial_order_amount') = 'object'
              then coalesce((p_raw->'initial_order_amount'->>'payment_amount')::numeric, 0)
                 + coalesce((p_raw->'initial_order_amount'->>'total_amount_due')::numeric, 0)
              else p_order_amount end
$function$;
CREATE OR REPLACE FUNCTION public.order_items_any_status(p_raw jsonb, p_like text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  select exists (select 1 from jsonb_array_elements(
                   case when jsonb_typeof(p_raw->'items') = 'array' then p_raw->'items' else '[]'::jsonb end) i
                 where i->>'order_status' like p_like)
$function$;
CREATE OR REPLACE FUNCTION public.order_mall_counts(p_q text DEFAULT NULL::text)
 RETURNS TABLE(mall_key text, cnt bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select o.mall_key, count(*)
    from channel_orders o
   where (p_q is null or p_q = ''
          or o.order_id ilike '%' || p_q || '%'
          or coalesce(o.buyer_name, '')    ilike '%' || p_q || '%'
          or coalesce(o.receiver_name, '') ilike '%' || p_q || '%'
          or coalesce(o.invoice_no, '')    ilike '%' || p_q || '%')
   group by 1
$function$;
CREATE OR REPLACE FUNCTION public.order_no_norm(t text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public'
AS $function$
  select case when upper(regexp_replace(coalesce(t, ''), '\s', '', 'g')) ~ '^(ORD)?[0-9]{8}-?[0-9]{7}$'
              then regexp_replace(coalesce(t, ''), '[^0-9]', '', 'g')
              else coalesce(t, '') end
$function$;
CREATE OR REPLACE FUNCTION public.order_op_state(p_channel text, p_channel_status text, p_raw jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  select case
    when coalesce(p_channel, 'cafe24') <> 'cafe24' then
      case
        when p_channel_status like '2%' then 'cancel'
        when p_channel_status like '3%' then 'return'
        when p_channel_status like '4%' then 'exchange'
        else 'done'                       -- 세부 배송상태를 안 주는 채널 → 정상건은 완료로 본다
      end
    else (
      select case
        when bool_or(c like 'C%') then 'cancel'
        when bool_or(c like 'R%') then 'return'
        when bool_or(c like 'E%') then 'exchange'
        when p_raw->>'shipping_status' = 'T' then 'done'
        when p_raw->>'shipping_status' = 'M' then 'shipping'
        when p_raw->>'shipping_status' = 'F' then 'pre'
        when bool_or(c ~ '^N[45]') then 'done'
        when bool_or(c like 'N3%') then 'shipping'
        else 'pre'
      end
      from (
        select upper(coalesce(it.value->>'status', it.value->>'order_status', '')) c
        from jsonb_array_elements(
          case when jsonb_typeof(p_raw->'items') = 'array' then p_raw->'items' else '[]'::jsonb end) it
      ) codes)
  end
$function$;
CREATE OR REPLACE FUNCTION public.order_tab_counts(p_mall text DEFAULT NULL::text, p_q text DEFAULT NULL::text)
 RETURNS TABLE(op_status text, cnt bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select o.op_status, count(*)
    from channel_orders o
   where (p_mall is null or p_mall = '' or p_mall = 'ALL' or o.mall_key = p_mall)
     and (p_q is null or p_q = ''
          or o.order_id ilike '%' || p_q || '%'
          or coalesce(o.buyer_name, '')    ilike '%' || p_q || '%'
          or coalesce(o.receiver_name, '') ilike '%' || p_q || '%'
          or coalesce(o.invoice_no, '')    ilike '%' || p_q || '%')
   group by 1
$function$;
CREATE OR REPLACE FUNCTION public.purge_old_news()
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with gone as (delete from news_items where created_at < now() - interval '180 days' returning 1)
  select count(*)::int from gone;
$function$;
CREATE OR REPLACE FUNCTION public.reap_apify_runs()
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with x as (
    update apify_runs set status = 'REAPED', harvested = true, done_at = now()
     where harvested = false and created_at < now() - interval '48 hours'
    returning 1)
  select count(*)::int from x;
$function$;
CREATE OR REPLACE FUNCTION public.require_role(VARIADIC p_roles text[])
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r text;
begin
  r := public.get_user_role();
  if r is null or not (r = any (p_roles)) then
    raise exception '권한이 없습니다. (필요: %, 지금: %)',
      array_to_string(p_roles, ' 또는 '), coalesce(r, '로그인 안 됨')
      using errcode = '42501';
  end if;
end $function$;
CREATE OR REPLACE FUNCTION public.state_sig(o channel_orders)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$ select public.cafe24_state_sig(o.raw) $function$;
CREATE OR REPLACE FUNCTION public.ui_events_finalize()
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare gone bigint; cfg ui_events_config%rowtype;
begin
  if not public.is_master() then raise exception 'ui_events_finalize: 관리자만'; end if;
  select * into cfg from ui_events_config where id for update;
  if cfg.finalized_at is not null then return 0; end if;
  if now() < cfg.ends_at then raise exception 'ui_events_finalize: 아직 수집 중(% 까지)', cfg.ends_at; end if;

  insert into ui_usage_summary (metric, day, screen, action, n, value)
    select 'daily', (at at time zone 'Asia/Seoul')::date, screen, action, count(*), count(distinct user_id) from ui_events group by 2, 3, 4;
  insert into ui_usage_summary (metric, screen, n)
    select 'first_screen', screen, count(*) from ui_m_first_screen group by screen;          -- 사람·날 수(누구인지는 안 남김)
  insert into ui_usage_summary (metric, screen, n, value)
    select 'open_top', screen, opens, users from ui_m_open_top;
  insert into ui_usage_summary (metric, screen, action, n, value)
    select 'task_clicks', screen, task, done, avg_clicks from ui_m_task_clicks;
  insert into ui_usage_summary (metric, screen, n, value)
    select 'quick_close', screen, opens, quick_closes from ui_m_quick_close;
  insert into ui_usage_summary (metric, screen)
    select 'unused', screen from ui_m_unused;

  delete from ui_events;
  get diagnostics gone = row_count;
  update ui_events_config set finalized_at = now() where id;
  return gone;
end $function$;
CREATE OR REPLACE FUNCTION public.ui_events_until()
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when finalized_at is null then ends_at else least(ends_at, finalized_at) end from ui_events_config where id   -- 확정 뒤엔 기간을 늘려도 다시 안 열림
$function$;
CREATE OR REPLACE FUNCTION public.weekly_brief(p_week_start date)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_s date := p_week_start;
  v_e date := p_week_start + 6;
  v_p date := p_week_start - 7;
  v_a date := p_week_start - 28;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_health json; v_total json; v_brand json; v_top json; v_claims json; v_cs json;
  v_ship json; v_prod json; v_stock json; v_news json; v_insta json;
begin
  if p_week_start is null or extract(isodow from p_week_start) <> 1 then
    raise exception 'p_week_start 는 월요일이어야 합니다: %', p_week_start using errcode = '22023';
  end if;
  if coalesce(auth.jwt()->>'role', '') <> 'service_role'
     and exists (select 1 from brands b where coalesce(b.status, '') <> 'closed' and not public.can_access_brand(b.id)) then
    raise exception 'forbidden: weekly_brief' using errcode = '42501';
  end if;

  -- §health
  begin
    select coalesce(json_agg(json_build_object('mall_key', h.mall_key, 'brand', h.brand, 'status', h.status,
             'last_sync_at', h.last_sync_at) order by h.mall_key), '[]'::json)
      into v_health
      from channel_health h join malls m on m.mall_key = h.mall_key
     where m.active;
  exception when others then v_health := json_build_object('error', sqlerrm); end;

  -- §sales_total  (홈·매출 탭 '매출' = actual_paid_amount, 084) + 클레임 — 느린 뷰라 5주를 한 번만 읽는다
  begin
    select json_build_object(
             'this', json_build_object(
                 'paid',         round(coalesce(sum(actual_paid_amount) filter (where d between v_s and v_e), 0)),
                 'order_amount', round(coalesce(sum(order_amount)       filter (where d between v_s and v_e), 0)),
                 'refund',       round(coalesce(sum(refund_amount)      filter (where d between v_s and v_e), 0)),
                 'order_count',  coalesce(sum(order_count)              filter (where d between v_s and v_e), 0)),
             'prev', json_build_object(
                 'paid',         round(coalesce(sum(actual_paid_amount) filter (where d between v_p and v_p + 6), 0)),
                 'order_amount', round(coalesce(sum(order_amount)       filter (where d between v_p and v_p + 6), 0)),
                 'refund',       round(coalesce(sum(refund_amount)      filter (where d between v_p and v_p + 6), 0)),
                 'order_count',  coalesce(sum(order_count)              filter (where d between v_p and v_p + 6), 0)),
             'avg4', json_build_object(
                 'paid',         round(coalesce(sum(actual_paid_amount) filter (where d < v_s), 0) / 4),
                 'order_amount', round(coalesce(sum(order_amount)       filter (where d < v_s), 0) / 4),
                 'refund',       round(coalesce(sum(refund_amount)      filter (where d < v_s), 0) / 4),
                 'order_count',  round(coalesce(sum(order_count)        filter (where d < v_s), 0)::numeric / 4))),
           json_build_object(
             'cancel_count',   coalesce(sum(cancel_count)          filter (where d between v_s and v_e), 0),
             'cancel_amount',  round(coalesce(sum(cancel_amount)   filter (where d between v_s and v_e), 0)),
             'return_count',   coalesce(sum(return_count)          filter (where d between v_s and v_e), 0),
             'return_amount',  round(coalesce(sum(return_refund_amount) filter (where d between v_s and v_e), 0)),
             'return_pending', coalesce(sum(return_pending_count)  filter (where d between v_s and v_e), 0))
      into v_total, v_claims
      from dashboard_financial_daily where d between v_a and v_e;
  exception when others then
    v_total := json_build_object('error', sqlerrm); v_claims := json_build_object('error', sqlerrm);
  end;

  -- §sales_by_brand  (sales_daily = 주문 기준, 합계와 정의가 다르다)
  begin
    select coalesce(json_agg(x order by x.amt desc nulls last), '[]'::json) into v_brand from (
      select brand_name,
             round(sum(amt) filter (where d between v_s and v_e)) amt,
             sum(cnt) filter (where d between v_s and v_e)::int cnt,
             round(sum(amt) filter (where d between v_p and v_p + 6)) amt_prev,
             sum(cnt) filter (where d between v_p and v_p + 6)::int cnt_prev
        from sales_daily where d between v_p and v_e
       group by brand_name) x;
  exception when others then v_brand := json_build_object('error', sqlerrm); end;

  -- §top_items  (수량 상위 5, 지난주 순위 같이)
  begin
    with it as (
      select left(i.product_name, 34) nm, (o.order_date at time zone 'Asia/Seoul')::date od, coalesce(i.quantity, 1) q
        from channel_orders o join channel_order_items i on i.channel_order_id = o.id
       where o.order_date >= (v_p::timestamp at time zone 'Asia/Seoul')
         and o.order_date <  ((v_e + 1)::timestamp at time zone 'Asia/Seoul')
         and coalesce(o.op_status, '') not in ('cancel', 'return')
    ), cur as (
      select nm, sum(q)::int qty, row_number() over (order by sum(q) desc, nm) rk from it where od between v_s and v_e group by nm
    ), prv as (
      select nm, row_number() over (order by sum(q) desc, nm) rk from it where od between v_p and v_p + 6 group by nm
    )
    select coalesce(json_agg(json_build_object('name', cur.nm, 'qty', cur.qty, 'rank_prev', prv.rk) order by cur.rk), '[]'::json)
      into v_top from cur left join prv on prv.nm = cur.nm where cur.rk <= 5;
  exception when others then v_top := json_build_object('error', sqlerrm); end;

  -- §cs  (신규 = 그 주 발생, 미처리 = 지금 '완료' 아님)
  begin
    select json_build_object(
             'new',        (select count(*) from cs_tickets where occurred_on between v_s and v_e),
             'open',       (select count(*) from cs_tickets where coalesce(status, '') <> '완료'),
             'open_over7', (select count(*) from cs_tickets where coalesce(status, '') <> '완료' and occurred_on < v_today - 7),
             'by_kind', coalesce((select json_agg(z order by z.n desc) from (
                 select coalesce(kind, '기타') kind, count(*)::int n from cs_tickets
                  where occurred_on between v_s and v_e group by 1) z), '[]'::json))
      into v_cs;
  exception when others then v_cs := json_build_object('error', sqlerrm); end;

  -- §shipping  (지금 기준 — 주문 탭 '대상' = op_status 'pre')
  begin
    select json_build_object(
             'pre',     (select count(*) from channel_orders where op_status = 'pre'),
             'failed',  (select count(*) from shipment_jobs where status = 'failed'),
             'unknown', (select count(*) from shipment_jobs where status = 'failed' and last_error like 'timeout_unknown:%'))
      into v_ship;
  exception when others then v_ship := json_build_object('error', sqlerrm); end;

  -- §production  (product_items.ship_date — 7일 안 출고예정 · 지난 납기)
  begin
    select json_build_object(
             'due7', coalesce((select json_agg(z order by z.ship_date) from (
                 select name, ship_date, status from product_items
                  where ship_date between v_today and v_today + 7 and coalesce(status, '') <> '출고완료' limit 10) z), '[]'::json),
             'overdue', coalesce((select json_agg(z order by z.ship_date) from (
                 select name, ship_date, status from product_items
                  where ship_date < v_today and coalesce(status, '') <> '출고완료' limit 10) z), '[]'::json))
      into v_prod;
  exception when others then v_prod := json_build_object('error', sqlerrm); end;

  -- §stock  (active 만, 안전재고는 0보다 클 때만 본다)
  begin
    select json_build_object(
             'negative',     (select count(*) from inventory_items where active and on_hand < 0),
             'low',          (select count(*) from inventory_items where active and safety_stock > 0 and on_hand <= safety_stock),
             'material_low', (select count(*) from material_items  where active and safety_stock > 0 and on_hand <= safety_stock))
      into v_stock;
  exception when others then v_stock := json_build_object('error', sqlerrm); end;

  -- §news_candidates  (그 주에 나온 소식 최신 5개 — 사람이 회의에서 고른다)
  begin
    select coalesce(json_agg(z order by z.published_at desc nulls last), '[]'::json) into v_news from (
      select id, kind, title, url, coalesce(published_at, created_at) published_at
        from news_items
       where kind in ('trend', 'competitor_post', 'review', 'resale')
         and coalesce(published_at, created_at) >= (v_s::timestamp at time zone 'Asia/Seoul')
         and coalesce(published_at, created_at) <  ((v_e + 1)::timestamp at time zone 'Asia/Seoul')
       order by coalesce(published_at, created_at) desc limit 5) z;
  exception when others then v_news := json_build_object('error', sqlerrm); end;

  -- §insta  (주 끝 스냅샷 − 주 시작 직전 스냅샷)
  begin
    with ours as (
      select a.username nm, 'ours' who,
             (select followers from ig_snapshots s where s.account_id = a.id and s.snap_date <= v_e order by snap_date desc limit 1) f_end,
             (select followers from ig_snapshots s where s.account_id = a.id and s.snap_date <  v_s order by snap_date desc limit 1) f_start,
             (select sum(posts_delta) from ig_snapshots s where s.account_id = a.id and s.snap_date between v_s and v_e) posts,
             null::numeric avg_likes
        from ig_accounts a where a.active
    ), comp as (
      select c.name nm, 'competitor' who,
             (select followers from competitor_snapshots s where s.competitor_id = c.id and s.snap_date <= v_e order by snap_date desc limit 1),
             (select followers from competitor_snapshots s where s.competitor_id = c.id and s.snap_date <  v_s order by snap_date desc limit 1),
             (select sum(posts_delta) from competitor_snapshots s where s.competitor_id = c.id and s.snap_date between v_s and v_e),
             (select round(avg(avg_likes), 1) from competitor_snapshots s where s.competitor_id = c.id and s.snap_date between v_s and v_e)
        from competitors c where c.active
    )
    select coalesce(json_agg(json_build_object('name', nm, 'who', who, 'followers', f_end, 'delta', f_end - f_start,
             'posts', posts, 'avg_likes', avg_likes) order by who desc, f_end desc nulls last), '[]'::json)
      into v_insta from (select * from ours union all select * from comp) x where f_end is not null;
  exception when others then v_insta := json_build_object('error', sqlerrm); end;

  return json_build_object(
    'week', json_build_object('start', v_s, 'end', v_e),
    'made_at', now(),
    'health', v_health,
    'sales', json_build_object('total', v_total, 'by_brand', v_brand),
    'top_items', v_top, 'claims', v_claims, 'cs', v_cs, 'shipping', v_ship,
    'production', v_prod, 'stock', v_stock, 'news_candidates', v_news, 'insta', v_insta);
end;
$function$;
create policy "ad_status_read" on public."ad_status" as permissive for select to authenticated using (true);
create policy "apify_runs_read" on public."apify_runs" as permissive for select to public using ((auth.uid() IS NOT NULL));
create policy "cards_delete" on public."board_cards" as permissive for delete to public using ((get_user_role() = 'MASTER'::text));
create policy "cards_select" on public."board_cards" as permissive for select to public using ((auth.uid() IS NOT NULL));
create policy "cards_update" on public."board_cards" as permissive for update to public using ((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])));
create policy "cards_write" on public."board_cards" as permissive for insert to public with check ((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])));
create policy "bset_select" on public."brand_settings" as permissive for select to public using ((auth.uid() IS NOT NULL));
create policy "bset_write" on public."brand_settings" as permissive for all to public using ((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text]))) with check ((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])));
create policy "brands_delete" on public."brands" as permissive for delete to public using ((get_user_role() = 'MASTER'::text));
create policy "brands_insert" on public."brands" as permissive for insert to public with check ((get_user_role() = 'MASTER'::text));
create policy "brands_select" on public."brands" as permissive for select to public using ((auth.uid() IS NOT NULL));
create policy "brands_update" on public."brands" as permissive for update to public using ((get_user_role() = 'MASTER'::text));
create policy "member_counts_select" on public."cafe24_member_counts" as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM malls m
  WHERE ((m.mall_key = cafe24_member_counts.mall_key) AND can_access_brand(m.brand_id)))));
create policy "calendar_occurrences_delete" on public."calendar_routine_occurrences" as permissive for delete to authenticated using ((EXISTS ( SELECT 1
   FROM calendar_routines r
  WHERE ((r.id = calendar_routine_occurrences.routine_id) AND can_manage_calendar_routine(r.*)))));
create policy "calendar_occurrences_insert" on public."calendar_routine_occurrences" as permissive for insert to authenticated with check ((EXISTS ( SELECT 1
   FROM calendar_routines r
  WHERE ((r.id = calendar_routine_occurrences.routine_id) AND (can_manage_calendar_routine(r.*) OR can_complete_calendar_routine(r.*))))));
create policy "calendar_occurrences_select" on public."calendar_routine_occurrences" as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM calendar_routines r
  WHERE ((r.id = calendar_routine_occurrences.routine_id) AND can_view_calendar_routine(r.*)))));
create policy "calendar_occurrences_update" on public."calendar_routine_occurrences" as permissive for update to authenticated using ((EXISTS ( SELECT 1
   FROM calendar_routines r
  WHERE ((r.id = calendar_routine_occurrences.routine_id) AND (can_manage_calendar_routine(r.*) OR can_complete_calendar_routine(r.*)))))) with check ((EXISTS ( SELECT 1
   FROM calendar_routines r
  WHERE ((r.id = calendar_routine_occurrences.routine_id) AND (can_manage_calendar_routine(r.*) OR can_complete_calendar_routine(r.*))))));
create policy "calendar_routines_delete" on public."calendar_routines" as permissive for delete to authenticated using (can_manage_calendar_routine(calendar_routines.*));
create policy "calendar_routines_insert" on public."calendar_routines" as permissive for insert to authenticated with check (((creator_user_id = auth.uid()) AND (get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text]))));
create policy "calendar_routines_select" on public."calendar_routines" as permissive for select to authenticated using (can_view_calendar_routine(calendar_routines.*));
create policy "calendar_routines_update" on public."calendar_routines" as permissive for update to authenticated using (can_manage_calendar_routine(calendar_routines.*)) with check (can_manage_calendar_routine(calendar_routines.*));
create policy "channel_listings_delete" on public."channel_listings" as permissive for delete to public using ((get_user_role() = 'MASTER'::text));
create policy "listings_delete" on public."channel_listings" as permissive for delete to public using ((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])));
create policy "listings_select" on public."channel_listings" as permissive for select to public using ((EXISTS ( SELECT 1
   FROM inventory_items i
  WHERE (i.id = channel_listings.inventory_item_id))));
create policy "listings_write" on public."channel_listings" as permissive for insert to public with check ((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])));
create policy "order_items_insert" on public."channel_order_items" as permissive for insert to public with check ((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])));
create policy "order_items_select" on public."channel_order_items" as permissive for select to public using ((EXISTS ( SELECT 1
   FROM channel_orders o
  WHERE (o.id = channel_order_items.channel_order_id))));
create policy "orders_insert" on public."channel_orders" as permissive for insert to public with check ((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])));
create policy "orders_select" on public."channel_orders" as permissive for select to public using ((EXISTS ( SELECT 1
   FROM malls m
  WHERE ((m.mall_key = channel_orders.mall_key) AND can_access_brand(m.brand_id)))));
create policy "orders_update" on public."channel_orders" as permissive for update to public using (((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])) AND (EXISTS ( SELECT 1
   FROM malls m
  WHERE ((m.mall_key = channel_orders.mall_key) AND can_access_brand(m.brand_id))))));
create policy "css_master_insert" on public."channel_sync_state" as permissive for insert to public with check ((get_user_role() = 'MASTER'::text));
create policy "css_master_update" on public."channel_sync_state" as permissive for update to public using ((get_user_role() = 'MASTER'::text));
create policy "clients_select" on public."clients" as permissive for select to public using ((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])));
create policy "clients_write" on public."clients" as permissive for all to public using ((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text]))) with check ((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])));
create policy "companies_delete" on public."companies" as permissive for delete to public using ((get_user_role() = 'MASTER'::text));
create policy "companies_insert" on public."companies" as permissive for insert to public with check ((get_user_role() = 'MASTER'::text));
create policy "companies_select" on public."companies" as permissive for select to public using (((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])) OR ((id)::text = get_user_company_id())));
create policy "companies_update" on public."companies" as permissive for update to public using ((get_user_role() = 'MASTER'::text));
create policy "csnap_sel" on public."competitor_snapshots" as permissive for select to authenticated using (true);
create policy "comp_del" on public."competitors" as permissive for delete to authenticated using ((get_user_role() = 'MASTER'::text));
create policy "comp_ins" on public."competitors" as permissive for insert to authenticated with check ((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])));
create policy "comp_sel" on public."competitors" as permissive for select to authenticated using (true);
create policy "comp_upd" on public."competitors" as permissive for update to authenticated using ((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])));
create policy "cs_delete" on public."cs_tickets" as permissive for delete to authenticated using ((get_user_role() = 'MASTER'::text));
create policy "cs_insert" on public."cs_tickets" as permissive for insert to authenticated with check (true);
create policy "cs_select" on public."cs_tickets" as permissive for select to authenticated using (((brand_id IS NULL) OR can_access_brand(brand_id)));
create policy "cs_update" on public."cs_tickets" as permissive for update to authenticated using (true);
create policy "documents_delete" on public."documents" as permissive for delete to public using (((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])) OR ((created_by)::text = get_user_company_id())));
create policy "documents_insert" on public."documents" as permissive for insert to public with check ((auth.uid() IS NOT NULL));
create policy "documents_select" on public."documents" as permissive for select to public using ((auth.uid() IS NOT NULL));
create policy "exp_delete" on public."expenses" as permissive for delete to authenticated using ((get_user_role() = 'MASTER'::text));
create policy "exp_insert" on public."expenses" as permissive for insert to authenticated with check (true);
create policy "exp_select" on public."expenses" as permissive for select to authenticated using (((get_user_role() = 'MASTER'::text) OR (created_by = current_username())));
create policy "exp_update" on public."expenses" as permissive for update to authenticated using (true);
create policy "feedback_insert" on public."feedback" as permissive for insert to authenticated with check (true);
create policy "feedback_select" on public."feedback" as permissive for select to authenticated using ((get_user_role() = 'MASTER'::text));
create policy "feedback_update" on public."feedback" as permissive for update to authenticated using ((get_user_role() = 'MASTER'::text)) with check ((get_user_role() = 'MASTER'::text));
create policy "feedback_insert" on public."feedback_reports" as permissive for insert to authenticated with check ((is_staff() AND (username = current_username()) AND (status = '접수'::text) AND (admin_note = ''::text) AND ((image_path IS NULL) OR (split_part(image_path, '/'::text, 1) = current_username()))));
create policy "feedback_select" on public."feedback_reports" as permissive for select to authenticated using (((is_staff() AND (username = current_username())) OR is_master()));
create policy "feedback_update" on public."feedback_reports" as permissive for update to authenticated using (is_master()) with check (is_master());
create policy "gdocs_delete" on public."global_documents" as permissive for delete to public using ((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])));
create policy "gdocs_insert" on public."global_documents" as permissive for insert to public with check ((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])));
create policy "gdocs_select" on public."global_documents" as permissive for select to public using ((auth.uid() IS NOT NULL));
create policy "history_insert" on public."history" as permissive for insert to public with check ((auth.uid() IS NOT NULL));
create policy "history_select" on public."history" as permissive for select to public using ((auth.uid() IS NOT NULL));
create policy "ig_accounts_rw" on public."ig_accounts" as permissive for all to authenticated using (true) with check (true);
create policy "ig_snapshots_rw" on public."ig_snapshots" as permissive for all to authenticated using (true) with check (true);
create policy "inv_items_delete" on public."inventory_items" as permissive for delete to public using ((get_user_role() = 'MASTER'::text));
create policy "inv_items_select" on public."inventory_items" as permissive for select to public using (can_access_brand(brand_id));
create policy "inv_items_update" on public."inventory_items" as permissive for update to public using ((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])));
create policy "inv_items_write" on public."inventory_items" as permissive for insert to public with check ((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])));
create policy "ledger_insert" on public."inventory_ledger" as permissive for insert to public with check (((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])) AND (reason = ANY (ARRAY['initial'::text, 'restock'::text, 'manual'::text, 'adjust'::text, 'return'::text]))));
create policy "ledger_select" on public."inventory_ledger" as permissive for select to public using ((EXISTS ( SELECT 1
   FROM inventory_items i
  WHERE (i.id = inventory_ledger.inventory_item_id))));
create policy "malls_delete" on public."malls" as permissive for delete to public using ((get_user_role() = 'MASTER'::text));
create policy "malls_select" on public."malls" as permissive for select to public using (can_access_brand(brand_id));
create policy "malls_update" on public."malls" as permissive for update to public using ((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])));
create policy "malls_write" on public."malls" as permissive for insert to public with check ((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])));
create policy "material_items_delete" on public."material_items" as permissive for delete to public using ((get_user_role() = 'MASTER'::text));
create policy "material_items_insert" on public."material_items" as permissive for insert to public with check ((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])));
create policy "material_items_select" on public."material_items" as permissive for select to public using ((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])));
create policy "material_items_update" on public."material_items" as permissive for update to public using ((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text]))) with check ((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])));
create policy "material_ledger_insert" on public."material_ledger" as permissive for insert to public with check (((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])) AND (reason = ANY (ARRAY['initial'::text, 'purchase'::text, 'production_use'::text, 'sample_use'::text, 'waste'::text, 'return'::text, 'adjust'::text]))));
create policy "material_ledger_select" on public."material_ledger" as permissive for select to public using ((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])));
create policy "memos_delete" on public."memos" as permissive for delete to public using (((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])) OR ((created_by)::text = get_user_company_id())));
create policy "memos_insert" on public."memos" as permissive for insert to public with check ((auth.uid() IS NOT NULL));
create policy "memos_select" on public."memos" as permissive for select to public using ((auth.uid() IS NOT NULL));
create policy "news_sel" on public."news_items" as permissive for select to authenticated using (true);
create policy "ns_sel" on public."news_sources" as permissive for select to authenticated using (true);
create policy "ns_wr" on public."news_sources" as permissive for all to authenticated using ((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text]))) with check ((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])));
create policy "nf_select" on public."note_folders" as permissive for select to authenticated using (((get_user_role() = 'MASTER'::text) OR (access = 'all'::text) OR (current_username() = ANY (members))));
create policy "nf_write" on public."note_folders" as permissive for all to authenticated using ((get_user_role() = 'MASTER'::text)) with check ((get_user_role() = 'MASTER'::text));
create policy "notes_delete" on public."notes" as permissive for delete to authenticated using (can_see_scope(scope, owner, brand_id));
create policy "notes_insert" on public."notes" as permissive for insert to authenticated with check (true);
create policy "notes_select" on public."notes" as permissive for select to authenticated using ((can_see_note(scope, owner, product_id, brand_id) AND can_see_folder(folder)));
create policy "notes_update" on public."notes" as permissive for update to authenticated using (can_see_note(scope, owner, product_id, brand_id));
create policy "notice_reads_insert" on public."notice_reads" as permissive for insert to authenticated with check ((is_staff() AND (username = current_username())));
create policy "notice_reads_select" on public."notice_reads" as permissive for select to authenticated using (((username = current_username()) OR is_master()));
create policy "notices_delete" on public."notices" as permissive for delete to authenticated using (is_master());
create policy "notices_insert" on public."notices" as permissive for insert to authenticated with check ((is_master() AND (created_by = current_username())));
create policy "notices_select" on public."notices" as permissive for select to authenticated using ((is_master() OR (published AND is_staff())));
create policy "notices_update" on public."notices" as permissive for update to authenticated using (is_master()) with check (is_master());
create policy "operation_audit_select" on public."operation_audit" as permissive for select to public using ((get_user_role() = 'MASTER'::text));
create policy "pages_delete" on public."pages" as permissive for delete to public using ((get_user_role() = 'MASTER'::text));
create policy "pages_select" on public."pages" as permissive for select to public using ((auth.uid() IS NOT NULL));
create policy "pages_update" on public."pages" as permissive for update to public using ((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])));
create policy "pages_write" on public."pages" as permissive for insert to public with check ((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])));
create policy "photos_delete" on public."photos" as permissive for delete to public using (((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])) OR ((created_by)::text = (auth.uid())::text)));
create policy "photos_insert" on public."photos" as permissive for insert to public with check ((auth.uid() IS NOT NULL));
create policy "photos_select" on public."photos" as permissive for select to public using ((auth.uid() IS NOT NULL));
create policy "pitem_delete" on public."product_items" as permissive for delete to authenticated using (((get_user_role() = 'MASTER'::text) OR ((brand_id IS NULL) OR can_access_brand(brand_id))));
create policy "pitem_select" on public."product_items" as permissive for select to authenticated using ((((brand_id IS NULL) OR can_access_brand(brand_id)) AND ((product_id IS NULL) OR can_access_project(product_id))));
create policy "pitem_update" on public."product_items" as permissive for update to authenticated using (((brand_id IS NULL) OR can_access_brand(brand_id))) with check (((brand_id IS NULL) OR can_access_brand(brand_id)));
create policy "pitem_write" on public."product_items" as permissive for insert to authenticated with check (((brand_id IS NULL) OR can_access_brand(brand_id)));
create policy "stages_select" on public."product_stages" as permissive for select to public using ((auth.uid() IS NOT NULL));
create policy "stages_update" on public."product_stages" as permissive for update to public using ((auth.uid() IS NOT NULL));
create policy "stages_upsert" on public."product_stages" as permissive for insert to public with check ((auth.uid() IS NOT NULL));
create policy "products_delete" on public."products" as permissive for delete to public using ((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])));
create policy "products_insert" on public."products" as permissive for insert to public with check ((auth.uid() IS NOT NULL));
create policy "products_select" on public."products" as permissive for select to authenticated using (((get_user_role() = 'MASTER'::text) OR (brand_id IS NULL) OR can_access_brand(brand_id) OR ((company_id)::text = get_user_company_id())));
create policy "products_update" on public."products" as permissive for update to public using ((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])));
create policy "quotes_delete" on public."quotes" as permissive for delete to public using ((get_user_role() = 'MASTER'::text));
create policy "quotes_select" on public."quotes" as permissive for select to public using ((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])));
create policy "quotes_update" on public."quotes" as permissive for update to public using ((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])));
create policy "quotes_write" on public."quotes" as permissive for insert to public with check ((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])));
create policy "rem_delete" on public."reminders" as permissive for delete to authenticated using (can_see_scope(scope, owner, NULL::uuid));
create policy "rem_insert" on public."reminders" as permissive for insert to authenticated with check (true);
create policy "rem_select" on public."reminders" as permissive for select to authenticated using ((can_access_project(product_id) AND ((scope <> 'private'::text) OR (NOT (owner IS DISTINCT FROM current_username())) OR (get_user_role() = 'MASTER'::text))));
create policy "rem_update" on public."reminders" as permissive for update to authenticated using ((can_access_project(product_id) AND ((scope <> 'private'::text) OR (NOT (owner IS DISTINCT FROM current_username())) OR (get_user_role() = 'MASTER'::text))));
create policy "sstep_del" on public."season_steps" as permissive for delete to authenticated using ((get_user_role() = 'MASTER'::text));
create policy "sstep_ins" on public."season_steps" as permissive for insert to authenticated with check ((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])));
create policy "sstep_sel" on public."season_steps" as permissive for select to authenticated using (true);
create policy "sstep_upd" on public."season_steps" as permissive for update to authenticated using ((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])));
create policy "shipment_jobs_select" on public."shipment_jobs" as permissive for select to public using ((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])));
create policy "shipment_jobs_write" on public."shipment_jobs" as permissive for all to public using ((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text]))) with check ((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])));
create policy "synclog_select" on public."sync_log" as permissive for select to public using ((auth.uid() IS NOT NULL));
create policy "tech_packs_staff" on public."tech_packs" as permissive for all to authenticated using (is_staff()) with check (is_staff());
create policy "todos_delete" on public."todos" as permissive for delete to public using (((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])) OR (created_by = get_user_company_id())));
create policy "todos_insert" on public."todos" as permissive for insert to public with check ((auth.uid() IS NOT NULL));
create policy "todos_select" on public."todos" as permissive for select to public using ((auth.uid() IS NOT NULL));
create policy "todos_select_proj" on public."todos" as permissive for select to authenticated using (can_access_project(product_id));
create policy "todos_update" on public."todos" as permissive for update to public using ((auth.uid() IS NOT NULL));
create policy "ui_events_insert" on public."ui_events" as permissive for insert to authenticated with check ((is_staff() AND (user_id = auth.uid()) AND (now() < ui_events_until())));
create policy "ui_events_select" on public."ui_events" as permissive for select to authenticated using ((is_master() AND (now() < (ui_events_until() + '14 days'::interval))));
create policy "ui_usage_summary_select" on public."ui_usage_summary" as permissive for select to authenticated using (is_master());
create policy "vendor_categories_delete" on public."vendor_categories" as permissive for delete to authenticated using (((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])) AND (name <> '기타'::text)));
create policy "vendor_categories_insert" on public."vendor_categories" as permissive for insert to authenticated with check ((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])));
create policy "vendor_categories_select" on public."vendor_categories" as permissive for select to authenticated using ((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])));
create policy "vendor_categories_update" on public."vendor_categories" as permissive for update to authenticated using (((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])) AND (name <> '기타'::text))) with check (((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])) AND (name <> '기타'::text)));
create policy "vjobs_delete" on public."vendor_jobs" as permissive for delete to public using ((get_user_role() = 'MASTER'::text));
create policy "vjobs_select" on public."vendor_jobs" as permissive for select to public using ((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])));
create policy "vjobs_update" on public."vendor_jobs" as permissive for update to public using ((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])));
create policy "vjobs_write" on public."vendor_jobs" as permissive for insert to public with check ((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])));
create policy "vendors_delete" on public."vendors" as permissive for delete to public using ((get_user_role() = 'MASTER'::text));
create policy "vendors_select" on public."vendors" as permissive for select to public using ((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])));
create policy "vendors_update" on public."vendors" as permissive for update to public using ((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])));
create policy "vendors_write" on public."vendors" as permissive for insert to public with check ((get_user_role() = ANY (ARRAY['MASTER'::text, 'STAFF'::text])));
do $x$ declare r record; begin for r in select p.oid::regprocedure s from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname = any(array['apply_channel_inventory_adjustment','claim_shipment_job','claim_shipment_registration','claim_tax_invoice','claim_vendor_quick','cs_fill_from_order','purge_old_news']) loop execute 'revoke all on function '||r.s||' from public'; end loop; end $x$;
reset check_function_bodies;
