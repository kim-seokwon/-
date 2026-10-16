// ============================================================
//  우체국 계약소포 OpenAPI — 송장 자동발번 (courier-issue)
//  흐름: 주문정보 → SEED128(ECB,UTF-8) 암호화 → InsertOrder → 운송장번호(regiNo)
//  규격: supabase/functions/_epost_ref/우체국_계약소포_OpenAPI_매뉴얼_2023.12.pdf
//
//  자격증명(Supabase secrets — 절대 코드/깃에 넣지 말 것):
//    supabase secrets set EPOST_REGKEY=... EPOST_SECKEY=... \
//                         EPOST_CUSTNO=... EPOST_APPRNO=... EPOST_OFFICESER=...
//    EPOST_REGKEY  : 오픈API 인증키(30자리)
//    EPOST_SECKEY  : 접수용 보안키(SEED128 암호화 키)
//    EPOST_CUSTNO  : 고객번호   EPOST_APPRNO : 계약승인번호   EPOST_OFFICESER : 공급지코드
// ============================================================
import { seedEncryptEcbHex } from "./seed128.ts";
import { checkOrder, orderFields, plain } from "./fields.ts";
import { epostOrderNo, EXT_TIMEOUT_MS, issueOne, type ResInfo } from "./issue.ts";
import type { Mode } from "../_shared/ship-unknown.ts";
import { requireUser } from "../_shared/auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BASE = "http://ship.epost.go.kr";
const REGKEY = Deno.env.get("EPOST_REGKEY") ?? "";
const SECKEY = Deno.env.get("EPOST_SECKEY") ?? "";
const CUSTNO = Deno.env.get("EPOST_CUSTNO") ?? "";
const APPRNO = Deno.env.get("EPOST_APPRNO") ?? "";
const OFFICESER = Deno.env.get("EPOST_OFFICESER") ?? "";

const cors = (extra: Record<string, string> = {}) => ({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  ...extra,
});

// 우체국 API 호출: 평문 → SEED128 암호화 → GET → XML 텍스트
async function epostCall(msgName: string, fields: Record<string, unknown>, option?: string): Promise<string> {
  const regData = seedEncryptEcbHex(SECKEY, plain(fields));
  const qs = `key=${encodeURIComponent(REGKEY)}&regData=${encodeURIComponent(regData)}` + (option ? `&option=${option}` : "");
  const res = await fetch(`${BASE}/${msgName}?${qs}`, {
    headers: { "Connection": "keep-alive", "Host": "biz.epost.go.kr", "User-Agent": "brhas/1.0" },
    signal: AbortSignal.timeout(EXT_TIMEOUT_MS),   // 응답이 늦어도 잠금(lease) 안에서 반드시 끝나게
  });
  return await res.text();
}

