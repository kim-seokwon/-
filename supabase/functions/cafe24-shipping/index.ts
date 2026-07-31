// 카페24 배송중/송장 등록 (멀티몰 write-back)
//  입력(POST JSON): { mall: "hiheiho", orders: [{ order_id, courier_code?, courier_name?, invoice_no }] }
//  - dry_run=true : 카페24 전송 없이 channel_orders 만 갱신(흐름 미리보기)
//  - dry_run=false: 카페24에 운송장 등록 → 배송중 → 브하스도 갱신
import { admin, cafe24Fetch, cors, ensureToken, getMall, log } from "../_shared/cafe24.ts";
import { requireUser } from "../_shared/auth.ts";

const COURIER_CODE: Record<string, string> = {
  "CJ대한통운": "0001", "CJ": "0001", "우체국": "0006", "우체국택배": "0006",
  "한진": "0002", "한진택배": "0002", "롯데": "0004", "롯데택배": "0004",
  "로젠": "0005", "로젠택배": "0005",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });
  // 카페24 운송장 등록 = 고객에게 배송중 알림이 나가는 외부 쓰기 → 로그인 사용자만
  const auth = await requireUser(req, { roles: ["MASTER", "STAFF"] });
  if (auth instanceof Response) return auth;
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
    const courierCode = o.courier_code || (o.courier_name && COURIER_CODE[o.courier_name]);
    const courierName = o.courier_name || "";
    try {
      if (!courierCode) throw new Error(`지원하지 않는 택배사: ${courierName || "미지정"}`);
      if (!/^\d{8,20}$/.test(String(o.invoice_no || ""))) throw new Error("운송장번호 형식 오류");
      const { data: row } = await db.from("channel_orders").select("id, raw").eq("mall_key", mallKey).eq("order_id", String(o.order_id)).maybeSingle();
      if (!row) throw new Error("BHAS 주문을 찾을 수 없음");
      const itemCodes = ((row?.raw?.items) || []).map((it: any) => it.order_item_code).filter(Boolean);

      const { data: existingJob } = await db.from("shipment_jobs").select("*")
        .eq("mall_key", mallKey).eq("order_id", String(o.order_id)).maybeSingle();
      if (existingJob?.invoice_no && existingJob.invoice_no !== o.invoice_no) {
        throw new Error(`이미 다른 송장 발급됨: ${existingJob.invoice_no}`);
      }

      if (st.dry_run) {
        results.push({ order_id: o.order_id, ok: true, dry_run: true, preview: true });
        continue;
      }

      if (existingJob?.status === "registered") {
        const { error: repairErr } = await db.from("channel_orders").update({
          status: "shipping", courier: courierName || courierCode,
          invoice_no: existingJob.invoice_no, shipped_at: existingJob.registered_at || new Date().toISOString(),
        }).eq("id", row.id);
        if (repairErr) throw repairErr;
        results.push({ order_id: o.order_id, ok: true, idempotent: true });
        continue;
      }

      const { data: claim, error: claimErr } = await db.rpc("claim_shipment_registration", {
        p_mall_key: mallKey,
        p_order_id: String(o.order_id),
        p_invoice_no: String(o.invoice_no),
        p_courier: courierName || courierCode,
        p_actor: auth.id,
      });
      if (claimErr) throw claimErr;
      if (claim === "invoice_conflict") throw new Error("이미 다른 송장이 발급됨");
      if (claim === "busy") throw new Error("동일 주문의 배송 등록이 이미 진행 중");
      if (claim === "registered") {
        const { error: repairErr } = await db.from("channel_orders").update({
          status: "shipping", courier: courierName || courierCode,
          invoice_no: o.invoice_no, shipped_at: existingJob?.registered_at || new Date().toISOString(),
        }).eq("id", row.id);
        if (repairErr) throw repairErr;
        results.push({ order_id: o.order_id, ok: true, idempotent: true });
        continue;
      }
      if (claim !== "claimed") throw new Error(`배송 등록 선점 실패: ${claim || "unknown"}`);

      await cafe24Fetch(st.cafe24_mall_id!, token, `/api/v2/admin/orders/${o.order_id}/shipments`, {
        method: "POST",
        body: JSON.stringify({ shipment: { tracking_no: o.invoice_no, shipping_company_code: courierCode, status: "shipping", order_item_code: itemCodes } }),
      });
      const registeredAt = new Date().toISOString();
      await db.from("shipment_jobs").update({ status: "registered", registered_at: registeredAt, updated_at: registeredAt })
        .eq("mall_key", mallKey).eq("order_id", String(o.order_id));
      const { error: orderErr } = await db.from("channel_orders").update({
        status: "shipping", courier: courierName || courierCode, invoice_no: o.invoice_no, shipped_at: new Date().toISOString(),
      }).eq("mall_key", mallKey).eq("order_id", String(o.order_id));
      if (orderErr) throw orderErr;
      results.push({ order_id: o.order_id, ok: true, dry_run: false });
    } catch (e) {
      await db.from("shipment_jobs").update({ status: "failed", last_error: String(e), updated_at: new Date().toISOString() })
        .eq("mall_key", mallKey).eq("order_id", String(o.order_id)).neq("status", "registered");
      results.push({ order_id: o.order_id, ok: false, error: String(e) });
    }
  }
  const okCount = results.filter((r) => r.ok).length;
  await log(db, mallKey, "ship_writeback", st.dry_run ? "dry_run" : "ok", { total: list.length, ok: okCount, results });
  const allOk = okCount === list.length;
  return new Response(JSON.stringify({ ok: allOk, partial: okCount > 0 && !allOk, dry_run: st.dry_run, total: list.length, success: okCount, results }), {
    status: allOk ? 200 : (okCount ? 207 : 422), headers: cors({ "Content-Type": "application/json" }),
  });
});
