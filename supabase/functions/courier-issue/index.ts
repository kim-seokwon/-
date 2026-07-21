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

const BASE = "http://ship.epost.go.kr";
const REGKEY = Deno.env.get("EPOST_REGKEY") ?? "";
const SECKEY = Deno.env.get("EPOST_SECKEY") ?? "";
const CUSTNO = Deno.env.get("EPOST_CUSTNO") ?? "";
const APPRNO = Deno.env.get("EPOST_APPRNO") ?? "";
const OFFICESER = Deno.env.get("EPOST_OFFICESER") ?? "";

const cors = (extra: Record<string, string> = {}) => ({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  ...extra,
});

// 평문 조립: key=val&key=val (빈값 제외)
function plain(f: Record<string, unknown>): string {
  return Object.entries(f)
    .filter(([, v]) => v !== undefined && v !== null && String(v) !== "")
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

// 우체국 API 호출: 평문 → SEED128 암호화 → GET → XML 텍스트
async function epostCall(msgName: string, fields: Record<string, unknown>, option?: string): Promise<string> {
  const regData = seedEncryptEcbHex(SECKEY, plain(fields));
  const qs = `key=${encodeURIComponent(REGKEY)}&regData=${encodeURIComponent(regData)}` + (option ? `&option=${option}` : "");
  const res = await fetch(`${BASE}/${msgName}?${qs}`, {
    headers: { "Connection": "keep-alive", "Host": "biz.epost.go.kr", "User-Agent": "brhas/1.0" },
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
  const fields: Record<string, unknown> = {
    custNo: CUSTNO,
    apprNo: APPRNO,
    officeSer: OFFICESER,
    payType: o.payType ?? "1",     // 1:일반(즉납/후납), 2:수취인부담
    reqType: o.reqType ?? "1",     // 1:일반소포, 2:반품소포
    microYn: o.microYn ?? "N",     // 초소형 여부(필수)
    weight: o.weight,              // kg (정수)
    volume: o.volume,              // cm (정수)
    orderNo: o.orderNo,            // 채널 주문번호(필수)
    ordCompNm: o.ordCompNm,        // 주문처명=몰/브랜드(필수)
    inqTelCn: o.inqTelCn,          // 문의처
    ordNm: o.ordNm, ordZip: o.ordZip, ordAddr1: o.ordAddr1, ordAddr2: o.ordAddr2, ordTel: o.ordTel, ordMob: o.ordMob,
    recNm: o.recNm,                // 수취인명(필수)
    recZip: o.recZip,              // 수취인 우편번호(필수)
    recAddr1: o.recAddr1,          // 수취인 주소(필수)
    recAddr2: o.recAddr2,          // 수취인 상세주소(필수)
    recTel: o.recTel, recMob: o.recMob, // recTel/recMob 중 하나 필수
    contCd: o.contCd ?? "021",     // 주요 내용품코드(필수) — 021 등, 실제 코드는 계약별 확인
    goodsNm: o.goodsNm,            // 상품명(필수)
    goodsCd: o.goodsCd, goodsMdl: o.goodsMdl, goodsSize: o.goodsSize, goodsColor: o.goodsColor, qty: o.qty,
    delivMsg: o.delivMsg,          // 배송 메시지
    printYn: o.printYn ?? "N",
    testYn,                        // Y면 테스트 접수(실발송 없음)
  };
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

// ── 셋업용: 고객번호/승인번호/공급지등록 ─────────────────────
async function getCustNo(memberID: string) {
  const xml = await epostCall("api.GetCustNo.jparcel", { memberID });
  return xerr(xml) ?? { custNo: xf(xml, "custNo") };
}
async function getApprNo() {
  const xml = await epostCall("api.GetApprNo.jparcel", { custNo: CUSTNO });
  return xerr(xml) ?? { apprNo: xf(xml, "apprNo"), payTypeNm: xf(xml, "payTypeNm"), postNm: xf(xml, "postNm") };
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
  if (!REGKEY || !SECKEY) return j({ ok: false, error: "EPOST_REGKEY/EPOST_SECKEY 시크릿 미설정" }, 500);
  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action ?? "issue";
    if (action === "cust-no") return j(await getCustNo(body.memberID));
    if (action === "appr-no") return j(await getApprNo());
    if (action === "setup-office") return j(await insertOffice(body.office ?? {}));
    // 기본: 발번(여러 주문 일괄). body.test=true 면 testYn=Y
    const testYn = body.test ? "Y" : "N";
    const orders = Array.isArray(body.orders) ? body.orders : [];
    const results = [];
    for (const o of orders) results.push(await insertOrder(o, testYn));
    return j({ ok: true, testYn, results });
  } catch (e) {
    return j({ ok: false, error: String(e) }, 500);
  }
});
