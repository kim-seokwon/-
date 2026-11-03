// 서버 비밀키 — 엣지함수 전용 새 키(edge_functions)를 쓴다 (11-03 비밀키 교체).
// SUPABASE_SECRET_KEYS 는 플랫폼이 넣어 주는 {이름: 키} JSON. 예전 SUPABASE_SERVICE_ROLE_KEY 는 옛 default 키라 지운다.
// 새 키가 안 들어와 있을 때만(교체 전 배포 등) 예전 변수로 돌아간다.
export function serviceKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    if (typeof keys?.edge_functions === "string" && keys.edge_functions) return keys.edge_functions;
  } catch (_e) { /* 형식이 깨졌으면 아래로 */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
}
