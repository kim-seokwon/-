// 카페24 멀티몰 동기화 (스케줄/수동)
//  각 활성 몰에 대해:
//   1) 토큰 갱신  2) 주문 pull → channel_orders 저장 + 재고 차감(원장, 멱등)
//   3) 상태변경 재동기화(restatus) → 이미 저장된 주문의 취소/반품/교환·배송상태 갱신
//   4) 현재고 → 카페24 push (dry_run 이면 로그만)  5) last_order_synced_at, sync_log
// 호출: POST <func-url>                        → 활성 몰 전체
//       POST <func-url> {mall:키}              → 특정 몰만
//       POST <func-url> {restatus_days:180}    → 재동기화 기간 조정(기본 60일)
//       POST <func-url> {restatus:false}       → 재동기화 건너뛰기
//       POST <func-url> {mode:"restatus", restatus_from:"2025-01-01"}  → 재동기화만 전체기간
import { admin, cafe24Fetch, cors, ensureToken, getActiveMalls, getMall, log, MallState, saveMall } from "../_shared/cafe24.ts";

function ymd(d: Date) { return d.toISOString().slice(0, 10); }

// 주문 목록 페이지네이션 (기간 청킹 + 오프셋). statuses=null 이면 상태 필터 없이 전체 상태.
async function fetchOrders(mallKey: string, mallId: string, token: string, start: Date, end: Date, statuses: string | null) {
  const out: any[] = [];
  // 카페24는 "조회 종료일이 시작일로부터 3개월 내"를 강제 → 짧은 달(2월)에서 89일이면 422.
  // 3개월 최솟값(2/24→5/24 = 89일)보다 짧게 잡아 전 구간 안전하게.
  const CHUNK = 80 * 86400000, LIMIT = 100;
  const statusQ = statuses ? `&order_status=${statuses}` : "";
  for (let ws = start.getTime(); ws <= end.getTime(); ws += CHUNK + 86400000) {
    const we = Math.min(ws + CHUNK, end.getTime());
    for (let offset = 0; ; offset += LIMIT) {
      const res = await cafe24Fetch(mallId, token,
        `/api/v2/admin/orders?start_date=${ymd(new Date(ws))}&end_date=${ymd(new Date(we))}&embed=items,receivers&limit=${LIMIT}&offset=${offset}${statusQ}`)
        .catch((e) => { throw new Error(`[${mallKey}] 주문 조회: ` + e.message); });
      const page = res.orders || [];
      out.push(...page);
      if (page.length < LIMIT) break;
      if (offset > 5000) break; // 안전 상한
    }
  }
  return out;
}

// 주문 상태 지문 — 프론트 _orderState()가 읽는 값(배송상태 + 아이템 클레임코드)만 비교
function stateSig(o: any) {
  const codes = (o.items || []).map((it: any) => String(it.status || it.order_status || "")).sort().join(",");
  return `${o.shipping_status || ""}|${o.order_status || ""}|${codes}`;
}

// 현재 주문 원본이 실제로 점유해야 하는 재고를 옵션별로 합산한다.
// 같은 주문에 동일 옵션이 여러 줄이어도 원장 멱등키는 한 개만 생긴다.
function consumedByVariant(o: any) {
  const out = new Map<string, number>();
  for (const it of (o?.items || [])) {
    const vc = String(it.variant_code || "");
    const qty = Number(it.quantity || 0);
    if (!vc || !qty) continue;
    if (/^[CR]/i.test(String(it.status || it.order_status || ""))) continue;
    out.set(vc, (out.get(vc) || 0) + qty);
  }
  return out;
}

