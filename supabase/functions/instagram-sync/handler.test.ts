// instagram-sync 회귀 테스트 — 우리 계정 ig_snapshots 수집이 그대로인지 + 경쟁사 단계 연결. 네트워크·DB 가짜.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handle } from "./handler.ts";
import { FakeDb, fakeFetch } from "./fake_db.ts";

const PID = "554876437711515";
const env = (extra: Record<string, string> = {}) => (k: string) => ({ CRON_SECRET: "S3CRET", ...extra } as Record<string, string>)[k];
const req = (q = "", secret = "S3CRET") => new Request(`https://fn.local/instagram-sync${q}`, { method: "POST", headers: { "x-cron-secret": secret } });
const noSleep = () => Promise.resolve();

function seed() {
  return new FakeDb({
    ig_token: [{ id: 1, token: "FAKE-USER-TOKEN" }],
    ig_accounts: [{ id: "a1", username: "hhh_hiheyho", brand_id: "b1", active: true, ig_business_id: null, page_id: PID, created_at: "2026-08-11" }],
    ig_snapshots: [{ id: "old", account_id: "a1", snap_date: "2000-01-01", media_count: 38 }],
    competitors: [{ id: "c1", handle: "aaa", name: "AAA", active: true, memo: null, ig_business_id: null }],
  });
}
function graph(url: string) {
  if (url.includes("/oauth/access_token")) return { body: { access_token: "FAKE-NEW-TOKEN" } };
  if (decodeURIComponent(url).includes("business_discovery")) return { body: { business_discovery: {
    id: "ig-aaa", followers_count: 900, media_count: 10,
    media: { data: [{ id: "m1", caption: "새 글", like_count: 3, comments_count: 1, timestamp: new Date().toISOString(), permalink: "https://www.instagram.com/p/aaa1/" }] } } } };
  if (url.includes("/me/accounts")) return { body: { data: [{ id: PID, access_token: "FAKE-PAGE-TOKEN" }] } };
  if (url.includes(`/${PID}?fields=connected_instagram_account`)) return { body: { connected_instagram_account: { id: "IG1", username: "hhh_hiheyho", followers_count: 500, media_count: 40 } } };
  if (url.includes("?fields=connected_instagram_account")) return { body: { id: "x" } }; // IG 없는 페이지
  if (url.includes("/IG1/media?")) return { body: { data: [{ comments_count: 2, like_count: 5 }, { comments_count: 1, like_count: 3 }] } };
  return { status: 404, body: { error: { message: "unexpected " + url.split("?")[0] } } };
}

Deno.test("cron secret 없으면 401, 아무것도 안 한다", async () => {
  const db = seed();
  const { fetch, calls } = fakeFetch(graph);
  const r = await handle(req("", "wrong"), { db, fetch, env: env(), sleep: noSleep });
  assertEquals(r.status, 401);
  assertEquals([calls.length, db.writes.length], [0, 0]);
});

Deno.test("회귀: 우리 계정 ig_snapshots·ig:sync 는 그대로 + 이어서 경쟁사 수집", async () => {
  const db = seed();
  const { fetch, calls } = fakeFetch(graph);
  const r = await handle(req(), { db, fetch, env: env(), sleep: noSleep });
  const j = await r.json();
  assertEquals([r.status, j.ok, j.collected], [200, true, 1]);
  const snap = db.t("ig_snapshots").find((s) => s.id !== "old")!;
  assertEquals([snap.account_id, snap.followers, snap.media_count, snap.posts_delta, snap.comments_total, snap.likes_total, snap.source], ["a1", 500, 40, 2, 3, 8, "meta"]);
  assertEquals(db.t("ig_accounts")[0].ig_business_id, "IG1");
  const logs = db.t("sync_log").map((l) => `${l.type}:${l.result}`);
  assertEquals(logs, ["ig:sync:ok", "ig:competitors:ok"]);
  // 경쟁사: 우리 IG1 을 주체로, 페이지 토큰으로 부른다
  const bdCall = calls.find((u) => decodeURIComponent(u).includes("business_discovery"))!;
  assert(bdCall.includes("/IG1?fields=") && bdCall.includes("access_token=FAKE-PAGE-TOKEN"));
  assertEquals(j.competitors.ok, 1);
  assertEquals(db.t("competitor_snapshots").length, 1);
  assertEquals(db.t("news_items").length, 1);
});

