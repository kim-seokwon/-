// 카페24 배송중/송장 등록 (멀티몰 write-back)
//  입력(POST JSON): { mall: "hiheiho", orders: [{ order_id, courier_code?, courier_name?, invoice_no }] }
//  - dry_run=true : 카페24 전송 없이 channel_orders 만 갱신(흐름 미리보기)
//  - dry_run=false: 카페24에 운송장 등록 → 배송중 → 브하스도 갱신
import { admin, cafe24Fetch, cors, ensureToken, getMall, log } from "../_shared/cafe24.ts";

const COURIER_CODE: Record<string, string> = {
  "CJ대한통운": "0001", "CJ": "0001", "우체국": "0006", "우체국택배": "0006",
  "한진": "0002", "한진택배": "0002", "롯데": "0004", "롯데택배": "0004",
  "로젠": "0005", "로젠택배": "0005",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });
  const db = admin();

  let payload: { mall?: string; orders?: Array<{ order_id: string; courier_code?: string; courier_name?: string; invoice_no: string }> };
  try { payload = await req.json(); } catch { payload = {}; }
  const mallKey = payload.mall;
  const list = payload.orders || [];
  if (!mallKey) return new Response(JSON.stringify({ ok: false, error: "mall 필요" }), { status: 400, headers: cors({ "Content-Type": "application/json" }) });
  if (!list.length) return new Response(JSON.stringify({ ok: false, error: "no_orders" }), { status: 400, headers: cors({ "Content-Type": "application/json" }) });

  const st = await getMall(db, mallKey);
  if (!st || !st.access_token) return new Response(JSON.stringify({ ok: false, error: `[${mallKey}] no_token` }), { status: 400, headers: cors({ "Content-Type": "application/json" }) });

  const results: Array<Record<string, unknown>> = [];
  let token = "";
  if (!st.dry_run) token = await ensureToken(db, st);

  for (const o of list) {
    const courierCode = o.courier_code || (o.courier_name && COURIER_CODE[o.courier_name]) || "0001";
    const courierName = o.courier_name || "";
    try {
      const { data: row } = await db.from("channel_orders").select("id, raw").eq("mall_key", mallKey).eq("order_id", String(o.order_id)).maybeSingle();
      const itemCodes = ((row?.raw?.items) || []).map((it: any) => it.order_item_code).filter(Boolean);

      if (!st.dry_run) {
        await cafe24Fetch(st.cafe24_mall_id!, token, `/api/v2/admin/orders/${o.order_id}/shipments`, {
          method: "POST",
          body: JSON.stringify({ shipment: { tracking_no: o.invoice_no, shipping_company_code: courierCode, status: "shipping", order_item_code: itemCodes } }),
        });
      }
      await db.from("channel_orders").update({
        status: "shipping", courier: courierName || courierCode, invoice_no: o.invoice_no, shipped_at: new Date().toISOString(),
      }).eq("mall_key", mallKey).eq("order_id", String(o.order_id));
      results.push({ order_id: o.order_id, ok: true, dry_run: st.dry_run });
    } catch (e) {
      results.push({ order_id: o.order_id, ok: false, error: String(e) });
    }
  }
  const okCount = results.filter((r) => r.ok).length;
  await log(db, mallKey, "ship_writeback", st.dry_run ? "dry_run" : "ok", { total: list.length, ok: okCount, results });
  return new Response(JSON.stringify({ ok: true, dry_run: st.dry_run, total: list.length, success: okCount, results }), { headers: cors({ "Content-Type": "application/json" }) });
});
