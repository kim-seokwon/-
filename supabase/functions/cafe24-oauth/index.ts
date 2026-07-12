// 카페24 OAuth 2.0 (멀티몰) — 몰별 토큰 발급 → channel_sync_state 저장
//
// 사전: malls + channel_sync_state 에 해당 몰 행이 있고 cafe24_mall_id/client_id/client_secret 입력돼 있어야 함
//       (브하스 '카페24 연동' 모달 또는 SQL로 등록)
//
// 사용:
//  1) GET <func-url>?mall=hiheiho           → 그 몰 인증 화면으로 redirect
//  2) 카페24 콜백 GET <func-url>?code=..&state=hiheiho → 토큰 교환·저장
//
// Redirect URI(카페24 앱 설정) = 이 함수 공개 URL 과 정확히 일치
import { admin, baseOf, cors, getMall, log, saveMall } from "../_shared/cafe24.ts";

const SCOPE = "mall.read_product,mall.write_product,mall.read_order,mall.write_order,mall.read_store,mall.read_shipping,mall.write_shipping";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });
  const db = admin();
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const mallKey = url.searchParams.get("mall") || url.searchParams.get("state");
  const redirectUri = Deno.env.get("CAFE24_REDIRECT_URI") || url.origin + url.pathname;

  if (!mallKey) return new Response("mall 파라미터 필요 (?mall=키)", { status: 400, headers: cors() });
  const st = await getMall(db, mallKey);
  if (!st || !st.cafe24_mall_id || !st.client_id) {
    return new Response(`[${mallKey}] 몰 자격증명 미설정 (cafe24_mall_id/client_id 먼저 등록)`, { status: 400, headers: cors() });
  }

  // 1단계: code 없으면 인증 화면으로 redirect (state=mallKey 로 몰 유지)
  if (!code) {
    const authUrl = `${baseOf(st.cafe24_mall_id)}/api/v2/oauth/authorize?` + new URLSearchParams({
      response_type: "code",
      client_id: st.client_id,
      redirect_uri: redirectUri,
      scope: SCOPE,
      state: mallKey,
    });
    return new Response(null, { status: 302, headers: cors({ Location: authUrl }) });
  }

  // 2단계: code → token 교환
  try {
    const basic = btoa(`${st.client_id}:${st.client_secret}`);
    const res = await fetch(`${baseOf(st.cafe24_mall_id)}/api/v2/oauth/token`, {
      method: "POST",
      headers: { "Authorization": `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
    });
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    const j = await res.json();
    await saveMall(db, mallKey, {
      access_token: j.access_token,
      refresh_token: j.refresh_token,
      expires_at: j.expires_at ?? new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
    });
    await db.from("malls").update({ connected: true }).eq("mall_key", mallKey);
    await log(db, mallKey, "oauth", "ok", { scope: j.scopes ?? SCOPE });
    return new Response(
      `<h2>✅ [${mallKey}] 카페24 연동 완료</h2><p>토큰 저장됨. 이제 cafe24-sync 가 이 몰을 처리합니다. (기본 dry-run)</p>`,
      { headers: cors({ "Content-Type": "text/html; charset=utf-8" }) },
    );
  } catch (e) {
    await log(db, mallKey, "oauth", "error", { error: String(e) });
    return new Response("OAuth 실패: " + String(e), { status: 500, headers: cors() });
  }
});
