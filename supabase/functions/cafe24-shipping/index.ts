// 카페24 배송중/송장 등록 (멀티몰 write-back)
//  입력(POST JSON): { mall: "hiheiho", orders: [{ order_id, courier_code?, courier_name?, invoice_no }] }
//  - dry_run=true : 카페24 전송 없이 channel_orders 만 갱신(흐름 미리보기)
//  - dry_run=false: 카페24에 운송장 등록 → 배송대기(standby) → 브하스도 갱신
//    (배송대기라 우리 주문은 status 'ready'(송장 있음)로 두고 배송중 탭엔 넣지 않는다. 배송중은 카페24 동기화가 가져온다)
import { admin, cafe24Fetch, cors, ensureToken, getMall, log } from "../_shared/cafe24.ts";
import { requireUser } from "../_shared/auth.ts";
import { courierCodeOf } from "./couriers.ts";
import { EXT_TIMEOUT_MS, registerOne } from "./register.ts";
import type { Mode } from "../_shared/ship-unknown.ts";


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });
  // 카페24 운송장 등록 = 고객 주문에 송장이 붙는 외부 쓰기 → 로그인 사용자만
  const auth = await requireUser(req, { roles: ["MASTER", "STAFF"] });
  if (auth instanceof Response) return auth;
  const db = admin();

  let payload: { mall?: string; mode?: string; orders?: Array<{ order_id: string; courier_code?: string; courier_name?: string; invoice_no: string }> };
  try { payload = await req.json(); } catch { payload = {}; }
  const mallKey = payload.mall;
  const list = payload.orders || [];
  // run: 등록 / confirm: 확인필요 건 [접수 확인](GET 만) / retry: 확인 결과 없음인 건 [다시 시도]
  const mode: Mode = payload.mode === "confirm" || payload.mode === "retry" ? payload.mode : "run";
  if (!mallKey) return new Response(JSON.stringify({ ok: false, error: "mall 필요" }), { status: 400, headers: cors({ "Content-Type": "application/json" }) });
  if (!list.length) return new Response(JSON.stringify({ ok: false, error: "no_orders" }), { status: 400, headers: cors({ "Content-Type": "application/json" }) });

  const st = await getMall(db, mallKey);
  if (!st || !st.access_token) return new Response(JSON.stringify({ ok: false, error: `[${mallKey}] no_token` }), { status: 400, headers: cors({ "Content-Type": "application/json" }) });

  const results: Array<Record<string, unknown>> = [];
  let token = "";
  if (!st.dry_run) token = await ensureToken(db, st);

  for (const o of list) {
    const courierCode = courierCodeOf(o.courier_name, o.courier_code);
    const courierName = o.courier_name || "";
    try {
      if (!courierCode) throw new Error(`지원하지 않는 택배사: ${courierName || "미지정"}`);
      if (!/^\d{8,20}$/.test(String(o.invoice_no || ""))) throw new Error("운송장번호 형식 오류");
      const { data: row } = await db.from("channel_orders").select("id, raw").eq("mall_key", mallKey).eq("order_id", String(o.order_id)).maybeSingle();
      if (!row) throw new Error("BHAS 주문을 찾을 수 없음");
      const itemCodes = ((row?.raw?.items) || []).map((it: any) => it.order_item_code).filter(Boolean);

      if (st.dry_run) {   // 미리보기: 카페24 전송·DB 쓰기 없음. 성공 집계에 넣지 않는다
        results.push({ order_id: o.order_id, ok: false, dry_run: true, preview: true, error: "dry-run 몰 — 카페24 미전송" });
        continue;
      }

      const oid = String(o.order_id);
      // 내 시도(attempt)가 아직 registering 을 쥐고 있을 때만 바꾼다. 오래된 시도는 덮어쓰지 못한다
      const fenced = async (attempt: number, patch: Record<string, unknown>, cutoff?: string) => {
        let q = db.from("shipment_jobs").update({ ...patch, updated_at: new Date().toISOString() })
          .eq("mall_key", mallKey).eq("order_id", oid).eq("attempts", attempt).eq("status", "registering");
        if (cutoff) q = q.lt("updated_at", cutoff);
        const { data, error } = await q.select("id");
        if (error) throw error;
        return (data?.length ?? 0) > 0;
      };
      const r = await registerOne({
        now: () => Date.now(),
        getJob: async () => {
          const { data, error } = await db.from("shipment_jobs").select("status,invoice_no,attempts,last_error,updated_at,registered_at")
            .eq("mall_key", mallKey).eq("order_id", oid).maybeSingle();
          if (error) throw error;
          return data;
        },
        claim: async () => {
          const { data, error } = await db.rpc("claim_shipment_registration", {
            p_mall_key: mallKey, p_order_id: oid, p_invoice_no: String(o.invoice_no),
            p_courier: courierName || courierCode, p_actor: auth.id,
          });
          if (error) throw error;
          return String(data);
        },
        releaseStale: (cutoff, attempt, message) => fenced(attempt, { status: "failed", last_error: message }, cutoff),
        listShipments: async () => {
          const res = await cafe24Fetch(st.cafe24_mall_id!, token, `/api/v2/admin/orders/${oid}/shipments`, { signal: AbortSignal.timeout(EXT_TIMEOUT_MS) });
          return Array.isArray(res?.shipments) ? res.shipments : [];
        },
        postShipment: async (body) => {
          await cafe24Fetch(st.cafe24_mall_id!, token, `/api/v2/admin/orders/${oid}/shipments`, { method: "POST", body: JSON.stringify(body), signal: AbortSignal.timeout(EXT_TIMEOUT_MS) });
        },
        markRegistered: (at, attempt) => fenced(attempt, { status: "registered", registered_at: at }),
        markFailed: (message, attempt) => fenced(attempt, { status: "failed", last_error: message }),
        // 배송대기: 송장만 붙이고 배송중(shipping)·출고일은 넣지 않는다
        updateOrder: async () => {
          const { error } = await db.from("channel_orders").update({
            status: "ready", courier: courierName || courierCode, invoice_no: o.invoice_no,
          }).eq("id", row.id);
          if (error) throw error;
        },
      }, String(o.invoice_no), courierCode, itemCodes, mode);
      results.push({ order_id: o.order_id, ...r, dry_run: false });
    } catch (e) {
      // 선점한 시도의 실패 처리는 registerOne 안에서 attempt 조건부로 끝냈다
      results.push({ order_id: o.order_id, ok: false, error: String(e) });
    }
  }
  const okCount = results.filter((r) => r.ok && !r.dry_run).length;
  const previewCount = results.filter((r) => r.dry_run).length;
  await log(db, mallKey, "ship_writeback", st.dry_run ? "dry_run" : "ok", { total: list.length, ok: okCount, results });
  const allOk = !st.dry_run && okCount === list.length;
  return new Response(JSON.stringify({ ok: allOk, partial: okCount > 0 && !allOk, dry_run: st.dry_run, total: list.length, success: okCount, preview: previewCount, results }), {
    // 업무 결과(확인필요·없음 확인·부분 실패)는 200 + ok:false. 4xx/5xx 는 인증·입력·서버 장애만.
    // (supabase-js invoke 는 비-2xx 면 본문을 data 로 주지 않아 화면이 checkedNone 을 못 읽는다)
    status: 200, headers: cors({ "Content-Type": "application/json" }),
  });
});
