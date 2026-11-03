// 서버 키 — 플랫폼이 넣어 주는 JSON 변수에서만 읽는다 (11-03 비밀키 교체: legacy JWT·옛 default 키 의존 0).
//   SUPABASE_SECRET_KEYS      {이름: sb_secret_…}      → 엣지함수 전용 edge_functions
//   SUPABASE_PUBLISHABLE_KEYS {이름: sb_publishable_…} → default (사용자 로그인 토큰 확인용)
// 없거나 깨졌거나 새 형식 키가 아니면 예전 변수(SUPABASE_SERVICE_ROLE_KEY/ANON_KEY)로 돌아가지 않고 바로 오류(fail-closed).
function fromJson(env: string, name: string, prefix: string): string {
  let keys: unknown = null;
  try { keys = JSON.parse(Deno.env.get(env) ?? ""); } catch (_e) { /* 아래에서 오류 */ }
  const v = keys && typeof keys === "object" ? (keys as Record<string, unknown>)[name] : undefined;
  if (typeof v !== "string" || !v.startsWith(prefix)) {
    throw new Error(`${env}.${name} 키가 없습니다 — 엣지함수 키 설정을 확인하세요(예전 키로 돌아가지 않음)`);
  }
  return v;
}
export const serviceKey = (): string => fromJson("SUPABASE_SECRET_KEYS", "edge_functions", "sb_secret_");
export const publishableKey = (): string => fromJson("SUPABASE_PUBLISHABLE_KEYS", "default", "sb_publishable_");
