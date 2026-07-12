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

export async function getMall(db: ReturnType<typeof admin>, mallKey: string): Promise<MallState | null> {
  const { data } = await db.from("channel_sync_state").select("*").eq("mall_key", mallKey).maybeSingle();
  return data as MallState | null;
}

// 토큰이 있는 활성 몰 전체 (sync 루프용)
export async function getActiveMalls(db: ReturnType<typeof admin>): Promise<MallState[]> {
  const { data: malls } = await db.from("malls").select("mall_key").eq("active", true);
  const keys = (malls || []).map((m: { mall_key: string }) => m.mall_key);
  if (!keys.length) return [];
  const { data } = await db.from("channel_sync_state").select("*").in("mall_key", keys).not("access_token", "is", null);
  return (data || []) as MallState[];
}

export async function saveMall(db: ReturnType<typeof admin>, mallKey: string, patch: Partial<MallState>) {
  await db.from("channel_sync_state").update({ updated_at: new Date().toISOString(), ...patch }).eq("mall_key", mallKey);
}

export async function log(db: ReturnType<typeof admin>, mallKey: string, type: string, result: string, detail: unknown) {
  await db.from("sync_log").insert([{ channel: "cafe24", type: `${mallKey}:${type}`, result, detail }]);
}

export const baseOf = (mallId: string) => `https://${mallId}.cafe24api.com`;

// access_token 갱신 (만료 10분 전이면 refresh) — 몰 자격증명 사용
export async function ensureToken(db: ReturnType<typeof admin>, st: MallState): Promise<string> {
  const now = Date.now();
  const exp = st.expires_at ? new Date(st.expires_at).getTime() : 0;
  // 유효(10분 여유)하고 비정상적 미래(2.5h 초과=타임존 착오)가 아니면 재사용, 그 외 전부 갱신
  if (st.access_token && exp > now + 10 * 60 * 1000 && exp < now + 2.5 * 3600 * 1000) return st.access_token;
  if (!st.refresh_token) throw new Error(`[${st.mall_key}] refresh_token 없음 — 재인증 필요`);
  if (!st.client_id || !st.client_secret || !st.cafe24_mall_id) throw new Error(`[${st.mall_key}] 자격증명 미설정`);

  const basic = btoa(`${st.client_id}:${st.client_secret}`);
  const res = await fetch(`${baseOf(st.cafe24_mall_id)}/api/v2/oauth/token`, {
    method: "POST",
    headers: { "Authorization": `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: st.refresh_token }),
  });
  if (!res.ok) throw new Error(`[${st.mall_key}] 토큰 갱신 실패 ${res.status}: ${await res.text()}`);
  const j = await res.json();
  await saveMall(db, st.mall_key, {
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    // 카페24 값 대신 직접 계산한 정확한 UTC ISO (access token 유효 ~2h → 90분 안전마진)
    expires_at: new Date(Date.now() + 90 * 60 * 1000).toISOString(),
  });
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
