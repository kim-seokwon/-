-- 089 weekly_brief — 주간 회의록 1단계(.work/회의록/기획.md 3-2). ⚠ 후보 파일: 운영 적용은 승인 뒤.
--  읽기만 하는 함수 1개. 화면(자료실 > 회의록 [이번 주 회의록 만들기])이 버튼을 누를 때 한 번 부른다.
--  · p_week_start = 집계할 주의 월요일(KST). 월요일이 아니면 오류.
--    화면은 '회의하는 주'의 지난주(다 끝난 7일)를 넘긴다 — 월요일 아침엔 이번 주 숫자가 비어 있어서.
--  · 지난주 = p_week_start - 7, 4주 평균 = 직전 4주 합 ÷ 4. 날짜는 모두 KST.
--  · 출처 하나가 실패해도 나머지는 채운다 — 그 키만 {"error": "..."}.
--  · 회사 전체 숫자라 모든 브랜드를 볼 수 있는 사람(MASTER 등)만 — can_access_brand 를 한 브랜드라도 못 넘으면 42501.
--  · dashboard_financial_daily 는 느리다(5~9초) → d 를 5주 범위로만 읽는다.
--  기획서와 다른 점: 생산 일정은 products 가 아니라 product_items.ship_date (products 에 ship_date 칸이 없다, 10-20 운영 조회).
--  되돌리기: drop function if exists public.weekly_brief(date);

create or replace function public.weekly_brief(p_week_start date)
returns json language plpgsql stable security definer set search_path = public as $$
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
$$;

revoke all on function public.weekly_brief(date) from public, anon;
grant execute on function public.weekly_brief(date) to authenticated;

notify pgrst, 'reload schema';
