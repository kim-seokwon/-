// ad-report-sync 테스트(기획 §7 8·9·10·11) — 네트워크·DB 가짜. 실제 메타·운영 DB 는 건드리지 않는다.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { addDays, handle, isAuthError } from "./handler.ts";
import { FakeDb } from "../instagram-sync/fake_db.ts";

const TOKEN = "EAAFAKE-SECRET-TOKEN-123";
const NOW = new Date("2026-11-11T03:00:00Z"); // KST 12시 → 8일 창
const env = (extra: Record<string, string> = {}) => (k: string) => ({ CRON_SECRET: "S3CRET", META_ADS_TOKEN: TOKEN, ...extra } as Record<string, string>)[k];
const req = (q = "", secret = "S3CRET") => new Request(`https://fn.local/ad-report-sync${q}`, { method: "POST", headers: { "x-cron-secret": secret } });

const HHH = "17841448539681376", LOHI = "17841464603870428";
function seed(extra: Record<string, Record<string, unknown>[]> = {}) {
  return new FakeDb({
    ig_accounts: [{ id: "a1", brand_id: "b-hhh", ig_id: null, ig_business_id: HHH }, { id: "a2", brand_id: "b-lohi", ig_id: LOHI, ig_business_id: null }],
    ...extra,
  });
}
const ad = (id: string, ig: string, media: { src?: string; eff?: string }, status = "ACTIVE", budget = "10000") => ({
  id, name: `ad_${id}`, effective_status: status, created_time: "2026-11-08T10:00:00+0900", updated_time: "2026-11-09T10:00:00+0900", campaign_id: "C" + id,
  adset: { id: "S" + id, name: `set_${id}`, effective_status: status, daily_budget: budget, start_time: "2026-11-08T00:00:00+0900", end_time: "2026-11-13T23:59:00+0900" },
  creative: { source_instagram_media_id: media.src, effective_instagram_media_id: media.eff, instagram_user_id: ig, instagram_permalink_url: `https://ig/${id}`, thumbnail_url: `https://th/${id}` },
});
const day = (d: string, spend: number, follows: number, cur = "KRW") => ({ date_start: d, date_stop: d, spend: String(spend), impressions: "1000", reach: "800", instagram_profile_visits: "30", instagram_profile_follow: String(follows), account_currency: cur });

type Route = (url: string) => { status?: number; body?: unknown };
// 메서드까지 기록하는 가짜 fetch (테스트 8)
function fake(route: Route) {
  const calls: { url: string; method: string }[] = [];
  const fetch = (url: string, init?: RequestInit) => {
    calls.push({ url, method: (init?.method || "GET").toUpperCase() });
    const r = route(url);
    return Promise.resolve(new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 }));
  };
  return { fetch, calls };
}
// 정상 메타: 계정 919(KRW) + 1859(USD). 919 광고 3개(같은 게시물 2개) + 남의 IG 광고 1개, 1859 에 USD 광고 1개.
function meta(over: Partial<Record<string, (url: string) => { status?: number; body?: unknown } | undefined>> = {}): Route {
  return (url) => {
    for (const [k, f] of Object.entries(over)) if (url.includes(k)) { const r = f!(url); if (r) return r; }
    if (url.includes("/me/adaccounts")) return { body: { data: [{ account_id: "919", currency: "KRW", account_status: 1 }, { account_id: "1859", currency: "USD", account_status: 1 }] } };
    if (url.includes("/act_919/ads")) return { body: { data: [ad("A1", LOHI, { src: "M1", eff: "E1" }), ad("A2", LOHI, { src: "M1" }), ad("A3", HHH, { eff: "M3" }, "ACTIVE", "20000"), ad("X9", "999", { src: "MX" })] } };
    if (url.includes("/act_1859/ads")) return { body: { data: [ad("U1", HHH, { src: "MU" })] } };
    if (url.includes("/A1/insights")) return { body: { data: [day("2026-11-09", 9000, 10), day("2026-11-10", 10000, 9), day("2026-11-11", 3000, 1)] } };
    if (url.includes("/A2/insights")) return { body: { data: [day("2026-11-09", 8000, 6), day("2026-11-10", 10000, 5)] } };
    if (url.includes("/A3/insights")) return { body: { data: [day("2026-11-10", 20000, 0)] } };
    if (url.includes("/U1/insights")) return { body: { data: [day("2026-11-10", 15, 2, "USD")] } };
    if (url.includes("/insights?level=account")) return { body: { data: [{ reach: "3000" }] } };
    if (url.includes("/me/permissions")) return { body: { data: [{ permission: "ads_read", status: "granted" }] } };
    return { status: 404, body: { error: { message: "unrouted " + url.split("?")[0], code: 100 } } };
  };
}
const run = async (db: FakeDb, route: Route, e = env(), q = "") => {
  const f = fake(route);
  const res = await handle(req(q), { db, fetch: f.fetch, env: e, now: () => NOW });
  return { res, body: await res.json(), calls: f.calls };
};