// XML에서 단일 필드 추출 (CDATA 포함)
function xf(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}>\\s*(?:<!\\[CDATA\\[)?\\s*([\\s\\S]*?)\\s*(?:\\]\\]>)?\\s*</${tag}>`));
  return m ? m[1].trim() : null;
}
function xerr(xml: string): { code: string; message: string } | null {
  const code = xf(xml, "error_code");
  return code ? { code, message: xf(xml, "message") ?? "" } : null;
}

// ── 소포신청(발번) : 주문 1건 → 운송장번호 ──────────────────
async function insertOrder(o: Record<string, unknown>, testYn = "N") {
  const fields = orderFields(o, { custNo: CUSTNO, apprNo: APPRNO, officeSer: OFFICESER }, testYn);
  const xml = await epostCall("api.InsertOrder.jparcel", fields);
  const err = xerr(xml);
  if (err) return { ok: false, orderNo: o.orderNo, ...err };
  return {
    ok: true,
    orderNo: xf(xml, "orderNo") ?? o.orderNo,
    regiNo: xf(xml, "regiNo"),        // 운송장번호(등기번호) ★
    reqNo: xf(xml, "reqNo"),          // 소포주문번호
    price: xf(xml, "price"),          // 예상 접수요금
    delivPoNm: xf(xml, "delivPoNm"),  // 배달우체국
    refineAddr: xf(xml, "refineAddr"),
  };
}

// ── 소포신청 확인 : 우체국 orderNo + 신청일자 → 이미 접수된 운송장 ─────
async function getResInfo(orderNo: string, reqYmd: string): Promise<{ found: ResInfo[] } | { code: string; message: string }> {
  const xml = await epostCall("api.GetResInfo.jparcel", { custNo: CUSTNO, reqType: "1", orderNo, reqYmd });
  const err = xerr(xml);
  if (err) return err;
  const blocks = xml.match(/<resInfo>[\s\S]*?<\/resInfo>/g) ?? [xml];
  return { found: blocks.map((b) => ({ regiNo: xf(b, "regiNo"), reqNo: xf(b, "reqNo"), treatStusCd: xf(b, "treatStusCd") })) };
}

// ── 셋업용: 고객번호/승인번호/공급지등록 ─────────────────────
async function getCustNo(memberID: string) {
  const xml = await epostCall("api.GetCustNo.jparcel", { memberID });
  return xerr(xml) ?? { custNo: xf(xml, "custNo") };
}
async function getApprNo() {
  const xml = await epostCall("api.GetApprNo.jparcel", { custNo: CUSTNO });
  return xerr(xml) ?? { apprNo: xf(xml, "apprNo"), payTypeNm: xf(xml, "payTypeNm"), postNm: xf(xml, "postNm") };
}
// 등록된 공급지 조회 → 첫 공급지의 officeSer 등 리턴
async function getOfficeInfo() {
  const xml = await epostCall("api.GetOfficeInfo.jparcel", { custNo: CUSTNO });
  const err = xerr(xml);
  if (err) return err;
  return {
    officeSer: xf(xml, "officeSer"), officeNm: xf(xml, "officeNm"),
    officeZip: xf(xml, "officeZip"), officeAddr: xf(xml, "officeAddr"),
    officeTelno: xf(xml, "officeTelno"), contactNm: xf(xml, "contactNm"),
    officeDivCd: xf(xml, "officeDivCd"), raw: xml.slice(0, 1500),
  };
}
async function insertOffice(office: Record<string, unknown>) {
  const fields = {
    custNo: CUSTNO,
    officeSer: office.officeSer,      // 공급지 코드(예: 06)
    officeNm: office.officeNm,        // 공급지명
    officeZip: office.officeZip,
    officeAddr1: office.officeAddr1,
    officeAddr2: office.officeAddr2,
    officeTelno: office.officeTelno,
    contactNm: office.contactNm,      // 담당자명
    officeDivCd: office.officeDivCd ?? "1", // 1:발송지=회수도착지 동일
  };
  const xml = await epostCall("api.InsertOffice.jparcel", fields);
  const err = xerr(xml);
  if (err) return err;
  return { chkResult: xf(xml, "chkResult"), officeSer: xf(xml, "officeSer"), regiPoNm: xf(xml, "regiPoNm") };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });
  const j = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: cors({ "Content-Type": "application/json" }) });
  // 송장 발번·공급지 조회는 계약/수취인 정보와 요금에 영향을 준다.
  // 운영 전환 전에는 마스터 계정만 접근하도록 잠근다.
  const auth = await requireUser(req, { master: true });
  if (auth instanceof Response) return auth;
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  if (!REGKEY || !SECKEY) return j({ ok: false, error: "EPOST_REGKEY/EPOST_SECKEY 시크릿 미설정" }, 500);
  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action ?? "issue";
    if (action === "cust-no") return j(await getCustNo(body.memberID));
    if (action === "appr-no") return j(await getApprNo());
    if (action === "get-office") return j(await getOfficeInfo());
    if (action === "setup-office") return j(await insertOffice(body.office ?? {}));
    // 안전한 종단간 점검: 우체국 등록 공급지를 발송/수취지로 사용하고 testYn=Y로만 호출한다.
    // 실제 접수·집하·요금·shipment_jobs 저장·쇼핑몰 송장등록은 절대 수행하지 않는다.
    if (action === "safe-test") {
      const office = await getOfficeInfo();
      if ("code" in office) return j({ ok: false, error: office.message || office.code });
      if (!office.officeZip || !office.officeAddr) return j({ ok: false, error: "우체국 공급지 주소/우편번호를 찾을 수 없습니다" });
      const testOrderNo = `BHAS-TEST-${Date.now()}`;
      const phone = String(office.officeTelno || "01000000000").replace(/\D/g, "") || "01000000000";
      const result = await insertOrder({
        orderNo: testOrderNo,
        ordCompNm: "BHAS API TEST",
        inqTelCn: phone,
        ordNm: office.contactNm || "BHAS 테스트",
        ordZip: office.officeZip,
        ordAddr1: office.officeAddr,
        ordAddr2: "테스트 접수",
        ordTel: phone,
        recNm: office.contactNm || "BHAS 테스트",
        recZip: office.officeZip,
        recAddr1: office.officeAddr,
        recAddr2: "테스트 접수",
        recTel: phone,
        goodsNm: "의류 API 테스트",
        qty: 1,
        weight: 1,
        volume: 60,
        printYn: "N",
      }, "Y");
      const failureMessage = "message" in result ? result.message : "테스트 실패";
      await db.from("operation_audit").insert({
        actor_id: auth.id, actor_email: auth.email, action: "epost.safe_test",
        entity_type: "epost", entity_id: testOrderNo,
        result: result.ok ? "ok" : "failed",
        detail: { testYn: "Y", message: result.ok ? "test response received" : failureMessage },
      });
      return j({
        ok: result.ok,
        test: true,
        orderNo: testOrderNo,
        responseReceived: Boolean(result.regiNo || result.reqNo),
        message: result.ok ? "우체국 테스트 접수 응답 정상" : failureMessage,
      }, result.ok ? 200 : 400);
    }
    // 기본: 발번(여러 주문 일괄). body.test=true 면 testYn=Y
    const testYn = body.test ? "Y" : "N";
    const orders = Array.isArray(body.orders) ? body.orders.slice(0, 200) : [];
    // run: 발번 / confirm: 확인필요 건 [접수 확인](GetResInfo 만) / retry: 확인 결과 없음인 건 [다시 시도]
    const mode: Mode = body.mode === "confirm" || body.mode === "retry" ? body.mode : "run";
    if (body.test && mode !== "run") return j({ ok: false, error: "test 는 run 만" }, 400);
    const results = [];
    for (const o of orders) {
      const mallKey = String(o.mallKey || "");
      const orderNo = String(o.orderNo || "");
      if (!mallKey || !orderNo) { results.push({ ok: false, orderNo, message: "mallKey/orderNo 필요" }); continue; }
      if (mode === "run") {   // 발송 전 검사 — 걸리면 우체국·DB 를 건드리지 않는다
        let bad: string[];
        try { bad = checkOrder(orderFields({ ...o, orderNo: epostOrderNo(mallKey, orderNo) }, { custNo: CUSTNO, apprNo: APPRNO, officeSer: OFFICESER }, testYn)); }
        catch (e) { bad = [String(e)]; }   // 우체국 주문번호 50자 초과 — 한 건 때문에 묶음 전체가 멈추지 않게
        if (bad.length) { results.push({ ok: false, mallKey, orderNo, message: `보내기 전 확인: ${bad.join(" · ")}` }); continue; }
      }
      if (body.test) {   // testYn=Y: DB·재시도 복구 없이 우체국 응답만 본다
        const issued = await insertOrder({ ...o, orderNo: epostOrderNo(mallKey, orderNo) }, testYn);
        results.push({ ...issued, mallKey, orderNo });
        continue;
      }
      const job = () => db.from("shipment_jobs").select("status,invoice_no,attempts,last_error,created_at,updated_at")
        .eq("mall_key", mallKey).eq("order_id", orderNo);
      // 내 시도(attempt)가 아직 잠금을 쥐고 있을 때만 바꾼다. 오래된 시도는 덮어쓰지 못한다
      const fenced = async (attempt: number, patch: Record<string, unknown>, cutoff?: string) => {
        let q = db.from("shipment_jobs").update({ ...patch, updated_at: new Date().toISOString() })
          .eq("mall_key", mallKey).eq("order_id", orderNo).eq("attempts", attempt).eq("status", "pending").is("invoice_no", null);
        if (cutoff) q = q.lt("updated_at", cutoff);
        const { data, error } = await q.select("id");
        if (error) throw error;
        return (data?.length ?? 0) > 0;
      };
      try {
        const r = await issueOne({
          now: () => Date.now(),
          getJob: async () => {
            const { data, error } = await job().maybeSingle();
            if (error) throw error;
            return data;
          },
          claim: async () => {
            const { data, error } = await db.rpc("claim_shipment_job", { p_mall_key: mallKey, p_order_id: orderNo, p_courier: "우체국택배", p_actor: auth.id });
            if (error) throw error;
            return !!data;
          },
          releaseStale: (cutoff, attempt, message) => fenced(attempt, { status: "failed", last_error: message }, cutoff),
          setProviderOrderNo: (no, attempt) => fenced(attempt, { provider_request_id: no }),
          getResInfo,
          insertOrder: (no) => insertOrder({ ...o, orderNo: no }, testYn),
          saveIssued: (regiNo, no, attempt) => fenced(attempt, { invoice_no: regiNo, provider_request_id: no, status: "issued", issued_at: new Date().toISOString() }),
          saveFailed: (message, attempt) => fenced(attempt, { status: "failed", last_error: message }),
        }, mallKey, orderNo, mode);
        results.push({ ...r, mallKey, orderNo });
      } catch (e) {
        // 선점한 시도의 실패 처리는 issueOne 안에서 attempt 조건부로 끝냈다
        results.push({ ok: false, mallKey, orderNo, message: String(e) });
      }
    }
    return j({ ok: true, testYn, results });
  } catch (e) {
    return j({ ok: false, error: String(e) }, 500);
  }
});