Deno.test("경쟁사 단계가 터져도 우리 계정 결과는 ok 로 남는다", async () => {
  const db = seed();
  const orig = db.from.bind(db);
  db.from = (name: string) => { if (name === "competitors") throw new Error("boom"); return orig(name); };
  const { fetch } = fakeFetch(graph);
  const j = await (await handle(req(), { db, fetch, env: env(), sleep: noSleep })).json();
  assertEquals([j.ok, j.collected, j.competitors], [true, 1, null]);
  assertEquals(db.t("sync_log").map((l) => `${l.type}:${l.result}`), ["ig:sync:ok", "ig:competitors:error"]);
});

Deno.test("?dry_run=1: 토큰 재교환·ig_snapshots·sync_log 포함 DB 쓰기 0, 경쟁사 계획만", async () => {
  const db = seed();
  db.t("ig_accounts")[0].ig_business_id = "IG1";
  const { fetch, calls } = fakeFetch(graph);
  const j = await (await handle(req("?dry_run=1"), { db, fetch, env: env({ META_APP_ID: "app", META_APP_SECRET: "sec" }), sleep: noSleep })).json();
  assertEquals(db.writes, []);
  assert(!calls.some((u) => u.includes("/oauth/access_token")));
  assert(!calls.some((u) => u.includes("/media?")));
  assertEquals([j.ok, j.dry_run, j.competitors.ok], [true, true, 1]);
  assertEquals(j.competitors.planned, { competitor_snapshots: 1, news_items: 1 });
});

Deno.test("META_APP_ID 있으면 평소처럼 장기 토큰 재교환 후 ig_token 갱신 (기존 동작)", async () => {
  const db = seed();
  const { fetch, calls } = fakeFetch(graph);
  await handle(req(), { db, fetch, env: env({ META_APP_ID: "app", META_APP_SECRET: "sec" }), sleep: noSleep });
  assert(calls[0].includes("/oauth/access_token"));
  assertEquals(db.t("ig_token")[0].token, "FAKE-NEW-TOKEN");
});

for (const [label, route] of [
  ["Meta 오류 JSON", { body: { error: { message: "Error validating access token" } } }],
  ["fetch 예외", { throws: "network down" }],
] as const) {
  Deno.test(`?dry_run=1 + me/accounts ${label}: sync_log 포함 DB 쓰기 0`, async () => {
    const db = seed();
    db.t("ig_accounts")[0].ig_business_id = "IG1";
    const { fetch, calls } = fakeFetch((url) => url.includes("/me/accounts") ? route : graph(url));
    const r = await handle(req("?dry_run=1"), { db, fetch, env: env({ META_APP_ID: "app", META_APP_SECRET: "sec" }), sleep: noSleep });
    const j = await r.json();
    assertEquals(db.writes, []);
    assertEquals(db.t("sync_log").length, 0);
    assert(calls.some((u) => u.includes("/me/accounts")));
    // 페이지 토큰이 없으면 사용자 토큰으로 계속 — 계획만 돌려준다
    assertEquals([j.ok, j.dry_run, j.competitors.ok], [true, true, 1]);
  });
}

Deno.test("평소 실행의 me/accounts 오류는 지금처럼 warn 로그를 남긴다 (회귀)", async () => {
  const db = seed();
  const { fetch } = fakeFetch((url) => url.includes("/me/accounts") ? { body: { error: { message: "bad" } } } : graph(url));
  await handle(req(), { db, fetch, env: env(), sleep: noSleep });
  assertEquals(db.t("sync_log")[0].result, "warn");
});