Deno.test("x-cron-secret 없거나 틀리면 401, 메타 호출 0", async () => {
  const f = fake(meta());
  const res = await handle(req("", "WRONG"), { db: seed(), fetch: f.fetch, env: env(), now: () => NOW });
  assertEquals(res.status, 401); assertEquals(f.calls.length, 0);
});

Deno.test("8: 수집이 부르는 모든 요청은 GET — POST·DELETE 0건, 소스에도 쓰기 메서드 없음", async () => {
  const { calls, body } = await run(seed(), meta());
  assert(body.ok, JSON.stringify(body));
  assert(calls.length >= 6);
  assertEquals(calls.filter((c) => c.method !== "GET").length, 0);
  // 정적 확인: 수집 코드에 메서드를 바꾸는 줄이 없다
  for (const f of ["handler.ts", "index.ts"]) {
    const src = await Deno.readTextFile(new URL(`./${f}`, import.meta.url));
    assert(!/method:\s*["'](POST|DELETE|PUT|PATCH)/i.test(src), f);
    assert(!/status=(PAUSED|ACTIVE)|daily_budget=/.test(src), f + ": 광고 변경 파라미터 없음");
  }
});

Deno.test("정상: 우리 IG 광고만 · source 우선 키 · 일별 저장 · 도달은 계정 조회 1회값 · ok", async () => {
  const db = seed();
  const { body, calls } = await run(db, meta());
  assertEquals(body.result, "ok");
  const links = db.t("ad_links");
  assertEquals(links.map((l) => l.ad_id).sort(), ["A1", "A2", "A3", "U1"], "남의 IG(X9) 제외");
  const a1 = links.find((l) => l.ad_id === "A1")!;
  assertEquals([a1.media_id, a1.media_src, a1.brand_id, a1.daily_budget, a1.ad_account_id], ["M1", "source", "b-lohi", 10000, "919"]);
  const a3 = links.find((l) => l.ad_id === "A3")!;
  assertEquals([a3.media_id, a3.media_src, a3.brand_id], ["M3", "effective", "b-hhh"]);
  assertEquals(db.t("ad_daily").length, 7);
  const m1 = db.t("ad_post_reach").find((r) => r.media_id === "M1")!;
  assertEquals([m1.reach, m1.since, m1.until], [3000, "2026-11-09", "2026-11-11"]);
  // M1 도달 조회는 A1·A2 를 함께 넣은 1회
  const reachCalls = calls.filter((c) => c.url.includes("level=account") && decodeURIComponent(c.url).includes('"A1"'));
  assertEquals(reachCalls.length, 1); assert(decodeURIComponent(reachCalls[0].url).includes('"A2"'));
  // 창: KST 12시 → 8일(11-04~11-11)
  assert(decodeURIComponent(calls.find((c) => c.url.includes("/A1/insights"))!.url).includes('"since":"2026-11-04","until":"2026-11-11"'));
  assert(links.every((l) => l.last_ok_at), "모두 last_ok_at");
  const st = db.t("ad_report_state")[0];
  assertEquals([st.result, st.auth_error, st.failed_ads.length], ["ok", false, 0]);
  assertEquals(db.t("sync_log")[0].channel, "meta_ads");
  // 토큰은 URL 에만, 저장값 어디에도 없다
  assert(!JSON.stringify(db.tables).includes(TOKEN));
});

Deno.test("창: 09시(KST) 또는 ?full=1 이면 28일", async () => {
  const at9 = new Date("2026-11-11T00:10:00Z");
  const f = fake(meta());
  await handle(req(), { db: seed(), fetch: f.fetch, env: env(), now: () => at9 });
  assert(decodeURIComponent(f.calls.find((c) => c.url.includes("/A1/insights"))!.url).includes(`"since":"${addDays("2026-11-11", -27)}"`));
  const { calls } = await run(seed(), meta(), env(), "?full=1");
  assert(decodeURIComponent(calls.find((c) => c.url.includes("/A1/insights"))!.url).includes('"since":"2026-10-15"'));
});

Deno.test("9: 부분실패 — 3개 중 1개 insights 오류 → 나머지 저장 · partial · 실패 광고 last_fail_at", async () => {
  const db = seed({ ad_links: [{ ad_id: "A2", media_id: "M1", last_ok_at: "2026-11-10T00:00:00Z" }] });
  const { body } = await run(db, meta({ "/A2/insights": () => ({ status: 500, body: { error: { message: "Please reduce the amount of data access_token=" + TOKEN, code: 1 } } }) }));
  assertEquals(body.result, "partial");
  assertEquals(db.t("ad_daily").filter((d) => d.ad_id === "A2").length, 0);
  assertEquals(db.t("ad_daily").filter((d) => d.ad_id === "A1").length, 3, "나머지는 저장");
  const a2 = db.t("ad_links").find((l) => l.ad_id === "A2")!;
  assert(a2.last_fail_at > a2.last_ok_at, "화면 '보류 · 갱신 실패' 조건(any_failed)");
  assert(!String(a2.last_error).includes(TOKEN), "오류문 scrub");
  const log = db.t("sync_log")[0];
  assertEquals(log.result, "partial"); assertEquals(log.detail.failed.map((f: { ad_id: string }) => f.ad_id), ["A2"]);
  assertEquals(db.t("ad_report_state")[0].failed_ads, ["A2"]);
  assert(!JSON.stringify(db.tables).includes(TOKEN));
});

for (const [name, err] of [["190 만료", { message: "Error validating access token: Session has expired. token=" + TOKEN, code: 190 }], ["#200 권한", { message: "(#200) Requires ads_read permission", code: 200 }]] as const) {
  Deno.test(`10: 권한오류 ${name} → 기존 행 그대로 · sync_log error + account_check · scrub`, async () => {
    const old = { ad_id: "A1", media_id: "M1", effective_status: "ACTIVE", last_ok_at: "2026-11-10T00:00:00Z" };
    const db = seed({ ad_links: [{ ...old }], ad_daily: [{ ad_id: "A1", day: "2026-11-09", spend: 9000, follows: 10 }], ad_report_state: [{ id: 1, result: "ok", last_ok_at: "2026-11-10T00:00:00Z" }] });
    const before = JSON.stringify({ l: db.t("ad_links"), d: db.t("ad_daily") });
    const perm = err.code === 190 ? { status: 400, body: { error: err } } : { body: { data: [{ permission: "pages_show_list", status: "granted" }] } };
    const { body } = await run(db, meta({ "/act_919/ads": () => ({ status: 400, body: { error: err } }), "/me/permissions": () => perm }), env({ AD_ACCOUNT_IDS: "act_919" }));
    assertEquals(body.auth_error, true);
    assertEquals(JSON.stringify({ l: db.t("ad_links"), d: db.t("ad_daily") }), before, "덮어쓰지 않음");
    const log = db.t("sync_log")[0];
    assertEquals([log.result, log.detail.auth, log.detail.code], ["error", true, err.code]);
    assertEquals(log.detail.account_check, err.code === 190 ? { token_valid: false, code: 190 } : { token_valid: true, ads_read: false });
    const st = db.t("ad_report_state")[0];
    assertEquals([st.result, st.auth_error, st.last_ok_at], ["error", true, "2026-11-10T00:00:00Z"], "마지막 성공 시각 유지");
    assert(!JSON.stringify(db.tables).includes(TOKEN), "토큰 문자열 없음");
  });
}

Deno.test("10: 광고 목록은 되는데 insights 가 전부 권한오류 → 아무것도 안 씀", async () => {
  const db = seed();
  const deny = () => ({ status: 403, body: { error: { message: "(#10) no permission", code: 10 } } });
  await run(db, meta({ "/A1/insights": deny, "/A2/insights": deny, "/A3/insights": deny, "/U1/insights": deny }));
  assertEquals(db.t("ad_links").length, 0); assertEquals(db.t("ad_daily").length, 0);
  assertEquals(db.t("ad_report_state")[0].auth_error, true);
});

Deno.test("11: 소급 변경 — 같은 (ad_id, day) 두 번 수집하면 1행 · 최신 값", async () => {
  const db = seed();
  await run(db, meta());
  await run(db, meta({ "/A1/insights": () => ({ body: { data: [day("2026-11-09", 9500, 11)] } }) }));
  const rows = db.t("ad_daily").filter((d) => d.ad_id === "A1" && d.day === "2026-11-09");
  assertEquals(rows.length, 1); assertEquals([rows[0].spend, rows[0].follows], [9500, 11]);
});

Deno.test("11: 통화 USD 광고는 원값·통화를 그대로 남긴다(판정은 화면에서 '통화 다름' 제외)", async () => {
  const db = seed();
  await run(db, meta());
  const u = db.t("ad_daily").find((d) => d.ad_id === "U1")!;
  assertEquals([u.currency, u.spend], ["USD", 15]);
  assertEquals(db.t("ad_links").find((l) => l.ad_id === "U1")!.currency, "USD");
});

Deno.test("게시물이 바뀐 광고는 sync_log 에 남긴다", async () => {
  const db = seed({ ad_links: [{ ad_id: "A1", media_id: "OLD" }] });
  await run(db, meta());
  assertEquals(db.t("sync_log")[0].detail.media_changed, [{ ad_id: "A1", from: "OLD", to: "M1" }]);
});

Deno.test("토큰 없음 → error 상태, 메타 호출 0", async () => {
  const db = seed();
  const { calls } = await run(db, meta(), env({ META_ADS_TOKEN: "" }));
  assertEquals(calls.length, 0); assertEquals(db.t("ad_report_state")[0].auth_error, true);
});

Deno.test("isAuthError 분기", () => {
  assert(isAuthError({ code: 190 })); assert(isAuthError({ code: 200 })); assert(isAuthError({ code: 10 })); assert(isAuthError({ code: 294 }));
  assert(!isAuthError({ code: 1 })); assert(!isAuthError({ code: 17 })); assert(!isAuthError({ code: 100 })); assert(!isAuthError(null));
});

Deno.test("107 판정판: 세트명·세트상태·세트시작일을 ad_links 에 저장(광고명과 다를 수 있음)", async () => {
  const db = seed();
  const { body } = await run(db, meta());
  assert(body.ok, JSON.stringify(body));
  const a1 = db.t("ad_links").find((r) => r.ad_id === "A1")!;
  assertEquals([a1.ad_name, a1.adset_name, a1.adset_status, a1.adset_start], ["ad_A1", "set_A1", "ACTIVE", "2026-11-08T00:00:00+0900"]);
});

// ---- 110 광고 인사이트 ----
const ad110 = (id: string, setBudget: string | null, campBudget: string | null, targeting?: Record<string, unknown>) => {
  const a = ad(id, LOHI, { src: "M" + id }, "ACTIVE", setBudget ?? "") as Record<string, any>; // deno-lint-ignore no-explicit-any
  if (!setBudget) delete a.adset.daily_budget;
  a.campaign = { id: "C" + id, daily_budget: campBudget ?? undefined };
  if (targeting) a.adset.targeting = targeting;
  return a;
};
const day110 = (d: string, spend: number, follows: number, lc: number) => ({ ...day(d, spend, follows), clicks: String(lc + 20), inline_link_clicks: String(lc), ctr: "8.5", frequency: "1.04" });
function meta110(cumStatus = 200) {
  return meta({
    "/act_919/ads": () => ({ body: { data: [
      ad110("B1", "20000", null, { age_min: 25, age_max: 44, genders: [2], geo_locations: { countries: ["KR"] }, flexible_spec: [{ interests: [{ name: "패션" }, { name: "니트" }, { name: "쇼핑" }] }] }),
      ad110("B2", null, "80000"),
    ] } }),
    "/act_1859/ads": () => ({ body: { data: [] } }),
    "/B1/insights": () => ({ body: { data: [day110("2026-11-09", 30000, 100, 800), day110("2026-11-10", 30000, 100, 800), day110("2026-11-11", 30000, 100, 800)] } }),
    "/B2/insights": () => ({ body: { data: [day110("2026-11-10", 5000, 1, 10)] } }),
    "level=ad&date_preset=maximum": () => cumStatus === 200
      ? { body: { data: [{ ad_id: "B1", reach: "20000", impressions: "26000", frequency: "1.3" }, { ad_id: "B2", reach: "900", impressions: "1000", frequency: "1.11" }] } }
      : { status: cumStatus, body: { error: { message: "busy", code: 2 } } },
  });
}

Deno.test("110: 클릭·링크클릭·CTR·빈도 저장 · 타기팅 요약 · 예산 스냅샷(세트 없으면 캠페인)", async () => {
  const db = seed();
  const { body } = await run(db, meta110());
  assert(body.ok, JSON.stringify(body));
  const r = db.t("ad_daily").find((x) => x.ad_id === "B1" && x.day === "2026-11-10")!;
  assertEquals([r.clicks, r.link_clicks, r.ctr, r.frequency], [820, 800, 8.5, 1.04]);
  const b1 = db.t("ad_links").find((x) => x.ad_id === "B1")!;
  assertEquals([b1.target_age, b1.target_gender, b1.target_region], ["25-44", "여성", "대한민국"]);
  assertEquals(b1.target_summary, "25-44세 · 여성 · 대한민국 · 관심사 패션·니트 외 1");
  const b2 = db.t("ad_links").find((x) => x.ad_id === "B2")!;
  assertEquals([b2.target_summary, b2.daily_budget], [null, null], "타기팅 없으면 비움(화면 '—')");
  const bl = db.t("ad_budget_log").sort((a, b) => String(a.ad_id).localeCompare(String(b.ad_id)));
  assertEquals(bl.map((x) => [x.ad_id, x.day, x.daily_budget, x.budget_level]), [["B1", "2026-11-11", 20000, "adset"], ["B2", "2026-11-11", 80000, "campaign"]]);
});

Deno.test("110: 누적 스냅샷은 마지막 노출일 행에 · 다음 수집이 과거 날 누적을 지우지 않는다 · 호출은 계정당 1회 GET", async () => {
  const db = seed();
  const { calls } = await run(db, meta110());
  const cumCalls = calls.filter((c) => c.url.includes("date_preset=maximum"));
  assertEquals(cumCalls.length, 1); assert(cumCalls.every((c) => c.method === "GET"));
  const b1 = db.t("ad_daily").filter((x) => x.ad_id === "B1");
  assertEquals(b1.find((x) => x.day === "2026-11-11")!.cum_frequency, 1.3);
  assertEquals(b1.find((x) => x.day === "2026-11-10")!.cum_frequency, undefined, "과거 날은 미확인으로 둔다");
  // 다음날 수집: 같은 창을 다시 받아도 11-11 누적값은 남는다
  const later = async () => { const f = fake(meta110(500)); return await handle(req(), { db, fetch: f.fetch, env: env(), now: () => new Date("2026-11-12T03:00:00Z") }); };
  const res = await (await later()).json();
  assertEquals(res.cum_failed, ["919"], "누적 실패는 기록만, 수집은 ok");
  assertEquals(res.result, "ok");
  assertEquals(db.t("ad_daily").find((x) => x.ad_id === "B1" && x.day === "2026-11-11")!.cum_frequency, 1.3);
});

Deno.test("110: 수집 뒤 피로도 판정을 ad_fatigue 에 남긴다(근거 포함) · 지출 3일 미만은 판정 행 없음", async () => {
  const db = seed();
  const { body } = await run(db, meta110());
  assertEquals(body.judged, 1); assertEquals(body.judge_failed, []);
  const f = db.t("ad_fatigue");
  assertEquals(f.length, 1);
  assertEquals([f[0].ad_id, f[0].day, f[0].state, f[0].baseline_cpf, f[0].rule_version], ["B1", "2026-11-11", "fresh", 300, "110-1"]);
  assert(Array.isArray(f[0].reasons) && (f[0].reasons as string[]).some((s) => s.includes("누적 빈도")));
  assert(!JSON.stringify(db.tables).includes(TOKEN));
});

Deno.test("110: 판정 중 DB 오류가 나도 수집 결과는 ok 로 남는다", async () => {
  const db = seed();
  const orig = db.from.bind(db);
  // deno-lint-ignore no-explicit-any
  (db as any).from = (name: string) => name === "ad_fatigue" ? { upsert: () => Promise.resolve({ error: { message: "boom" } }) } : orig(name);
  const { body } = await run(db, meta110());
  assertEquals(body.result, "ok"); assertEquals(body.judged, 0);
  assertEquals(body.judge_failed.length, 1);
  assertEquals(db.t("ad_daily").filter((x) => x.ad_id === "B1").length, 3);
});
