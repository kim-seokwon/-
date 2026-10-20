// 경쟁사 Business Discovery 수집 테스트 — 네트워크·DB 모두 가짜. 토큰은 가짜 문자열.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { DISCOVERY, scrub, splitCaption, syncCompetitors } from "./competitors.ts";
import { FakeDb, fakeFetch } from "./fake_db.ts";

const TOKEN = "FAKE-TOKEN-xyz";
const NOW = new Date("2026-10-20T03:00:00Z"); // KST 12:00
const TODAY = "2026-10-20";
const noSleep = () => Promise.resolve();
const handleOf = (url: string) => decodeURIComponent(url).match(/username\(([^)]+)\)/)?.[1] || "";

const comp = (id: string, handle: string, active = true) => ({ id, handle, name: handle.toUpperCase(), active, memo: `memo-${id}`, ig_business_id: null });
const bd = (handle: string, followers = 1000, media_count = 120) => ({
  business_discovery: {
    id: `ig-${handle}`, username: handle, followers_count: followers, media_count,
    media: { data: [
      { id: "m1", caption: "가을 신상 오픈\n니트 세트 20% 할인", like_count: 30, comments_count: 4, timestamp: "2026-10-19T09:00:00+0000", permalink: `https://www.instagram.com/p/${handle}-1/`, media_url: "https://cdn/x.jpg", media_type: "IMAGE" },
      { id: "m2", caption: "", like_count: 10, comments_count: 0, timestamp: "2026-10-15T09:00:00+0000", permalink: `https://www.instagram.com/p/${handle}-2/`, thumbnail_url: "https://cdn/t.jpg", media_type: "VIDEO" },
      { id: "m3", caption: "옛 글", like_count: 50, comments_count: 2, timestamp: "2026-08-01T09:00:00+0000", permalink: `https://www.instagram.com/p/${handle}-3/` },
    ] },
  },
});

function okRoute(url: string) { return { body: bd(handleOf(url)) }; }

Deno.test("정상: 스냅샷·최근 글 저장, 오래된 글 제외, posts_delta, ig_business_id 채움, sync_log ok", async () => {
  const db = new FakeDb({
    competitors: [comp("c1", "aaa"), comp("c2", "bbb")],
    competitor_snapshots: [{ id: "s0", competitor_id: "c1", snap_date: "2026-10-19", media_count: 117 }],
  });
  const { fetch, calls } = fakeFetch(okRoute);
  const r = await syncCompetitors({ db, fetch, token: TOKEN, igUserId: "OURIG", now: NOW, sleep: noSleep });

  assertEquals([r.active, r.tried, r.ok, r.failed.length, r.posts], [2, 2, 2, 0, 4]);
  assertEquals(calls.length, 2);
  assert(calls[0].startsWith(`${DISCOVERY.GRAPH}/OURIG?fields=`));
  const snaps = db.t("competitor_snapshots").filter((s) => s.snap_date === TODAY);
  assertEquals(snaps.length, 2);
  const s1 = snaps.find((s) => s.competitor_id === "c1")!;
  assertEquals([s1.followers, s1.media_count, s1.posts_delta], [1000, 120, 3]);
  assertEquals(s1.avg_likes, 30); // (30+10+50)/3
  assertEquals(snaps.find((s) => s.competitor_id === "c2")!.posts_delta, 0); // 직전 없음
  const posts = db.t("news_items");
  assertEquals(posts.length, 4); // 핸들당 14일 안 2개
  assert(posts.every((p) => p.kind === "competitor_post" && p.source === "instagram" && p.competitor_id));
  const p1 = posts.find((p) => p.url.endsWith("aaa-1/"))!;
  assertEquals([p1.title, p1.snippet, p1.author], ["가을 신상 오픈", "니트 세트 20% 할인", "aaa"]);
  assertEquals(posts.find((p) => p.url.endsWith("aaa-2/"))!.title, "AAA 새 게시물");
  assertEquals(db.t("competitors").map((c) => c.ig_business_id), ["ig-aaa", "ig-bbb"]);
  const log = db.t("sync_log");
  assertEquals(log.length, 1);
  assertEquals([log[0].type, log[0].result], ["ig:competitors", "ok"]);
});

