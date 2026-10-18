// 카페24 멀티몰 연동 공용 헬퍼 (Supabase Edge Functions / Deno)
// 몰별 자격증명·토큰을 channel_sync_state(서비스롤 전용)에서 로드한다.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const API_VERSION = "2026-03-01"; // 카페24 Admin API 버전 (앱 생성 시점 기준)

export function admin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

export function cors(headers: HeadersInit = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    ...headers,
  };
}

export interface MallState {
  mall_key: string;
  channel: string;
  cafe24_mall_id: string | null;
  client_id: string | null;
  client_secret: string | null;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | null;
  last_order_synced_at: string | null;
  dry_run: boolean;
}

// DB의 client_secret이 비었거나 'USE_ENV_SECRET' 이면 함수 시크릿(CAFE24_SECRET_<MALLID>)에서 읽는다.
// → 평문 비밀키를 DB에 저장하지 않고 Supabase secrets(vault)에 보관.
function applyEnvSecret(st: MallState | null): MallState | null {
  if (st && (!st.client_secret || st.client_secret === "USE_ENV_SECRET") && st.cafe24_mall_id) {
    // 몰별 시크릿 우선, 없으면 (주)이일칠구 공용 앱 시크릿으로 폴백 (하이헤이호·토비 동일 앱)
    const env = Deno.env.get(`CAFE24_SECRET_${st.cafe24_mall_id.toUpperCase()}`)
      || Deno.env.get("CAFE24_SECRET_MYHO1129");
    if (env) st.client_secret = env;
  }
  return st;
}

export async function getMall(db: ReturnType<typeof admin>, mallKey: string): Promise<MallState | null> {
  const { data } = await db.from("channel_sync_state").select("*").eq("mall_key", mallKey).maybeSingle();
  return applyEnvSecret(data as MallState | null);
}

// 토큰이 있는 활성 몰 전체 (sync 루프용)
export async function getActiveMalls(db: ReturnType<typeof admin>): Promise<MallState[]> {
  const { data: malls } = await db.from("malls").select("mall_key").eq("active", true);
  const keys = (malls || []).map((m: { mall_key: string }) => m.mall_key);
  if (!keys.length) return [];
  const { data } = await db.from("channel_sync_state").select("*").in("mall_key", keys).not("access_token", "is", null);
  return ((data || []) as MallState[]).map(s => applyEnvSecret(s) as MallState);
}

// 저장 실패를 삼키지 않는다 — 회전한 refresh_token 이 DB에 안 남으면 다음 실행부터 영구 invalid_grant
export async function saveMall(db: ReturnType<typeof admin>, mallKey: string, patch: Partial<MallState>) {
  const { error } = await db.from("channel_sync_state").update({ updated_at: new Date().toISOString(), ...patch }).eq("mall_key", mallKey);
  if (error) throw new Error(`[${mallKey}] channel_sync_state 저장 실패: ${error.message}`);
}

export async function log(db: ReturnType<typeof admin>, mallKey: string, type: string, result: string, detail: unknown) {
  await db.from("sync_log").insert([{ channel: "cafe24", type: `${mallKey}:${type}`, result, detail }]);
}

export const baseOf = (mallId: string) => `https://${mallId}.cafe24api.com`;

// 동시 갱신 경쟁 대비 주입점(테스트용). 기본값 = 실제 fetch·DB.
export interface TokenDeps {
  fetchFn?: typeof fetch;
  reload?: (mallKey: string) => Promise<MallState | null>;
  save?: (mallKey: string, patch: Partial<MallState>) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
}
const RELOAD_TRIES = 3, RELOAD_GAP_MS = 1000, SAVE_TRIES = 3;

