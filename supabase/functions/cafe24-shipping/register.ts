// 카페24 운송장 등록 1건 — 외부 호출·DB는 주입받는다(테스트에서 가짜로 갈아끼움).
//  - 본문 형식(카페24 공식, POST /api/v2/admin/orders/{order_id}/shipments):
//      { shop_no: 1, request: { tracking_no, shipping_company_code, status, order_item_code } }
//    status 는 "standby"(배송대기). 배송중은 택배사 집하 뒤의 일이라 여기서 넣지 않는다(사장님 10-15).
//  - POST 전에 항상 GET shipments 로 같은 송장이 이미 붙었는지 본다.
//    송장·택배사·상태·품주가 모두 맞으면 POST 없이 registered 로 복구, 일부만 맞으면 수동 확인으로 멈춘다.
//  - 잠금(lease)·attempt 규칙은 courier-issue/issue.ts 와 같다:
//    외부 호출은 EXT_TIMEOUT_MS 로 끊고, lease 가 그보다 적게 남으면 새로 호출하지 않으며,
//    저장·실패 처리·잠금 해제는 "attempts = 내 attempt" 조건부로만 한다.
//  - 타임아웃은 자동 재시도하지 않는다(팀장 결정 10-15). POST 를 보낸 뒤 응답을 못 받거나 registering 이 고착되면
//    확인필요(_shared/ship-unknown.ts)로 두고, 사람이 [접수 확인](GET 만)→(없을 때만)[다시 시도].

import { CONFIRM_WAIT_MS, gate, type Mode, UNKNOWN, UNKNOWN_NONE, unknownState } from "../_shared/ship-unknown.ts";

export const EXT_TIMEOUT_MS = 30 * 1000;
export const STALE_MS = 5 * 60 * 1000; // registering 이 이보다 오래 멈춰 있으면 고착으로 본다(= lease 길이)
export const SHIP_STATUS = "standby";   // 배송대기

export function shipmentRequestBody(trackingNo: string, courierCode: string, itemCodes: string[], shopNo = 1) {
  const request: Record<string, unknown> = { tracking_no: trackingNo, shipping_company_code: courierCode, status: SHIP_STATUS };
  if (itemCodes.length) request.order_item_code = itemCodes;
  return { shop_no: shopNo, request };
}

export type Shipment = {
  tracking_no?: string | null;
  shipping_company_code?: string | null;
  status?: string | null;
  items?: Array<{ order_item_code?: string | null; status?: string | null }> | null;
};
export type RegJob = { status: string; invoice_no?: string | null; attempts?: number; last_error?: string | null; updated_at?: string; registered_at?: string | null } | null;

export interface RegisterDeps {
  now(): number;
  getJob(): Promise<RegJob>;
  claim(): Promise<string>;                                         // claim_shipment_registration: claimed/invoice_conflict/registered/busy (attempts +1)
  releaseStale(cutoffIso: string, attempt: number, message: string): Promise<boolean>; // registering·attempts=attempt·updated_at < cutoff → failed(last_error=message)
  listShipments(): Promise<Shipment[]>;
  postShipment(body: ReturnType<typeof shipmentRequestBody>): Promise<void>;
  markRegistered(at: string, attempt: number): Promise<boolean>;     // registering·attempts=attempt 일 때만
  markFailed(message: string, attempt: number): Promise<boolean>;    // 〃
  updateOrder(): Promise<void>;
}

export type RegisterResult = { ok: boolean; idempotent?: boolean; recovered?: boolean; manual?: boolean; unknown?: boolean; checkedNone?: boolean; error?: string };

const digits = (v?: string | null) => String(v || "").replace(/\D/g, "");
const sameNo = (a?: string | null, b?: string | null) => digits(a) !== "" && digits(a) === digits(b);
// 배송대기로 넣은 뒤 택배사가 이미 배송중·완료로 바꿨을 수도 있다 → 그 뒤 단계도 "붙어 있음"으로 본다
const ATTACHED = new Set(["standby", "shipping", "shipped"]);

// 카페24에 이미 붙은 송장 판정: none(없음) / full(전부 맞음) / partial(일부만 — 수동 확인)
export function matchShipments(list: Shipment[], invoiceNo: string, courierCode: string, itemCodes: string[]): { kind: "none" | "full" | "partial"; why?: string } {
  const mine = list.filter((s) => sameNo(s.tracking_no, invoiceNo));
  if (!mine.length) return { kind: "none" };
  // 택배사 코드가 없거나(null·누락) 다르면 일치로 보지 않는다
  const bad = mine.find((s) => s.shipping_company_code !== courierCode);
  if (bad) return { kind: "partial", why: `택배사 코드 ${bad.shipping_company_code ? `다름(${bad.shipping_company_code})` : "없음"}` };
  const items = mine.flatMap((s) => (s.items || []).map((it) => ({ code: it.order_item_code || "", status: it.status || s.status || "" })));
  const stOk = (st: string) => ATTACHED.has(st);
  if (!itemCodes.length) {
    const st = items.length ? items.map((i) => i.status) : mine.map((s) => s.status || "");
    return st.every(stOk) ? { kind: "full" } : { kind: "partial", why: `상태 ${st.join(",")}` };
  }
  const missing = itemCodes.filter((c) => !items.some((i) => i.code === c && stOk(i.status)));
  return missing.length ? { kind: "partial", why: `품주 ${missing.join(",")} 미등록/상태불일치` } : { kind: "full" };
}

