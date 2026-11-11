// 게시물별 광고리포트 수집기 (105) — 메타 광고 수치를 게시물 단위로 모은다. LLM 없음.
//  · 광고 쪽은 GET 만 부른다(켜기·끄기·예산 변경 코드 없음 — 토큰에 ads_management 가 있어도). 테스트 8이 지킨다.
//  · 토큰 = 함수 시크릿 META_ADS_TOKEN(ads_read 이상). 원문은 어디에도 남기지 않는다(scrub).
//  · 광고계정 = me/adaccounts 자동 탐색(AD_ACCOUNT_IDS 로 고정 가능). 광고는 creative.instagram_user_id 가 우리 IG 인 것만.
//  · 게시물 키 = creative.source_instagram_media_id(원래 피드 게시물), 없으면 effective_instagram_media_id(광고용 사본).
//    11-11 실측: 두 값이 다르다 — effective 는 광고용 사본 ID 라 피드 게시물과 안 맞는다.
//  · 수치 = 광고마다 /{ad}/insights 일별(time_increment=1, v23, 광고세트 기여 설정 그대로). 최근 8일, 09시(KST)·?full=1 은 28일.
//    팔로우 = instagram_profile_follow 필드(11-11 실측: _v2 는 필드로 안 온다 — 오면 그것도 받는다).
//  · 게시물 도달 = 계정 insights(ad.id IN …) 1회 — 광고별 도달을 더하지 않는다.
//  · 모으기 → 쓰기 두 단계. 권한오류(190·200번대·10)가 나면 아무것도 덮어쓰지 않고 sync_log error + account_check 만 남긴다.
//  · 광고 일부 실패 → 나머지는 저장, 실패 광고는 ad_links.last_fail_at(화면 '보류 · 갱신 실패'), sync_log 'partial'.
//  호출: pg_cron(x-cron-secret) 09·12·15·18·21시 KST. 크론 SQL 은 105 마이그레이션 주석.
import { kstDate, scrub } from "../instagram-sync/competitors.ts";

// deno-lint-ignore no-explicit-any
export type Deps = { db: any; fetch: (url: string, init?: RequestInit) => Promise<Response>; env: (k: string) => string | undefined; now?: () => Date };

export const GRAPH = "https://graph.facebook.com/v23.0";
const AD_FIELDS = "id,name,effective_status,created_time,updated_time,campaign_id,adset{id,daily_budget,end_time},creative{source_instagram_media_id,effective_instagram_media_id,instagram_user_id,instagram_permalink_url,thumbnail_url}";
const INS_FIELDS = "spend,impressions,reach,instagram_profile_visits,instagram_profile_follow,account_currency";

type GErr = { message?: string; code?: number; error_subcode?: number };
// 토큰 만료·폐기(190), 권한 없음(10, 200번대) → 권한오류. 나머지(호출 한도·일시 오류 등)는 그 광고만 실패.
export const isAuthError = (e?: GErr | null) => !!e && (Number(e.code) === 190 || Number(e.code) === 10 || (Number(e.code) >= 200 && Number(e.code) < 300));