// 재사용해도 되는 토큰인가 — 만료까지 10분 초과, 2.5h 미만(그 이상=타임존 착오). 일반 재사용·경쟁 복구 둘 다 이 판정만 쓴다.
export function usableToken(t: Pick<MallState, "access_token" | "expires_at"> | null | undefined, now = Date.now()): boolean {
  if (!t?.access_token || !t.expires_at) return false;
  const exp = new Date(t.expires_at).getTime();
  return exp > now + 10 * 60 * 1000 && exp < now + 2.5 * 3600 * 1000;
}

// access_token 갱신 (만료 10분 전이면 refresh) — 몰 자격증명 사용
// refresh_token 은 갱신 때마다 바뀐다. 두 실행(5분 크론·정시 크론 등)이 동시에 갱신하면 진 쪽은 invalid_grant.
// → 그때 DB를 다시 읽어 이긴 쪽이 저장한 새 토큰을 채택한다(이긴 쪽 저장이 늦을 수 있어 1초 간격 3회).
export async function ensureToken(db: ReturnType<typeof admin>, st: MallState, deps: TokenDeps = {}): Promise<string> {
  const fetchFn = deps.fetchFn ?? fetch;
  const reload = deps.reload ?? ((k: string) => getMall(db, k));
  const save = deps.save ?? ((k: string, p: Partial<MallState>) => saveMall(db, k, p));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  // 유효(10분 여유)하고 비정상적 미래(2.5h 초과=타임존 착오)가 아니면 재사용, 그 외 전부 갱신
  if (usableToken(st)) return st.access_token!;
  if (!st.refresh_token) throw new Error(`[${st.mall_key}] refresh_token 없음 — 재인증 필요`);
  if (!st.client_id || !st.client_secret || !st.cafe24_mall_id) throw new Error(`[${st.mall_key}] 자격증명 미설정`);

  const basic = btoa(`${st.client_id}:${st.client_secret}`);
  const res = await fetchFn(`${baseOf(st.cafe24_mall_id)}/api/v2/oauth/token`, {
    method: "POST",
    headers: { "Authorization": `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: st.refresh_token }),
  });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 400 && body.includes("invalid_grant")) {
      for (let i = 0; i < RELOAD_TRIES; i++) {
        const fresh = await reload(st.mall_key);
        // 다른 실행이 갱신했다 = refresh_token 이 바뀌었고, 새 access_token 이 일반 재사용 규칙도 통과한다
        if (fresh?.refresh_token && fresh.refresh_token !== st.refresh_token && usableToken(fresh)) {
          st.access_token = fresh.access_token;
          st.refresh_token = fresh.refresh_token;
          st.expires_at = fresh.expires_at;
          return fresh.access_token!;
        }
        if (i < RELOAD_TRIES - 1) await sleep(RELOAD_GAP_MS);
      }
    }
    throw new Error(`[${st.mall_key}] 토큰 갱신 실패 ${res.status}: ${body}`);
  }
  const j = await res.json();
  const patch = {
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    // 카페24 값 대신 직접 계산한 정확한 UTC ISO (access token 유효 ~2h → 90분 안전마진)
    expires_at: new Date(Date.now() + 90 * 60 * 1000).toISOString(),
  };
  // 저장이 끝나야 성공 — 실패하면 메모리도 그대로 두고 던진다(일시 오류 대비 3회)
  let lastErr: unknown;
  for (let i = 0; i < SAVE_TRIES; i++) {
    try { await save(st.mall_key, patch); lastErr = null; break; }
    catch (e) { lastErr = e; if (i < SAVE_TRIES - 1) await sleep(RELOAD_GAP_MS); }
  }
  if (lastErr) throw new Error(`[${st.mall_key}] 새 토큰 DB 저장 실패(카페24는 이미 회전 — 재인증 필요할 수 있음): ${lastErr instanceof Error ? lastErr.message : lastErr}`);
  Object.assign(st, patch);
  return j.access_token;
}

export async function cafe24Fetch(mallId: string, token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${baseOf(mallId)}${path}`, {
    ...init,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Cafe24-Api-Version": API_VERSION,
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`cafe24 ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}