export async function registerOne(d: RegisterDeps, invoiceNo: string, courierCode: string, itemCodes: string[], mode: Mode = "run"): Promise<RegisterResult> {
  const job = await d.getJob();
  if (job?.invoice_no && job.invoice_no !== invoiceNo) return { ok: false, error: `이미 다른 송장 발급됨: ${job.invoice_no}` };
  if (job?.status === "registered") {
    await d.updateOrder();
    return { ok: true, idempotent: true };
  }
  const prev = unknownState(job);
  const blocked = gate(mode, prev, "카페24 관리자 주문상세");
  if (blocked) return { ok: blocked.ok, unknown: blocked.unknown, checkedNone: blocked.checkedNone, error: blocked.message };
  if (mode === "confirm") {   // 카페24 반영이 늦을 수 있다 — 확인필요가 된 지 CONFIRM_WAIT_MS 전엔 조회하지 않는다
    const since = job?.updated_at ? d.now() - new Date(job.updated_at).getTime() : Infinity;
    if (since < CONFIRM_WAIT_MS) return { ok: false, unknown: true, error: `반영 대기 — ${Math.ceil((CONFIRM_WAIT_MS - since) / 60000)}분 뒤 [접수 확인]` };
  }

  const start = d.now();
  const claim = await d.claim();
  if (claim === "busy") {
    const cur = await d.getJob();
    const age = cur?.updated_at ? d.now() - new Date(cur.updated_at).getTime() : 0;
    if (cur?.status !== "registering" || age < STALE_MS) return { ok: false, error: "동일 주문의 배송 등록이 이미 진행 중" };
    // lease 가 끝난 registering(함수가 죽음): POST 가 갔는지 모른다 → 확인필요. 다시 POST 하지 않는다
    const msg = `${UNKNOWN}registering 고착 — 카페24 등록 여부 확인 필요`;
    if (!(await d.releaseStale(new Date(d.now() - STALE_MS).toISOString(), cur.attempts ?? 0, msg))) {
      return { ok: false, error: "동일 주문의 배송 등록이 이미 진행 중" };
    }
    return { ok: false, unknown: true, error: msg.slice(UNKNOWN.length) };
  }
  if (claim === "invoice_conflict") return { ok: false, error: "이미 다른 송장이 발급됨" };
  if (claim === "registered") {
    await d.updateOrder();
    return { ok: true, idempotent: true };
  }
  if (claim !== "claimed") return { ok: false, error: `배송 등록 선점 실패: ${claim || "unknown"}` };

  const attempt = (await d.getJob())?.attempts ?? 0;
  const leaseEnd = start + STALE_MS;
  const guard = () => {
    if (d.now() + EXT_TIMEOUT_MS > leaseEnd) throw new Error("잠금 시간 부족 — 카페24 호출 안 함, 다시 시도");
  };

  let sent = false;   // POST 를 보냈나 — 보낸 뒤의 오류는 등록됐을 수도 있다
  try {
    guard();
    const m = matchShipments(await d.listShipments(), invoiceNo, courierCode, itemCodes);
    if (m.kind === "partial") {
      const msg = `카페24에 송장 일부만 등록됨(${m.why}) — 수동 확인`;
      await d.markFailed(msg, attempt);
      return { ok: false, manual: true, error: msg };
    }
    if (m.kind === "none") {
      if (mode === "confirm") {
        await d.markFailed(`${UNKNOWN_NONE}카페24 조회 결과 없음 — [다시 시도] 가능`, attempt);
        return { ok: false, unknown: true, checkedNone: true, error: "카페24에 등록 없음 확인 — [다시 시도] 가능" };
      }
      guard();
      sent = true;
      await d.postShipment(shipmentRequestBody(invoiceNo, courierCode, itemCodes));
    }
    if (!(await d.markRegistered(new Date(d.now()).toISOString(), attempt))) {
      const cur = await d.getJob();
      if (cur?.status === "registered" && cur.invoice_no === invoiceNo) return { ok: true, idempotent: true }; // 다른 시도가 같은 송장으로 마침
      return { ok: false, manual: true, error: "카페24 등록 뒤 잠금을 잃어 저장 못함 — 수동 확인" };
    }
    await d.updateOrder();
    return m.kind === "full" ? { ok: true, recovered: true } : { ok: true };
  } catch (e) {
    if (!sent) {
      // 선점 RPC 가 last_error 를 지웠다 — 확인필요였던 건은 표식을 되살려 일반 재실행을 계속 막는다
      const keep = prev === "none" ? UNKNOWN_NONE : prev ? UNKNOWN : "";
      await d.markFailed(keep + String(e), attempt).catch(() => false);
      throw e;
    }
    // POST 를 보낸 뒤 오류(타임아웃·네트워크·저장 실패): 자동 재시도 안 함 → 확인필요
    const msg = `카페24 응답 확인 못함(${String(e)}) — 카페24 관리자에서 등록 여부 확인 필요`;
    await d.markFailed(UNKNOWN + msg, attempt).catch(() => false);
    return { ok: false, unknown: true, error: msg };
  }
}
