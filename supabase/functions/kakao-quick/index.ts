// ============================================================
//  카카오 T 퀵/딜리버리 픽업 예약 (kakao-quick)  — 스켈레톤
//  공장 완성품 → 영종도 사무실 퀵 픽업 예약.
//  ⚠️ 카카오모빌리티 비즈니스(카카오 T 퀵/딜리버리 API) 계약 + 키 발급 후 실호출 검증 필요.
//     계약 형태에 따라 엔드포인트/파라미터가 달라 ENV로 주입받는다.
//
//  Supabase secrets:
//    supabase secrets set KAKAO_QUICK_ENDPOINT="https://<카카오모빌리티 발급 엔드포인트>" \
//                         KAKAO_QUICK_KEY="<발급 API 키>" \
//                         PICKUP_ADDR="인천광역시 ... 공장 기본 주소(옵션)" \
//                         DROP_ADDR="인천 중구 영종 ... 사무실 주소" \
//                         DROP_CONTACT="010-0000-0000"
// ============================================================
import { requireUser } from "../_shared/auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ENDPOINT = Deno.env.get("KAKAO_QUICK_ENDPOINT") ?? "";
const KEY = Deno.env.get("KAKAO_QUICK_KEY") ?? "";
const DROP_ADDR = Deno.env.get("DROP_ADDR") ?? "";
const DROP_CONTACT = Deno.env.get("DROP_CONTACT") ?? "";

const cors = (extra: Record<string, string> = {}) => ({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  ...extra,
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });
  const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: cors({ "Content-Type": "application/json" }) });

  if (!ENDPOINT || !KEY) {
    return j({ ok: false, error: "KAKAO_QUICK_ENDPOINT/KEY 시크릿 미설정 (비즈니스 계약 후 발급)" }, 500);
  }
  // 퀵 예약 = 실제 요금 발생 → 로그인 사용자만
  const auth = await requireUser(req, { roles: ["MASTER", "STAFF"] });
  if (auth instanceof Response) return auth;
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  try {
    const { jobId, memo } = await req.json();
    if (!jobId) return j({ ok: false, error: "jobId 필요" }, 400);
    const { data: claimed, error: claimErr } = await db.rpc("claim_vendor_quick", { p_job_id: jobId });
    if (claimErr) return j({ ok: false, error: claimErr.message }, 500);
    if (!claimed) return j({ ok: false, error: "검수 미통과 또는 이미 퀵 요청됨" }, 409);
    const { data: job, error: jobErr } = await db.from("vendor_jobs")
      .select("id,title,qty,qc_status,vendor_id,vendors(name,address,phone)").eq("id", jobId).single();
    if (jobErr || !job) return j({ ok: false, error: "생산 작업을 찾을 수 없음" }, 404);
    const vendor = Array.isArray(job.vendors) ? job.vendors[0] : job.vendors;

    // 카카오모빌리티 퀵/딜리버리 예약 페이로드 (계약 규격에 맞게 매핑)
    const payload = {
      pickup: { address: vendor?.address || "", contact: vendor?.phone || "", name: vendor?.name || "생산처" },
      drop: { address: DROP_ADDR, contact: DROP_CONTACT, name: "(주)이일칠구 영종 사무실" },
      item: { name: job.title || "완성 의류", quantity: job.qty || 1, category: "의류" },
      memo: memo || `작업 #${jobId} 완성 픽업`,
      reference: String(jobId ?? ""),
    };

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `KakaoAK ${KEY}`,      // 계약 규격에 따라 Bearer 등으로 조정
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
      await db.from("vendor_jobs").update({ quick_status: { status: "failed", error: out?.message || `HTTP ${res.status}` } }).eq("id", jobId);
      return j({ ok: false, error: out?.message || `HTTP ${res.status}` });
    }

    // 응답에서 예약번호/운송장 추출 (규격에 맞게 조정)
    const result = {
      ok: true,
      trackingNo: out.deliveryId || out.trackingNo || out.orderId || null,
      status: out.status || "requested",
    };
    await db.from("vendor_jobs").update({ quick_status: result }).eq("id", jobId);
    await db.from("operation_audit").insert({ actor_id: auth.id, actor_email: auth.email, action: "quick.request", entity_type: "vendor_job", entity_id: String(jobId), result: "ok", detail: { trackingNo: result.trackingNo } });
    return j(result);
  } catch (e) {
    return j({ ok: false, error: String(e) }, 500);
  }
});