Deno.test("일부 실패해도 계속: 개인계정 오류·네트워크 오류는 기록만, competitors 는 안 지움, 토큰은 로그에 없음", async () => {
  const db = new FakeDb({ competitors: [comp("c1", "aaa"), comp("c2", "personal"), comp("c3", "netfail"), comp("c4", "ddd")] });
  const { fetch, calls } = fakeFetch((url) => {
    const h = handleOf(url);
    if (h === "personal") return { status: 400, body: { error: { code: 110, message: "Invalid user id" } } };
    if (h === "netfail") return { throws: `connect error ${url}` }; // 원문에 access_token 이 섞여도
    return okRoute(url);
  });
  const r = await syncCompetitors({ db, fetch, token: TOKEN, igUserId: "OURIG", now: NOW, sleep: noSleep });
  assertEquals(calls.length, 4);
  assertEquals([r.ok, r.failed.length], [2, 2]);
  assertEquals(r.failed.map((f) => f.handle), ["netfail", "personal"]); // handle 순으로 돈다
  assert(r.failed[1].reason.includes("110"));
  assertEquals(db.t("competitors").length, 4);
  assertEquals(db.t("competitor_snapshots").length, 2);
  const log = db.t("sync_log")[0];
  assertEquals(log.result, "partial");
  const txt = JSON.stringify(log);
  assert(!txt.includes(TOKEN), "토큰이 sync_log 에 남으면 안 된다");
  assert(txt.includes("connect error https://graph.facebook.com/v20.0/OURIG?…"));
});

Deno.test("inactive 는 부르지도 저장하지도 않는다", async () => {
  const db = new FakeDb({ competitors: [comp("c1", "aaa"), comp("c2", "off", false)] });
  const { fetch, calls } = fakeFetch(okRoute);
  const r = await syncCompetitors({ db, fetch, token: TOKEN, igUserId: "OURIG", now: NOW, sleep: noSleep });
  assertEquals(r.active, 1);
  assertEquals(calls.map(handleOf), ["aaa"]);
  assert(db.t("competitor_snapshots").every((s) => s.competitor_id === "c1"));
});

Deno.test("재실행 idempotent: 같은 날 다시 돌면 호출 0, 강제로 다시 써도 행 수 그대로", async () => {
  const db = new FakeDb({ competitors: [comp("c1", "aaa"), comp("c2", "bbb")] });
  const { fetch, calls } = fakeFetch(okRoute);
  const o = { db, fetch, token: TOKEN, igUserId: "OURIG", now: NOW, sleep: noSleep };
  await syncCompetitors(o);
  const n1 = [db.t("competitor_snapshots").length, db.t("news_items").length];
  const r2 = await syncCompetitors(o);
  assertEquals([r2.skipped_today, r2.tried, calls.length], [2, 0, 2]); // 매시 cron 이어도 하루 1번
  assertEquals(db.t("sync_log").length, 1); // 부른 게 없으면 로그도 없음
  await syncCompetitors({ ...o, force: true });
  assertEquals([db.t("competitor_snapshots").length, db.t("news_items").length], n1);
  assertEquals(n1, [2, 4]);
  // memo·active 는 수집기가 건드리지 않는다
  assertEquals(db.t("competitors").map((c) => [c.memo, c.active]), [["memo-c1", true], ["memo-c2", true]]);
});

Deno.test("dry-run: DB 쓰기 0 (sync_log 포함), 계획 건수만 돌려준다", async () => {
  const db = new FakeDb({ competitors: [comp("c1", "aaa"), comp("c2", "personal")] });
  const { fetch } = fakeFetch((url) => handleOf(url) === "personal" ? { body: { error: { code: 110, message: "x" } } } : okRoute(url));
  const r = await syncCompetitors({ db, fetch, token: TOKEN, igUserId: "OURIG", now: NOW, sleep: noSleep, dryRun: true });
  assertEquals(db.writes, []);
  assertEquals(r.planned, { competitor_snapshots: 1, news_items: 2 });
  assertEquals([r.ok, r.failed.length, r.dry_run], [1, 1, true]);
  assertEquals(db.t("competitors")[0].ig_business_id, null);
});