export const addDays = (day: string, n: number) => { const d = new Date(day + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const kstHour = (now: Date) => new Date(now.getTime() + 9 * 3600e3).getUTCHours();
const int = (v: unknown) => Math.round(Number(v || 0)) || 0;

function cors(h: HeadersInit = {}) {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret", "Content-Type": "application/json", ...h };
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: cors() });

type Ad = {
  id: string; name?: string; effective_status?: string; created_time?: string; updated_time?: string; campaign_id?: string;
  adset?: { id?: string; daily_budget?: string; end_time?: string };
  creative?: { source_instagram_media_id?: string; effective_instagram_media_id?: string; instagram_user_id?: string; instagram_permalink_url?: string; thumbnail_url?: string };
};

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });
  const cronSecret = deps.env("CRON_SECRET") || "";
  const provided = (req.headers.get("x-cron-secret") || "").trim();
  if (!cronSecret || provided.length !== cronSecret.length || provided !== cronSecret) return json({ ok: false, error: "unauthorized" }, 401);

  const db = deps.db;
  const now = deps.now ? deps.now() : new Date();
  const nowIso = now.toISOString();
  const token = deps.env("META_ADS_TOKEN") || "";
  const q = new URL(req.url).searchParams;
  const today = kstDate(now);
  const full = q.get("full") === "1" || kstHour(now) === 9;
  const since = addDays(today, full ? -27 : -7);
  const S = (s: unknown) => scrub(String(s ?? ""), token);

  // 모든 Graph 호출은 이 함수 하나로 — 메서드는 GET 고정
  const get = async (path: string): Promise<{ data?: any; error?: GErr }> => { // deno-lint-ignore no-explicit-any
    const sep = path.includes("?") ? "&" : "?";
    try {
      const r = await deps.fetch(`${GRAPH}/${path}${sep}access_token=${encodeURIComponent(token)}`, { method: "GET" });
      const j = await r.json().catch(() => ({}));
      if (j?.error) return { error: { message: S(j.error.message), code: j.error.code, error_subcode: j.error.error_subcode } };
      if (!r.ok) return { error: { message: `HTTP ${r.status}` } };
      return { data: j };
    } catch (e) { return { error: { message: S(e) } }; }
  };
  const getAll = async (path: string, maxPages = 20) => {
    const out: any[] = []; // deno-lint-ignore no-explicit-any
    let p: string | null = path, n = 0;
    while (p && n < maxPages) {
      const r = await get(p);
      if (r.error) return { error: r.error, rows: out };
      out.push(...(r.data?.data || []));
      const next: string | undefined = r.data?.paging?.next;
      // next 에는 토큰이 박혀 온다 — 커서만 떼어 같은 경로로 다시 부른다
      const after = next ? new URL(next).searchParams.get("after") : null;
      p = after ? `${path}${path.includes("?") ? "&" : "?"}after=${encodeURIComponent(after)}` : null;
      n++;
    }
    return { rows: out };
  };

  const setState = (patch: Record<string, unknown>) => db.from("ad_report_state").upsert({ id: 1, last_run_at: nowIso, updated_at: nowIso, ...patch }, { onConflict: "id" });
  const log = (result: string, detail: unknown) => db.from("sync_log").insert([{ channel: "meta_ads", type: "ads:report", result, detail }]);

  // 권한오류 — 아무것도 덮어쓰지 않는다. 토큰 상태만 1회 확인해 남긴다.
  const authFail = async (step: string, e: GErr) => {
    const perm = await get("me/permissions");
    const granted = (perm.data?.data || []).filter((p: { status?: string }) => p.status === "granted").map((p: { permission?: string }) => p.permission);
    const account_check = perm.error ? { token_valid: false, code: perm.error.code ?? null } : { token_valid: true, ads_read: granted.includes("ads_read") || granted.includes("ads_management") };
    const message = `권한오류(${step}) #${e.code ?? "?"} ${e.message || ""}`.slice(0, 200);
    await log("error", { auth: true, step, code: e.code ?? null, message, account_check });
    await setState({ result: "error", auth_error: true, failed_ads: [], message });
    return json({ ok: false, auth_error: true, step, account_check });
  };

  if (!token) {
    await log("error", { auth: true, step: "token", message: "META_ADS_TOKEN 미설정" });
    await setState({ result: "error", auth_error: true, failed_ads: [], message: "META_ADS_TOKEN 미설정" });
    return json({ ok: false, error: "META_ADS_TOKEN 미설정" });
  }

  try {
    // 0) 우리 IG 계정 → 브랜드
    const { data: accs } = await db.from("ig_accounts").select("id, brand_id, ig_id, ig_business_id");
    const igBrand = new Map<string, string>();
    for (const a of accs || []) for (const k of [a.ig_id, a.ig_business_id]) if (k) igBrand.set(String(k), a.brand_id);

    // 1) 광고계정
    let accounts: { id: string; currency: string | null }[] = [];
    const fixed = (deps.env("AD_ACCOUNT_IDS") || "").split(",").map((s) => s.trim().replace(/^act_/, "")).filter(Boolean);
    if (fixed.length) accounts = fixed.map((id) => ({ id, currency: null }));
    else {
      const r = await getAll("me/adaccounts?fields=account_id,currency,account_status&limit=100");
      if (r.error) return isAuthError(r.error) ? await authFail("me/adaccounts", r.error) : await hardFail("me/adaccounts", r.error);
      accounts = r.rows.filter((a) => Number(a.account_status) === 1).map((a) => ({ id: String(a.account_id), currency: a.currency || null }));
    }

    // 2) 광고 목록(우리 IG 만)
    const links: Record<string, unknown>[] = [];
    const accountErrors: { account: string; message: string }[] = [];
    for (const acct of accounts) {
      const r = await getAll(`act_${acct.id}/ads?fields=${encodeURIComponent(AD_FIELDS)}&limit=100`);
      if (r.error) {
        if (isAuthError(r.error)) return await authFail(`act_${acct.id}/ads`, r.error);
        accountErrors.push({ account: acct.id, message: r.error.message || "" });
        continue;
      }
      for (const ad of r.rows as Ad[]) {
        const c = ad.creative || {};
        const ig = c.instagram_user_id ? String(c.instagram_user_id) : null;
        if (!ig || !igBrand.has(ig)) continue;
        const media = c.source_instagram_media_id || c.effective_instagram_media_id || null;
        links.push({
          ad_id: ad.id, ad_account_id: acct.id, currency: acct.currency, campaign_id: ad.campaign_id ?? null, adset_id: ad.adset?.id ?? null,
          ad_name: ad.name ?? null, effective_status: ad.effective_status ?? null,
          daily_budget: ad.adset?.daily_budget ? int(ad.adset.daily_budget) : null, adset_end: ad.adset?.end_time ?? null,
          ig_user_id: ig, media_id: media, media_src: c.source_instagram_media_id ? "source" : media ? "effective" : null,
          brand_id: igBrand.get(ig) ?? null, permalink: c.instagram_permalink_url ?? null, thumb_url: c.thumbnail_url ?? null,
          created_time: ad.created_time ?? null, updated_time: ad.updated_time ?? null, updated_at: nowIso,
        });
      }
    }
    if (!accounts.length || accountErrors.length === accounts.length) return await hardFail("ads", { message: accountErrors.map((e) => `${e.account}: ${e.message}`).join(" / ") || "광고계정 없음" });

    // 3) 광고별 일별 수치 — 진행중이거나 창 안에서 바뀐 광고만
    const sinceTs = `${since}T00:00:00+09:00`;
    const targets = links.filter((l) => l.effective_status === "ACTIVE" || (l.updated_time && new Date(String(l.updated_time)) >= new Date(sinceTs)));
    const range = encodeURIComponent(JSON.stringify({ since, until: today }));
    const daily: Record<string, unknown>[] = [];
    const okAds: string[] = [], failed: { ad_id: string; message: string }[] = [];
    let authErr: GErr | null = null;
    for (const l of targets) {
      const r = await getAll(`${l.ad_id}/insights?time_increment=1&time_range=${range}&fields=${INS_FIELDS}&use_unified_attribution_setting=true&limit=100`, 3);
      if (r.error) {
        if (isAuthError(r.error)) authErr = r.error;
        failed.push({ ad_id: String(l.ad_id), message: `#${r.error.code ?? "?"} ${r.error.message || ""}`.slice(0, 160) });
        continue;
      }
      okAds.push(String(l.ad_id));
      for (const row of r.rows) {
        daily.push({
          ad_id: l.ad_id, day: row.date_start, media_id: l.media_id, spend: int(row.spend), impressions: int(row.impressions),
          reach: row.reach != null ? int(row.reach) : null, profile_visits: int(row.instagram_profile_visits),
          follows: int(row.instagram_profile_follow ?? row.instagram_profile_follow_v2), currency: row.account_currency || l.currency, fetched_at: nowIso,
        });
      }
    }
    // 광고는 보이는데 수치가 전부 권한오류 → 토큰 권한 문제. 덮어쓰지 않는다.
    if (authErr && okAds.length === 0) return await authFail("insights", authErr);

    // 4) 게시물 도달(기간 전체, 계정 단위 1회) — 이번에 수치가 들어온 게시물만
    const { data: prevLinks } = await db.from("ad_links").select("ad_id, media_id").in("ad_id", links.map((l) => l.ad_id));
    const prevMedia = new Map<string, string | null>((prevLinks || []).map((p: { ad_id: string; media_id: string | null }) => [p.ad_id, p.media_id]));
    const touched = new Map<string, { account: string; ads: Set<string> }>();
    for (const d of daily) if (d.media_id && Number(d.spend) > 0) {
      const l = links.find((x) => x.ad_id === d.ad_id)!;
      const k = `${d.media_id}|${l.ad_account_id}`;
      if (!touched.has(k)) touched.set(k, { account: String(l.ad_account_id), ads: new Set() });
    }
    // 같은 게시물에 붙은 광고 전부(이번 창 밖 과거 광고 포함)
    for (const [k, v] of touched) { const m = k.split("|")[0]; links.filter((l) => l.media_id === m && l.ad_account_id === v.account).forEach((l) => v.ads.add(String(l.ad_id))); }
    const reachRows: Record<string, unknown>[] = [];
    const reachFailed: string[] = [];
    for (const [k, v] of touched) {
      const media = k.split("|")[0];
      const ids = [...v.ads];
      const { data: old } = await db.from("ad_daily").select("day").in("ad_id", ids).order("day", { ascending: true }).limit(1);
      const fresh = daily.filter((d) => ids.includes(String(d.ad_id)) && Number(d.spend) > 0).map((d) => String(d.day)).sort();
      const rs = [old?.[0]?.day, fresh[0]].filter(Boolean).sort()[0] as string;
      const re = fresh[fresh.length - 1];
      const filt = encodeURIComponent(JSON.stringify([{ field: "ad.id", operator: "IN", value: ids }]));
      const r = await get(`act_${v.account}/insights?level=account&fields=reach&filtering=${filt}&time_range=${encodeURIComponent(JSON.stringify({ since: rs, until: re }))}`);
      if (r.error) { reachFailed.push(media); continue; }
      const reach = r.data?.data?.[0]?.reach;
      if (reach != null) reachRows.push({ media_id: media, since: rs, until: re, reach: int(reach), fetched_at: nowIso });
    }

    // 5) 쓰기
    const w = async (p: Promise<{ error: { message: string } | null }>, what: string) => { const { error } = await p; if (error) throw new Error(`${what}: ${error.message}`); };
    if (links.length) await w(db.from("ad_links").upsert(links, { onConflict: "ad_id" }), "ad_links");
    if (daily.length) await w(db.from("ad_daily").upsert(daily, { onConflict: "ad_id,day" }), "ad_daily");
    if (reachRows.length) await w(db.from("ad_post_reach").upsert(reachRows, { onConflict: "media_id,since,until" }), "ad_post_reach");
    if (okAds.length) await w(db.from("ad_links").update({ last_ok_at: nowIso }).in("ad_id", okAds), "ad_links ok");
    for (const f of failed) await w(db.from("ad_links").update({ last_fail_at: nowIso, last_error: f.message }).eq("ad_id", f.ad_id), "ad_links fail");

    const mediaChanged = links.filter((l) => prevMedia.has(String(l.ad_id)) && prevMedia.get(String(l.ad_id)) !== l.media_id)
      .map((l) => ({ ad_id: l.ad_id, from: prevMedia.get(String(l.ad_id)), to: l.media_id }));
    const result = failed.length || accountErrors.length ? "partial" : "ok";
    const detail = {
      since, until: today, full, accounts: accounts.map((a) => a.id), ads: links.length, targets: targets.length,
      ok_ads: okAds.length, rows: daily.length, posts: touched.size, failed, account_errors: accountErrors,
      reach_failed: reachFailed, media_changed: mediaChanged,
    };
    await log(result, detail);
    const msg = failed.length ? `광고 ${failed.length}개 수치 못 받음` : accountErrors.length ? `광고계정 ${accountErrors.length}개 못 읽음` : null;
    await setState({ result, auth_error: false, last_ok_at: nowIso, failed_ads: failed.map((f) => f.ad_id), message: msg });
    return json({ ok: true, result, ...detail });
  } catch (e) {
    return await hardFail("run", { message: S(e) });
  }

  // 권한 말고 다른 이유로 통째 실패 — 기존 값은 그대로, 상태만 error
  async function hardFail(step: string, e: GErr) {
    const message = `${step}: ${e.message || ""}`.slice(0, 200);
    await log("error", { auth: false, step, code: e.code ?? null, message });
    await setState({ result: "error", auth_error: false, message });
    return json({ ok: false, step, error: message });
  }
}
