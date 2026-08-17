// 인스타그램 피드 미리보기용 — 특정 IG 비즈니스 계정의 최근 게시물 썸네일을 반환.
//  톤앤매너 미리보기(대시보드 SNS 탭)에서 기존 피드 그리드를 그리는 데 사용.
//  토큰: ig_token(사용자 장기토큰) → me/accounts 페이지토큰 확보 → /{ig_id}/media 조회.
//  로그인 사용자면 누구나 조회 가능(피드 이미지 = 비민감).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";

const GRAPH = "https://graph.facebook.com/v20.0";
const cors = (h: HeadersInit = {}) => ({ "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Content-Type": "application/json", ...h });
const admin = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: cors() });

  try {
    const body = await req.json().catch(() => ({}));
    const igId = String(body.ig_business_id || "").trim();
    const limit = Math.min(24, Math.max(1, Number(body.limit) || 15));
    if (!igId) return j({ ok: false, error: "ig_business_id 필요" }, 400);

    const db = admin();
    const { data: trow } = await db.from("ig_token").select("token").eq("id", 1).maybeSingle();
    const userTok = trow?.token || Deno.env.get("META_IG_TOKEN") || "";
    if (!userTok) return j({ ok: false, error: "메타 토큰 미설정" }, 200);

    // 페이지 토큰들 확보(연결 IG 미디어는 페이지 토큰으로 안정 조회)
    const tokens: string[] = [];
    try {
      let url: string | null = `${GRAPH}/me/accounts?fields=access_token&limit=100&access_token=${encodeURIComponent(userTok)}`;
      while (url) {
        const aj = await (await fetch(url)).json();
        if (aj.error) break;
        (aj.data || []).forEach((p: { access_token?: string }) => { if (p.access_token) tokens.push(p.access_token); });
        url = aj.paging?.next || null;
      }
    } catch (_e) { /* ignore */ }
    tokens.push(userTok); // 폴백

    const fields = "id,media_type,media_url,thumbnail_url,permalink,caption,timestamp,like_count,comments_count";
    let media: unknown[] | null = null;
    for (const t of tokens) {
      const r = await fetch(`${GRAPH}/${igId}/media?fields=${fields}&limit=${limit}&access_token=${encodeURIComponent(t)}`);
      const p = await r.json();
      if (!p.error && Array.isArray(p.data)) { media = p.data; break; }
    }
    if (!media) return j({ ok: false, error: "피드를 불러오지 못했어요(권한/토큰 확인)" }, 200);

    const items = media.map((m: Record<string, unknown>) => ({
      id: m.id,
      type: m.media_type,
      // 이미지=media_url, 영상=thumbnail_url. CDN 서명 URL(만료 있음) → 즉시 표시용.
      thumb: (m.media_type === "VIDEO" ? (m.thumbnail_url || m.media_url) : m.media_url) || null,
      permalink: m.permalink || null,
      caption: typeof m.caption === "string" ? (m.caption as string).slice(0, 80) : "",
      likes: Number(m.like_count || 0),
      comments: Number(m.comments_count || 0),
      timestamp: m.timestamp || null,
    })).filter((x) => x.thumb);

    return j({ ok: true, count: items.length, items });
  } catch (e) {
    return j({ ok: false, error: String(e) }, 200);
  }
});
