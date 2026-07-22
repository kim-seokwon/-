// ============================================================
//  팝빌 전자세금계산서 발행 (taxinvoice-issue)
//  견적(quote) → 팝빌 Taxinvoice 매핑 → 즉시발행(RegistIssue)
//
//  자격증명(Supabase secrets):
//    supabase secrets set POPBILL_LINKID=... POPBILL_SECRETKEY=... \
//                         POPBILL_CORPNUM=2798803052  (하이픈 제거) \
//                         POPBILL_IS_TEST=true        (테스트베드; 운영 시 false)
//
//  ⚠️ 팝빌 LinkHub 인증(토큰+서명)은 팝빌 키 발급 후 실호출로 최종 검증 필요.
//     매핑 로직·발행 파라미터는 팝빌 Taxinvoice 규격 기준.
// ============================================================
const LINKID = Deno.env.get("POPBILL_LINKID") ?? "";
const SECRETKEY = Deno.env.get("POPBILL_SECRETKEY") ?? "";
const CORPNUM = (Deno.env.get("POPBILL_CORPNUM") ?? "2798803052").replace(/[^0-9]/g, "");
const IS_TEST = (Deno.env.get("POPBILL_IS_TEST") ?? "true") === "true";
// LinkHub / 팝빌 서비스 도메인
const AUTH_BASE = IS_TEST ? "https://auth-test.linkhub.co.kr" : "https://auth.linkhub.co.kr";
const SVC_BASE = IS_TEST ? "https://popbill-test.linkhub.co.kr" : "https://popbill.linkhub.co.kr";
const SVC_ID = "POPBILL";

const cors = (extra: Record<string, string> = {}) => ({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  ...extra,
});

// LinkHub Bearer 토큰 발급 (HMAC-SHA256 서명)
async function hmacSha256B64(keyB64: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", Uint8Array.from(atob(keyB64), c => c.charCodeAt(0)),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}
async function sha256B64(body: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return btoa(String.fromCharCode(...new Uint8Array(h)));
}
async function getToken(): Promise<string> {
  const bodyObj = { access_ver: 1, scope: ["110"] }; // 110 = 전자세금계산서
  const body = JSON.stringify(bodyObj);
  const date = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const hashedBody = await sha256B64(body);
  const target = ["POST", `\n${hashedBody}`, `\n${date}`, `\n1.0`, `\n${SVC_ID}`].join("");
  const sign = await hmacSha256B64(SECRETKEY, target);
  const res = await fetch(`${AUTH_BASE}/${LINKID}/Token`, {
    method: "POST",
    headers: { "x-lh-date": date, "x-lh-version": "1.0", "Authorization": `LINKHUB ${sign}`, "Content-Type": "application/json" },
    body,
  });
  const j = await res.json();
  if (!j.session_token) throw new Error("LinkHub 토큰 실패: " + JSON.stringify(j));
  return j.session_token;
}

// 견적 → 팝빌 Taxinvoice 매핑
function mapTaxinvoice(q: Record<string, any>, opt: Record<string, any>) {
  const items = Array.isArray(q.items) ? q.items : [];
  const writeDate = (opt.supplyDate || q.tax_supply_date || q.quote_date || "").replace(/-/g, "");
  return {
    writeDate,                         // 작성일자(=공급일) YYYYMMDD
    chargeDirection: "정과금",
    issueType: "정발행",
    purposeType: opt.purposeType || "영수",
    taxType: "과세",
    // 공급자(2179)
    invoicerCorpNum: CORPNUM,
    invoicerCorpName: "주식회사 이일칠구",
    invoicerCEOName: "김석원",
    invoicerAddr: "인천광역시 하늘중앙로 225번길 20, 507-8호",
    invoicerBizType: "서비스",
    invoicerBizClass: "경영컨설팅",
    invoicerContactName: "방보경",
    invoicerTEL: "010-9072-7003",
    // 공급받는자(고객사)
    invoiceeType: "사업자",
    invoiceeCorpNum: (q.client_biz_no || "").replace(/[^0-9]/g, ""),
    invoiceeCorpName: q.client_name || "",
    invoiceeCEOName: q.client_ceo || "",
    invoiceeEmail1: opt.email || "",
    supplyCostTotal: String(q.supply_amount || 0),
    taxTotal: String(q.tax_amount || 0),
    totalAmount: String(q.total_amount || 0),
    detailList: items.map((it: any, i: number) => ({
      serialNum: i + 1,
      itemName: it.name || "",
      spec: it.spec || "",
      qty: String(it.qty || ""),
      unitCost: String(it.price || ""),
      supplyCost: String((it.qty || 0) * (it.price || 0)),
      tax: String(it.tax || 0),
      remark: it.note || "",
    })),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });
  const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: cors({ "Content-Type": "application/json" }) });
  if (!LINKID || !SECRETKEY) return j({ ok: false, error: "POPBILL_LINKID/SECRETKEY 시크릿 미설정" }, 500);
  try {
    const { quote, email, supplyDate, purposeType } = await req.json();
    if (!quote?.client_biz_no) return j({ ok: false, error: "공급받는자 사업자번호 없음" }, 400);
    if (!email) return j({ ok: false, error: "공급받는자 이메일 없음" }, 400);
    if (!supplyDate) return j({ ok: false, error: "작성일자(공급일) 없음" }, 400);

    const mgtKey = "Q" + (quote.id || "").replace(/-/g, "").slice(0, 23);
    const invoice = mapTaxinvoice(quote, { email, supplyDate, purposeType });
    const token = await getToken();
    // RegistIssue: 즉시발행
    const res = await fetch(`${SVC_BASE}/Taxinvoice/${CORPNUM}?ID=${encodeURIComponent(mgtKey)}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json;charset=utf-8",
        "x-pb-version": "1.0",
        "x-pb-message-digest": await sha256B64(JSON.stringify(invoice)),
      },
      body: JSON.stringify(invoice),
    });
    const out = await res.json();
    if (out.code && out.code < 0) return j({ ok: false, error: out.message, code: out.code, mgtKey });
    return j({ ok: true, mgtKey, ntsConfirmNum: out.ntsConfirmNum, result: out });
  } catch (e) {
    return j({ ok: false, error: String(e) }, 500);
  }
});