// 상태변경 재동기화: 신규 삽입·재고차감 없이 기존 주문의 상태만 최신화.
//  증분 pull은 최근 2일 + N상태만 보므로, 오래된 주문이 뒤늦게 취소/반품/교환돼도 반영되지 않는다.
//  → 상태 필터 없이 최근 N일을 재조회해 raw/channel_status 를 갱신한다.
async function restatusMall(db: ReturnType<typeof admin>, mall: MallState, opts: { days?: number; from?: string; to?: string } = {}) {
  const token = await ensureToken(db, mall);
  const mallId = mall.cafe24_mall_id!;
  const start = opts.from ? new Date(opts.from) : new Date(Date.now() - (opts.days ?? 60) * 86400000);
  const end = opts.to ? new Date(opts.to) : new Date();

  const orders = await fetchOrders(mall.mall_key, mallId, token, start, end, null);
  if (!orders.length) return { scanned: 0, updated: 0, missing: 0 };

  const { data: listings } = await db.from("channel_listings")
    .select("id, inventory_item_id, channel_variant_code")
    .eq("channel", "cafe24").eq("mall_key", mall.mall_key).not("channel_variant_code", "is", null);
  const listingByVariant = new Map((listings || []).map((l: any) => [String(l.channel_variant_code), l]));

  // 기존 행 로드 (order_id 청크로 나눠 in())
  const ids = orders.map((o: any) => String(o.order_id));
  const existing = new Map<string, { id: string; raw: any; channel_status: string | null }>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from("channel_orders").select("id, order_id, raw, channel_status")
      .eq("mall_key", mall.mall_key).in("order_id", ids.slice(i, i + 200));
    for (const r of (data || [])) existing.set(String(r.order_id), { id: r.id, raw: r.raw, channel_status: r.channel_status });
  }

  let updated = 0, missing = 0;
  const changes: Array<{ order_id: string; from: string; to: string }> = [];
  const missingIds: string[] = [];
  for (const o of orders) {
    const cur = existing.get(String(o.order_id));
    // 미수집 주문 — 삽입은 pull 담당(재고 오차감 방지). 로그로만 남겨 누락을 감지한다.
    if (!cur) { missing++; if (missingIds.length < 50) missingIds.push(`${o.order_id}:${stateSig(o)}`); continue; }
    const before = stateSig(cur.raw || {});
    const after = stateSig(o);
    if (before === after) continue;

    // 늦은 취소/반품/재활성화도 원장에 보상분을 남긴다.
    const oldUse = consumedByVariant(cur.raw || {});
    const newUse = consumedByVariant(o);
    for (const vc of new Set([...oldUse.keys(), ...newUse.keys()])) {
      const delta = (oldUse.get(vc) || 0) - (newUse.get(vc) || 0);
      const listing: any = listingByVariant.get(vc);
      if (!delta || !listing) continue;
      const { error: invErr } = await db.rpc("apply_channel_inventory_adjustment", {
        p_inventory_item_id: listing.inventory_item_id,
        p_listing_id: listing.id,
        p_delta: delta,
        p_reason: "channel_reconcile",
        p_ref: `${mall.mall_key}:${o.order_id}:${vc}:${after}`,
        p_note: `${mall.mall_key} 주문 ${o.order_id} 상태 보정`,
      });
      if (invErr) throw new Error(`[${mall.mall_key}] 재고보정(${o.order_id}/${vc}): ${invErr.message}`);
    }
    const r = (o.receivers && o.receivers[0]) || {};
    const { error } = await db.from("channel_orders").update({
      raw: o,
      channel_status: o.order_status || cur.channel_status,
      // 수취인 정보가 비어 있던 건만 보강(기존 값은 덮지 않음)
      ...(cur.raw?.receivers?.[0] ? {} : {
        receiver_name: r.name || null,
        receiver_phone: r.cellphone || r.phone || null,
        receiver_zipcode: r.zipcode || null,
        receiver_address: [r.address1, r.address2].filter(Boolean).join(" ") || r.address_full || null,
      }),
    }).eq("id", cur.id);
    if (error) throw new Error(`[${mall.mall_key}] 상태갱신(${o.order_id}): ` + error.message);
    updated++;
    if (changes.length < 50) changes.push({ order_id: String(o.order_id), from: before, to: after });
  }

  await log(db, mall.mall_key, "restatus", "ok", {
    range: [ymd(start), ymd(end)], scanned: orders.length, updated, missing, changes, missing_ids: missingIds,
  });
  return { scanned: orders.length, updated, missing };
}

interface SyncOpts { from?: string; to?: string; restatus?: boolean; restatus_days?: number; restatus_from?: string }

