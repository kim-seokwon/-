// 카페24 회원수 응답 해석 · KST 날짜 — 순수 함수(테스트 대상)
export function kstDate(now = new Date()): string {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

// GET /api/v2/admin/customersprivacy/count → { count: number }
export function parseCount(j: unknown): number {
  const n = (j as { count?: unknown })?.count;
  const v = typeof n === "string" ? Number(n) : n;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) throw new Error(`회원수 응답 형식 이상: ${JSON.stringify(j).slice(0, 120)}`);
  return v;
}

// 권한 부족(403)이면 재인증 안내로 바꿔 보인다.
export function explain(err: string): string {
  return /→ 403/.test(err) ? `권한 없음 — 카페24 앱에 '회원 개인정보 읽기' 켜고 mall.read_privacy 로 재인증 필요 (${err.slice(0, 160)})` : err.slice(0, 300);
}
