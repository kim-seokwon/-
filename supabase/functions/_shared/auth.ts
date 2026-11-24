// 외부 비용·법적 효력이 발생하는 함수(송장 발번·세금계산서 발행·카톡 발송·채널 송장등록)용 인증 가드.
//
// 왜 필요한가: 이 함수들은 --no-verify-jwt 로 배포돼 있고 CORS 가 * 이며,
// 리포가 공개라 함수 URL도 공개다. 게다가 anon 공개키는 main.js 번들에 들어 있어
// "JWT 검증"만으로는 막히지 않는다(anon 키 자체가 유효한 서명 JWT라 통과함).
// → 토큰이 실제 로그인 사용자(auth.users)에 매핑되는지 직접 확인해야 한다.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { publishableKey, serviceKey } from "./keys.ts";

export interface AuthedUser {
  id: string; email?: string; role: string | null;
  menu_access?: string[] | null; perms?: Record<string, boolean> | null;
  brand_id?: string | null; brand_access?: string[] | null;
}

// 128 can_menu / can_do 와 같은 규칙(서버 함수에서 쓰는 쪽). MASTER 는 전부.
//  최소 권한 메뉴(끌 수 없음) = 할 일·설정·제품리스트. CS·지출·메모·거래처는 끄면 막힌다(반려1-2).
export const MENU_ALWAYS = ["all_todos", "reminders", "settings", "items"];
export function canMenu(u: AuthedUser, menu: string): boolean {
  if (u.role === "MASTER") return true;
  if (u.role !== "STAFF") return false;
  if (!u.menu_access || MENU_ALWAYS.includes(menu)) return true;
  return u.menu_access.includes(menu);
}
// 128 can_access_brand 와 같은 규칙: MASTER 전부 · STAFF 는 brand_access 에 든 브랜드만 · CLIENT 는 자기 브랜드
export function canBrand(u: AuthedUser, brandId: string | null | undefined): boolean {
  if (u.role === "MASTER") return true;
  if (!brandId) return false;
  if (u.role === "STAFF") return !!u.brand_access?.includes(brandId);
  return u.brand_id === brandId || !!u.brand_access?.includes(brandId);
}
export function canDo(u: AuthedUser, action: string): boolean {
  if (u.role === "MASTER") return true;
  if (u.role === "STAFF") return u.perms?.[action] !== false;
  return action === "delete";
}

// 권한 확인 자체가 실패(DB·네트워크·스키마 오류)한 경우. '권한 없음'과 구분해 503 으로 돌려준다(여전히 거절 = fail-closed).
//  code 만 싣는다 — 원시 오류 메시지·URL·SQL 은 응답·콘솔 어디에도 내보내지 않는다.
export class AuthLookupError extends Error {
  constructor(public code: string) { super(code); this.name = "AuthLookupError"; }
}
// PostgREST 응답의 error → 코드. 여러 행(PGRST116)은 데이터 문제라 따로 구분.
function lookupFail(error: { code?: string } | null | undefined): never {
  throw new AuthLookupError(error?.code === "PGRST116" ? "profile_ambiguous" : "profile_lookup_failed");
}

// 본인 = auth_user_id 일치 우선, auth_user_id 가 빈 옛 행만 email 앞부분. 비활성(active=false)은 없는 사람.
export async function profileFor(admin: any, userId: string, email: string) {
  const cols = "role, username, menu_access, perms, active, auth_user_id, brand_id, brand_access";
  // 조회 오류를 '프로필 없음'으로 삼키지 않는다(스키마 미적용·DB 장애가 전원 권한없음으로 보이던 문제).
  const a = await admin.from("companies").select(cols).eq("auth_user_id", userId).maybeSingle();
  if (a.error) lookupFail(a.error);
  let data = a.data;
  if (!data) {
    const r = await admin.from("companies").select(cols).eq("username", email.split("@")[0]).is("auth_user_id", null).maybeSingle();
    if (r.error) lookupFail(r.error);
    data = r.data;
  }
  if (!data || data.active === false) return null;
  return data;
}

function deny(msg: string, extra: Record<string, string> = {}, status = 401, code?: string) {
  return new Response(JSON.stringify(code ? { ok: false, error: msg, code } : { ok: false, error: msg }), {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Content-Type": "application/json",
      ...extra,
    },
  });
}

// 권한 확인 일시 실패 — 503. 콘솔엔 코드만.
function unavailable(code: string) {
  console.error(`[auth] ${code}`);
  return deny("권한 확인 일시 실패 — 잠시 후 다시 시도하세요", { "Retry-After": "5" }, 503, code);
}
// 세션 확인(getUser) 오류 중 네트워크·서버 쪽(재시도형·5xx·0)만 503, 나머지(잘못된 토큰)는 401 유지.
function authServerError(e: any): boolean {
  if (!e) return false;
  const st = typeof e.status === "number" ? e.status : undefined;
  return e.name === "AuthRetryableFetchError" || st === 0 || (st !== undefined && st >= 500);
}

// 성공 시 사용자 정보, 실패 시 즉시 반환할 Response 를 돌려준다.
//   401 = 로그인 없음·무효 / 무프로필·비활성·권한없음(기존 그대로)
//   503 = 권한 확인 자체 실패(DB·네트워크·스키마) — 거절은 유지, 이유만 구분
//   deps 는 시험용 대역(실서비스는 비움).
//   const auth = await requireUser(req);
//   if (auth instanceof Response) return auth;
export async function requireUser(req: Request, opts: { master?: boolean; roles?: string[] } = {},
  deps: { anon?: any; admin?: any } = {}): Promise<AuthedUser | Response> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return deny("인증 필요 — 로그인 후 이용하세요");

  const anon = deps.anon ?? createClient(Deno.env.get("SUPABASE_URL")!, publishableKey(), {
    auth: { persistSession: false },
  });
  // anon 공개키를 그대로 보낸 경우 user 가 없으므로 여기서 걸린다.
  let data: any, error: any;
  try { ({ data, error } = await anon.auth.getUser(token)); } catch { return unavailable("session_check_failed"); }
  if (authServerError(error)) return unavailable("session_check_failed");
  if (error || !data?.user) return deny("유효한 로그인 세션이 아닙니다");

  // 역할 조회(companies.role). 프로필이 없으면 role=null.
  const email = data.user.email || "";
  let profile: any;
  try {
    const admin = deps.admin ?? createClient(Deno.env.get("SUPABASE_URL")!, serviceKey(), {
      auth: { persistSession: false },
    });
    profile = await profileFor(admin, data.user.id, email);
  } catch (e) {
    return unavailable(e instanceof AuthLookupError ? e.code : "profile_lookup_failed");
  }
  const role = profile?.role ?? null;

  if (opts.master && role !== "MASTER") return deny("권한 없음 — 마스터 계정만 가능합니다");
  if (opts.roles?.length && (!role || !opts.roles.includes(role))) {
    return deny("권한 없음 — 허용된 담당자만 실행할 수 있습니다");
  }
  return { id: data.user.id, email, role, menu_access: profile?.menu_access ?? null, perms: profile?.perms ?? null,
    brand_id: profile?.brand_id ?? null, brand_access: profile?.brand_access ?? null };
}