async function syncMall(db: ReturnType<typeof admin>, mall: MallState, opts: SyncOpts = {}) {
  const backfill = !!opts.from;
  const summary: Record<string, unknown> = { mall: mall.mall_key, dry_run: mall.dry_run, backfill };
  const token = await ensureToken(db, mall);
  const mallId = mall.cafe24_mall_id!;

  // 매핑 로드: variant_code → { item, pno }  (이 몰 한정)
  const { data: listings } = await db.from("channel_listings")
    .select("id, inventory_item_id, channel_product_no, channel_variant_code, allocated, sold")
    .eq("channel", "cafe24").eq("mall_key", mall.mall_key).not("channel_variant_code", "is", null);
  const byVariant = new Map<string, { item: string; pno: string | null; listingId: string }>();
  for (const l of (listings || [])) byVariant.set(l.channel_variant_code, { item: l.inventory_item_id, pno: l.channel_product_no, listingId: l.id });

  // 조회 범위: 백필(from/to 지정) or 증분(last_synced~now, 없으면 2일)
  const start = opts.from ? new Date(opts.from) : (mall.last_order_synced_at ? new Date(mall.last_order_synced_at) : new Date(Date.now() - 2 * 86400000));
  const end = opts.to ? new Date(opts.to) : new Date();
  // 카페24 주문조회는 한 번에 최대 ~90일 → 청킹 + 오프셋 페이지네이션으로 전체 수집
  //  상태 필터를 걸지 않는다(과거엔 N코드만 요청 → 수집 전에 취소된 주문이 영구 누락됐음).
  //  취소·반품 아이템은 아래 재고 차감 단계에서 제외한다.
  const orderList = await fetchOrders(mall.mall_key, mallId, token, start, end, null);

  // 주문 저장(신규만) + 재고 차감
  let storedOrders = 0, deducted = 0;
  if (orderList.length) {
    const ids = orderList.map((o: any) => String(o.order_id));
    const { data: exist } = await db.from("channel_orders").select("order_id").eq("mall_key", mall.mall_key).in("order_id", ids);
    const seenO = new Set((exist || []).map((e: any) => e.order_id));
    for (const o of orderList) {
      if (seenO.has(String(o.order_id))) continue;
      const r = (o.receivers && o.receivers[0]) || {};
      const { data: inserted, error: oErr } = await db.from("channel_orders").insert([{
        channel: "cafe24", mall_key: mall.mall_key, order_id: String(o.order_id),
        order_date: o.order_date || o.payment_date || null,
        buyer_name: o.buyer_name || o.member_id || null,
        receiver_name: r.name || null, receiver_phone: r.cellphone || r.phone || null,
        receiver_zipcode: r.zipcode || null,
        receiver_address: [r.address1, r.address2].filter(Boolean).join(" ") || r.address_full || null,
        pay_amount: Number(o.payment_amount || o.actual_payment_amount || 0) || null,
        channel_status: o.order_status || null, status: "new", raw: o,
      }]).select("id").single();
      if (oErr) { if (oErr.code === "23505") continue; throw new Error(`[${mall.mall_key}] 주문 저장: ` + oErr.message); }
      const items = (o.items || []).map((it: any) => ({
        channel_order_id: inserted.id, variant_code: it.variant_code || null,
        product_name: it.product_name || null, option_name: it.option_value || null,
        quantity: Number(it.quantity || 1),
        inventory_item_id: it.variant_code && byVariant.has(it.variant_code) ? byVariant.get(it.variant_code)!.item : null,
      }));
      if (items.length) await db.from("channel_order_items").insert(items);
      storedOrders++;
    }

    // 재고 차감(원장, 멱등: ref = mall:order:variant)
    if (byVariant.size > 0) {
      for (const o of orderList) {
        for (const [vc, qty] of consumedByVariant(o)) {
          const mapped = byVariant.get(vc);
          if (!mapped) continue;
          const { data: applied, error } = await db.rpc("apply_channel_inventory_adjustment", {
            p_inventory_item_id: mapped.item,
            p_listing_id: mapped.listingId,
            p_delta: -qty,
            p_reason: "cafe24_order",
            p_ref: `${mall.mall_key}:${o.order_id}:${vc}`,
            p_note: `${mall.mall_key} 주문 ${o.order_id}`,
          });
          if (error) throw new Error(`[${mall.mall_key}] 원장(${o.order_id}/${vc}): ${error.message}`);
          if (applied) deducted++;
        }
      }
    }
  }
  summary.orders_pulled = orderList.length;
  summary.orders_stored = storedOrders;
  summary.deducted = deducted;
  await log(db, mall.mall_key, "pull_orders", "ok", { fetched: orderList.length, stored: storedOrders, deducted });

  // 상태변경 재동기화 (백필 중엔 생략 — 그 자체가 전체 재조회)
  if (opts.restatus !== false && !backfill) {
    summary.restatus = await restatusMall(db, mall, { days: opts.restatus_days, from: opts.restatus_from });
  }

  // 현재고 push (dry_run 이면 로그만)
  const itemIds = [...new Set((listings || []).map((l) => l.inventory_item_id))];
  let pushed = 0; const intended: Array<Record<string, unknown>> = [];
  const skippedNegative: Array<Record<string, unknown>> = [];
  if (itemIds.length) {
    const { data: items } = await db.from("inventory_items").select("id, on_hand").in("id", itemIds);
    const onHand = new Map((items || []).map((i) => [i.id, i.on_hand]));
    for (const l of (listings || [])) {
      if (!l.channel_variant_code || !l.channel_product_no) continue;
      const pool = onHand.get(l.inventory_item_id);
      if (pool == null) continue;
      // 배정량(allocated)이 설정돼 있으면 그걸 push, 아니면 전량(단일채널 = 풀 그대로)
      const qty = (l.allocated && l.allocated > 0) ? Math.min(l.allocated, pool) : pool;
      // 음수 재고는 기초재고 미입력/오차감 신호 → 실판매 스토어에 밀면 안 됨. 건너뛰고 경고만.
      if (qty < 0) {
        skippedNegative.push({ product_no: l.channel_product_no, variant_code: l.channel_variant_code, on_hand: pool });
        continue;
      }
      if (mall.dry_run) { intended.push({ product_no: l.channel_product_no, variant_code: l.channel_variant_code, quantity: qty }); continue; }
      await cafe24Fetch(mallId, token,
        `/api/v2/admin/products/${l.channel_product_no}/variants/${l.channel_variant_code}/inventories`,
        { method: "PUT", body: JSON.stringify({ request: { quantity: qty, use_inventory: "T", safety_inventory: 0 } }) },
      ).catch((e) => { throw new Error(`[${mall.mall_key}] push(${l.channel_variant_code}): ` + e.message); });
      pushed++;
    }
  }
  summary.pushed = pushed;
  if (mall.dry_run) summary.would_push = intended;
  if (skippedNegative.length) summary.skipped_negative = skippedNegative;
  await log(db, mall.mall_key, "push_inventory", skippedNegative.length ? "warn" : (mall.dry_run ? "dry_run" : "ok"),
    { pushed, intended: mall.dry_run ? intended : undefined, skipped_negative: skippedNegative.length ? skippedNegative : undefined });

  if (!backfill) await saveMall(db, mall.mall_key, { last_order_synced_at: end.toISOString() });
  return summary;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });
  const db = admin();
  let body: SyncOpts & { mall?: string; mode?: string } = {};
  try { body = await req.json(); } catch { /* no body */ }

  const malls = body.mall
    ? [await getMall(db, body.mall)].filter((m): m is MallState => !!m && !!m.access_token)
    : await getActiveMalls(db);

  if (!malls.length) {
    return new Response(JSON.stringify({ ok: false, error: "연동된 몰 없음 (cafe24-oauth 먼저)" }),
      { status: 400, headers: cors({ "Content-Type": "application/json" }) });
  }

  const onlyRestatus = body.mode === "restatus";
  const results: unknown[] = [];
  for (const m of malls) {
    try {
      results.push(onlyRestatus
        ? { mall: m.mall_key, restatus: await restatusMall(db, m, { days: body.restatus_days, from: body.restatus_from, to: body.to }) }
        : await syncMall(db, m, {
          from: body.from, to: body.to,
          restatus: body.restatus, restatus_days: body.restatus_days, restatus_from: body.restatus_from,
        }));
    }
    catch (e) { await log(db, m.mall_key, "error", "error", { error: String(e) }); results.push({ mall: m.mall_key, ok: false, error: String(e) }); }
  }
  // 단일 몰 호출이면 평탄화해서 반환(프론트 호환)
  const flat = results.length === 1 && typeof results[0] === "object" ? results[0] as Record<string, unknown> : null;
  return new Response(JSON.stringify({ ok: true, malls: results, ...(flat || {}) }), { headers: cors({ "Content-Type": "application/json" }) });
});
