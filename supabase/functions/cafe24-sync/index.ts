// 카페24 멀티몰 동기화 (스케줄/수동)
//  각 활성 몰에 대해:
//   1) 토큰 갱신  2) 주문 pull → channel_orders 저장 + 재고 차감(원장, 멱등)
//   3) 현재고 → 카페24 push (dry_run 이면 로그만)  4) last_order_synced_at, sync_log
// 호출: POST <func-url>            → 활성 몰 전체
//       POST <func-url> {mall:키}  → 특정 몰만
import { admin, cafe24Fetch, cors, ensureToken, getActiveMalls, getMall, log, MallState, saveMall } from "../_shared/cafe24.ts";

function ymd(d: Date) { return d.toISOString().slice(0, 10); }

async function syncMall(db: ReturnType<typeof admin>, mall: MallState) {
  const summary: Record<string, unknown> = { mall: mall.mall_key, dry_run: mall.dry_run };
  const token = await ensureToken(db, mall);
  const mallId = mall.cafe24_mall_id!;

  // 매핑 로드: variant_code → { item, pno }  (이 몰 한정)
  const { data: listings } = await db.from("channel_listings")
    .select("id, inventory_item_id, channel_product_no, channel_variant_code, allocated, sold")
    .eq("channel", "cafe24").eq("mall_key", mall.mall_key).not("channel_variant_code", "is", null);
  const byVariant = new Map<string, { item: string; pno: string | null }>();
  for (const l of (listings || [])) byVariant.set(l.channel_variant_code, { item: l.inventory_item_id, pno: l.channel_product_no });

  const start = mall.last_order_synced_at ? new Date(mall.last_order_synced_at) : new Date(Date.now() - 2 * 86400000);
  const end = new Date();
  const orders = await cafe24Fetch(mallId, token,
    `/api/v2/admin/orders?start_date=${ymd(start)}&end_date=${ymd(end)}&embed=items,receivers&limit=100&order_status=N00,N10,N20,N21,N22,N30,N40`)
    .catch((e) => { throw new Error(`[${mall.mall_key}] 주문 조회: ` + e.message); });
  const orderList = orders.orders || [];

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
      const rows: Array<{ inventory_item_id: string; delta: number; reason: string; ref: string; note: string }> = [];
      for (const o of orderList) for (const it of (o.items || [])) {
        const vc = it.variant_code; const qty = Number(it.quantity || 0);
        if (!vc || !qty || !byVariant.has(vc)) continue;
        rows.push({ inventory_item_id: byVariant.get(vc)!.item, delta: -qty, reason: "cafe24_order",
          ref: `${mall.mall_key}:${o.order_id}:${vc}`, note: `${mall.mall_key} 주문 ${o.order_id}` });
      }
      if (rows.length) {
        const refs = rows.map((r) => r.ref);
        const { data: ex } = await db.from("inventory_ledger").select("ref").eq("reason", "cafe24_order").in("ref", refs);
        const seen = new Set((ex || []).map((e) => e.ref));
        const fresh = rows.filter((r) => !seen.has(r.ref));
        if (fresh.length) {
          const { error } = await db.from("inventory_ledger").insert(fresh);
          if (error && error.code !== "23505") throw new Error(`[${mall.mall_key}] 원장: ` + error.message);
          deducted = fresh.length;
          // 채널 배정 차감 + 판매 누적 (분배/재분배 기반)
          const byVc: Record<string, number> = {};
          for (const r of fresh) { const vc = r.ref.split(":").pop()!; byVc[vc] = (byVc[vc] || 0) + Math.abs(r.delta); }
          for (const [vc, q] of Object.entries(byVc)) {
            const lst = (listings || []).find((l) => l.channel_variant_code === vc);
            if (lst) {
              await db.from("channel_listings").update({
                allocated: Math.max((lst.allocated || 0) - q, 0),
                sold: (lst.sold || 0) + q,
              }).eq("id", lst.id);
            }
          }
        }
      }
    }
  }
  summary.orders_pulled = orderList.length;
  summary.orders_stored = storedOrders;
  summary.deducted = deducted;
  await log(db, mall.mall_key, "pull_orders", "ok", { fetched: orderList.length, stored: storedOrders, deducted });

  // 현재고 push (dry_run 이면 로그만)
  const itemIds = [...new Set((listings || []).map((l) => l.inventory_item_id))];
  let pushed = 0; const intended: Array<Record<string, unknown>> = [];
  if (itemIds.length) {
    const { data: items } = await db.from("inventory_items").select("id, on_hand").in("id", itemIds);
    const onHand = new Map((items || []).map((i) => [i.id, i.on_hand]));
    for (const l of (listings || [])) {
      if (!l.channel_variant_code || !l.channel_product_no) continue;
      const pool = onHand.get(l.inventory_item_id);
      if (pool == null) continue;
      // 배정량(allocated)이 설정돼 있으면 그걸 push, 아니면 전량(단일채널 = 풀 그대로)
      const qty = (l.allocated && l.allocated > 0) ? Math.min(l.allocated, pool) : pool;
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
  await log(db, mall.mall_key, "push_inventory", mall.dry_run ? "dry_run" : "ok", { pushed, intended: mall.dry_run ? intended : undefined });

  await saveMall(db, mall.mall_key, { last_order_synced_at: end.toISOString() });
  return summary;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });
  const db = admin();
  let body: { mall?: string } = {};
  try { body = await req.json(); } catch { /* no body */ }

  const malls = body.mall
    ? [await getMall(db, body.mall)].filter((m): m is MallState => !!m && !!m.access_token)
    : await getActiveMalls(db);

  if (!malls.length) {
    return new Response(JSON.stringify({ ok: false, error: "연동된 몰 없음 (cafe24-oauth 먼저)" }),
      { status: 400, headers: cors({ "Content-Type": "application/json" }) });
  }

  const results: unknown[] = [];
  for (const m of malls) {
    try { results.push(await syncMall(db, m)); }
    catch (e) { await log(db, m.mall_key, "error", "error", { error: String(e) }); results.push({ mall: m.mall_key, ok: false, error: String(e) }); }
  }
  // 단일 몰 호출이면 평탄화해서 반환(프론트 호환)
  const flat = results.length === 1 && typeof results[0] === "object" ? results[0] as Record<string, unknown> : null;
  return new Response(JSON.stringify({ ok: true, malls: results, ...(flat || {}) }), { headers: cors({ "Content-Type": "application/json" }) });
});
