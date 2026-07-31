// 외부 비용·법적 효력이 발생하는 함수(송장 발번·세금계산서 발행·카톡 발송·채널 송장등록)용 인증 가드.
//
// 왜 필요한가: 이 함수들은 --no-verify-jwt 로 배포돼 있고 CORS 가 * 이며,
// 리포가 공개라 함수 URL도 공개다. 게다가 anon 공개키는 main.js 번들에 들어 있어
// "JWT 검증"만으로는 막히지 않는다(anon 키 자체가 유효한 서명 JWT라 통과함).
// → 토큰이 실제 로그인 사용자(auth.users)에 매핑되는지 직접 확인해야 한다.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface AuthedUser { id: string; email?: string; role: string | null }

function deny(msg: string, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify({ ok: false, error: msg }), {
    status: 401,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Content-Type": "application/json",
      ...extra,
    },
  });
}

// 성공 시 사용자 정보, 실패 시 즉시 반환할 401 Response 를 돌려준다.
//   const auth = await requireUser(req);
//   if (auth instanceof Response) return auth;
export async function requireUser(req: Request, opts: { master?: boolean; roles?: string[] } = {}): Promise<AuthedUser | Response> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return deny("인증 필요 — 로그인 후 이용하세요");

  const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    auth: { persistSession: false },
  });
  // anon 공개키를 그대로 보낸 경우 user 가 없으므로 여기서 걸린다.
  const { data, error } = await anon.auth.getUser(token);
  if (error || !data?.user) return deny("유효한 로그인 세션이 아닙니다");

  // 역할 조회(companies.role). 프로필이 없으면 role=null.
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const email = data.user.email || "";
  const { data: profile } = await admin.from("companies").select("role")
    .eq("username", email.split("@")[0]).maybeSingle();
  const role = profile?.role ?? null;

  if (opts.master && role !== "MASTER") return deny("권한 없음 — 마스터 계정만 가능합니다");
  if (opts.roles?.length && (!role || !opts.roles.includes(role))) {
    return deny("권한 없음 — 허용된 담당자만 실행할 수 있습니다");
  }
  return { id: data.user.id, email, role };
}