Deno.test("호출 한도(429/코드 4): 그 실행은 멈추고 남은 곳은 다음으로 미룬다, 간격을 둔다", async () => {
  const db = new FakeDb({ competitors: ["a", "b", "c", "d"].map((h, i) => comp(`c${i}`, h)) });
  const { fetch, calls } = fakeFetch((url) => handleOf(url) === "b" ? { status: 400, body: { error: { code: 4, message: "Application request limit reached" } } } : okRoute(url));
  const gaps: number[] = [];
  const r = await syncCompetitors({ db, fetch, token: TOKEN, igUserId: "OURIG", now: NOW, sleep: (ms) => { gaps.push(ms); return Promise.resolve(); } });
  assertEquals(calls.map(handleOf), ["a", "b"]);
  assertEquals([r.ok, r.rate_limited, r.deferred], [1, true, 2]);
  assertEquals(gaps, [DISCOVERY.GAP_MS]);
  // 다음 실행: a 는 오늘 끝났으니 b 부터
  const { fetch: f2, calls: c2 } = fakeFetch(okRoute);
  await syncCompetitors({ db, fetch: f2, token: TOKEN, igUserId: "OURIG", now: NOW, sleep: noSleep });
  assertEquals(c2.map(handleOf), ["b", "c", "d"]);
  assertEquals(db.t("competitor_snapshots").length, 4);
});

Deno.test("저장 실패도 그 핸들만 실패로 남기고 계속", async () => {
  const db = new FakeDb({ competitors: [comp("c1", "aaa"), comp("c2", "bbb")] });
  db.failUpsert.news_items = "permission denied";
  const { fetch } = fakeFetch(okRoute);
  const r = await syncCompetitors({ db, fetch, token: TOKEN, igUserId: "OURIG", now: NOW, sleep: noSleep });
  assertEquals([r.tried, r.ok, r.failed.length], [2, 0, 2]);
  assertEquals(db.t("sync_log")[0].result, "error");
});

Deno.test("ig_business_id 저장 실패: 그 핸들은 실패로 남고 ok 로 세지 않는다", async () => {
  const db = new FakeDb({ competitors: [comp("c1", "aaa"), { ...comp("c2", "bbb"), ig_business_id: "ig-bbb" }] });
  db.failUpdate.competitors = "permission denied for table competitors";
  const { fetch } = fakeFetch(okRoute);
  const r = await syncCompetitors({ db, fetch, token: TOKEN, igUserId: "OURIG", now: NOW, sleep: noSleep });
  assertEquals([r.tried, r.ok, r.posts], [2, 1, 2]); // bbb 는 이미 id 가 있어 update 안 함 → 성공
  assertEquals(r.failed.map((f) => f.handle), ["aaa"]);
  assert(r.failed[0].reason.includes("ig_business_id 저장"));
  assertEquals(db.t("sync_log")[0].result, "partial");
});

Deno.test("scrub·splitCaption", () => {
  assertEquals(scrub("GET https://g/x?a=1&access_token=EAAB123&b=2 failed"), "GET https://g/x?… failed");
  assertEquals(scrub("token access_token=EAAB123 bad"), "token access_token=*** bad");
  assertEquals(scrub(`bad ${TOKEN} here`, TOKEN), "bad *** here");
  assertEquals(splitCaption("🎉\n\n", "X 새 게시물"), { title: "X 새 게시물", snippet: "" });
  const long = splitCaption("이번 주 새로 나온 겨울 패딩 점퍼와 기모 바지 세트를 소개합니다 많이 사랑해 주세요", "x");
  assert(long.title.length <= 44 && long.snippet.length > 0);
});
