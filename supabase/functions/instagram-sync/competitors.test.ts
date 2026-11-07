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

Deno.test("일부 실패해도 계속: 개인계정(조회 불가)·네트워크 오류는 따로 기록만, competitors 는 안 지움, 토큰은 로그에 없음", async () => {
  const db = new FakeDb({ competitors: [comp("c1", "aaa"), comp("c2", "personal"), comp("c3", "netfail"), comp("c4", "ddd")] });
  const { fetch, calls } = fakeFetch((url) => {
    const h = handleOf(url);
    if (h === "personal") return { status: 400, body: { error: { code: 110, message: "Invalid user id" } } };
    if (h === "netfail") return { throws: `connect error ${url}` }; // 원문에 access_token 이 섞여도
    return okRoute(url);
  });
  const r = await syncCompetitors({ db, fetch, token: TOKEN, igUserId: "OURIG", now: NOW, sleep: noSleep });
  assertEquals(calls.length, 4);
  assertEquals([r.ok, r.failed.length, r.unreachable.length], [2, 1, 1]);
  assertEquals(r.failed.map((f) => f.handle), ["netfail"]);
  assertEquals(r.unreachable.map((f) => f.handle), ["personal"]);
  assert(r.unreachable[0].reason.includes("110") && r.unreachable[0].reason.startsWith("조회 불가"));
  assertEquals(db.t("competitors").length, 4);
  assertEquals(db.t("competitor_snapshots").length, 2);
  const log = db.t("sync_log")[0];
  assertEquals(log.result, "partial"); // 네트워크 오류는 진짜 실패
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
  assertEquals([r.ok, r.failed.length, r.unreachable.length, r.dry_run], [1, 0, 1, true]);
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

// ── 조회 불가 핸들(11-04 creambrulee.kr '110 Invalid user id' 가 매시 재시도로 ig:competitors 를 하루 23번 error 로 만들던 것) ──
const isSelf = (url: string) => !decodeURIComponent(url).includes("business_discovery");
const SELF_OK = { body: { id: "OURIG", username: "ours" } };
const SELF_NG = { status: 400, body: { error: { code: 190, message: "Error validating access token: session invalidated" } } };
const E110 = { status: 400, body: { error: { code: 110, message: "Invalid user id" } } };
const RO = (url: string) => isSelf(url) ? SELF_OK : handleOf(url) === "gone" ? E110 : okRoute(url);
const disc = (calls: string[]) => calls.filter((u) => !isSelf(u)).map(handleOf);
const LATER = new Date(NOW.getTime() + 3600e3);

Deno.test("조회 불가 1곳: 첫 실행 ok(unreachable 에 사유) · 그날 매시 재실행은 호출 0·로그 0 · 나머지 영향 0", async () => {
  const db = new FakeDb({ competitors: [comp("c1", "aaa"), comp("c2", "gone"), comp("c3", "zzz")] });
  const { fetch, calls } = fakeFetch(RO);
  const o = { db, fetch, token: TOKEN, igUserId: "OURIG", now: NOW, sleep: noSleep };
  const r1 = await syncCompetitors(o);
  assertEquals([r1.ok, r1.failed.length, r1.unreachable.map((u) => u.handle)], [2, 0, ["gone"]]);
  const log = db.t("sync_log");
  assertEquals(log.length, 1);
  assertEquals(log[0].result, "ok");
  assertEquals(log[0].detail.unreachable[0].handle, "gone");
  assert(log[0].detail.unreachable[0].reason.includes("110 Invalid user id"));
  for (let h = 1; h <= 23; h++) await syncCompetitors({ ...o, now: new Date(NOW.getTime() + h * 20 * 60e3) }); // 같은 KST 날짜 안(12:00~19:40)
  assertEquals(calls.map(handleOf), ["aaa", "gone", "zzz"]); // gone 을 다시 부르지 않는다
  assertEquals(db.t("sync_log").map((l) => l.result), ["ok"]); // error 줄 0
  assertEquals(db.t("competitors").length, 3); // 지우지 않는다(사람이 고칠 수 있게)
  assertEquals(db.t("competitor_snapshots").length, 2);
});

Deno.test("그날 다른 곳을 새로 부르면 그 로그에도 조회 불가가 이어 적힌다(화면 표시가 사라지지 않게)", async () => {
  const db = new FakeDb({ competitors: [comp("c1", "aaa"), comp("c2", "gone")] });
  const { fetch, calls } = fakeFetch(RO);
  const o = { db, fetch, token: TOKEN, igUserId: "OURIG", sleep: noSleep };
  await syncCompetitors({ ...o, now: NOW });
  db.t("sync_log")[0].run_at = NOW.toISOString();
  db.t("competitors").push(comp("c3", "newbie"));
  const r = await syncCompetitors({ ...o, now: LATER });
  assertEquals([r.tried, r.skipped_unreachable, r.unreachable.map((u) => u.handle)], [1, 1, ["gone"]]);
  assertEquals(calls.map(handleOf), ["aaa", "gone", "newbie"]);
  const last = db.t("sync_log")[1];
  assertEquals([last.result, last.detail.unreachable[0].handle], ["ok", "gone"]);
  assert(last.detail.unreachable[0].reason.includes("Invalid user id"));
});

Deno.test("사람이 핸들을 고치면 같은 날이라도 그 시간에 다시 묻는다 · 다음 날엔 한 번 다시 묻는다", async () => {
  const db = new FakeDb({ competitors: [comp("c1", "aaa"), comp("c2", "gone")] });
  const { fetch, calls } = fakeFetch(RO);
  const o = { db, fetch, token: TOKEN, igUserId: "OURIG", sleep: noSleep };
  await syncCompetitors({ ...o, now: NOW });
  db.t("competitors")[1].handle = "fixed";
  const r = await syncCompetitors({ ...o, now: LATER });
  assertEquals([r.ok, r.unreachable.length], [1, 0]);
  assertEquals(calls.map(handleOf), ["aaa", "gone", "fixed"]);
  // 다음 날: 그대로 안 되는 핸들은 하루 한 번만 다시 묻는다
  const db2 = new FakeDb({ competitors: [comp("c1", "aaa"), comp("c2", "gone")] });
  const f2 = fakeFetch(RO);
  await syncCompetitors({ ...o, db: db2, fetch: f2.fetch, now: NOW });
  await syncCompetitors({ ...o, db: db2, fetch: f2.fetch, now: LATER });
  await syncCompetitors({ ...o, db: db2, fetch: f2.fetch, now: new Date(NOW.getTime() + 864e5) });
  assertEquals(disc(f2.calls).filter((h) => h === "gone"), ["gone", "gone"]);
});

Deno.test("일시 오류(토큰 190·서버 500)는 조회 불가가 아니다 — 실패로 남고 다음 시간에 다시 부른다", async () => {
  const db = new FakeDb({ competitors: [comp("c1", "aaa"), comp("c2", "tok")] });
  const { fetch, calls } = fakeFetch((url) => handleOf(url) === "tok" ? { status: 400, body: { error: { code: 190, message: "Error validating access token" } } } : okRoute(url));
  const o = { db, fetch, token: TOKEN, igUserId: "OURIG", sleep: noSleep };
  const r = await syncCompetitors({ ...o, now: NOW });
  assertEquals([r.failed.map((f) => f.handle), r.unreachable.length], [["tok"], 0]);
  assertEquals(db.t("sync_log")[0].result, "partial");
  await syncCompetitors({ ...o, now: LATER });
  assertEquals(calls.map(handleOf), ["aaa", "tok", "tok"]);
});

Deno.test("force 는 조회 불가 핸들도 다시 부른다", async () => {
  const db = new FakeDb({ competitors: [comp("c2", "gone")] });
  const { fetch, calls } = fakeFetch(RO);
  const o = { db, fetch, token: TOKEN, igUserId: "OURIG", now: NOW, sleep: noSleep };
  await syncCompetitors(o);
  await syncCompetitors({ ...o, force: true });
  assertEquals(disc(calls), ["gone", "gone"]);
});

// ── 반려1·2(C안): 조회 불가 확정은 '지금' 주체 계정이 살아 있을 때만 — 이번 실행 성공, 없으면 같은 실행에서 주체 계정 1회 확인 ──
Deno.test("C① 1곳 110 + 나머지 성공 = ok · unreachable 1 · 주체 확인 호출 없음", async () => {
  const db = new FakeDb({ competitors: [comp("c1", "aaa"), comp("c2", "gone"), comp("c3", "zzz")] });
  const { fetch, calls } = fakeFetch(RO);
  const r = await syncCompetitors({ db, fetch, token: TOKEN, igUserId: "OURIG", now: NOW, sleep: noSleep });
  assertEquals([r.ok, r.failed.length, r.unreachable.map((u) => u.handle), r.account_check, r.self_checked], [2, 0, ["gone"], false, false]);
  assertEquals(calls.filter(isSelf).length, 0);
  assertEquals(db.t("sync_log")[0].result, "ok");
});

//  오전: aaa 성공 · gone 일시 오류(500) → 오후: gone 만 다시 불러 110 (운영 tried=1 모양)
const morningThenRetry = (selfRoute: { status?: number; body: unknown }) => {
  let first = true;
  return fakeFetch((url) => isSelf(url) ? selfRoute : handleOf(url) !== "gone" ? okRoute(url)
    : first ? (first = false, { status: 500, body: { error: { code: 2, message: "temporary" } } }) : E110);
};

Deno.test("C② 오전 성공 뒤 1곳만 재시도 110 + 주체 확인 성공 = ok · unreachable · 그날 다시 안 부름", async () => {
  const db = new FakeDb({ competitors: [comp("c1", "aaa"), comp("c2", "gone")] });
  const { fetch, calls } = morningThenRetry(SELF_OK);
  const o = { db, fetch, token: TOKEN, igUserId: "OURIG", sleep: noSleep };
  await syncCompetitors({ ...o, now: NOW });
  const r = await syncCompetitors({ ...o, now: LATER });
  assertEquals([r.tried, r.ok, r.failed.length, r.unreachable.map((u) => u.handle), r.account_check, r.self_checked], [1, 0, 0, ["gone"], false, true]);
  assertEquals(db.t("sync_log").map((l) => l.result), ["partial", "ok"]);
  await syncCompetitors({ ...o, now: new Date(LATER.getTime() + 3600e3) });
  assertEquals(disc(calls), ["aaa", "gone", "gone"]);
  assertEquals(calls.filter(isSelf).length, 1); // 추가 호출은 그 실행 1회뿐
});

Deno.test("C③ 같은 상황 + 주체 확인 실패(오전 뒤 토큰 깨짐) = error · account_check · 다음 시간 재시도", async () => {
  const db = new FakeDb({ competitors: [comp("c1", "aaa"), comp("c2", "gone")] });
  const { fetch, calls } = morningThenRetry(SELF_NG);
  const o = { db, fetch, token: TOKEN, igUserId: "OURIG", sleep: noSleep };
  await syncCompetitors({ ...o, now: NOW });
  const r = await syncCompetitors({ ...o, now: LATER });
  assertEquals([r.ok, r.unreachable.length, r.failed.map((f) => f.handle), r.account_check, r.self_checked], [0, 0, ["gone"], true, true]);
  assert(r.failed[0].reason.includes("주체 계정") && r.failed[0].reason.includes("190") && r.failed[0].reason.includes("110"));
  const log = db.t("sync_log")[1];
  assertEquals([log.result, log.detail.account_check, log.detail.unreachable.length], ["error", true, 0]);
  assert(!JSON.stringify(db.t("sync_log")).includes(TOKEN));
  await syncCompetitors({ ...o, now: new Date(LATER.getTime() + 3600e3) });
  assertEquals(disc(calls), ["aaa", "gone", "gone", "gone"]); // 숨기지 않고 매시 다시 묻는다
});

Deno.test("C④ 전부 110 + 주체 확인 실패 = error · failed · 다음 시간 재시도", async () => {
  const db = new FakeDb({ competitors: [comp("c1", "gone"), comp("c2", "gone2")] });
  const { fetch, calls } = fakeFetch(() => E110); // 주체 확인도 110
  const o = { db, fetch, token: TOKEN, igUserId: "BROKEN", sleep: noSleep };
  const r = await syncCompetitors({ ...o, now: NOW });
  assertEquals([r.ok, r.unreachable.length, r.failed.map((f) => f.handle), r.account_check], [0, 0, ["gone", "gone2"], true]);
  assertEquals(db.t("sync_log")[0].result, "error");
  await syncCompetitors({ ...o, now: LATER });
  assertEquals(disc(calls).length, 4);
  assertEquals(db.t("sync_log").map((l) => l.result), ["error", "error"]);
});

Deno.test("C④' 주체 확인이 다른 계정 id 를 돌려주거나 요청이 끊겨도 살아 있다고 보지 않는다", async () => {
  for (const self of [{ body: { id: "SOMEONE-ELSE" } }, { throws: "network down" }]) {
    const db = new FakeDb({ competitors: [comp("c2", "gone")] });
    const { fetch } = fakeFetch((url) => isSelf(url) ? self : E110);
    const r = await syncCompetitors({ db, fetch, token: TOKEN, igUserId: "OURIG", now: NOW, sleep: noSleep });
    assertEquals([r.unreachable.length, r.account_check, db.t("sync_log")[0].result], [0, true, "error"]);
  }
});

Deno.test("C⑤ 190·10·500 은 조회 불가가 아니다 — failed 유지 · 주체 확인 안 함", async () => {
  const errs: Record<string, { status: number; body: unknown }> = {
    t190: { status: 400, body: { error: { code: 190, message: "Error validating access token" } } },
    p10: { status: 400, body: { error: { code: 10, message: "Application does not have permission for this action" } } },
    s500: { status: 500, body: { error: { code: 1, message: "An unknown error has occurred" } } },
  };
  const db = new FakeDb({ competitors: [comp("c1", "aaa"), comp("c2", "t190"), comp("c3", "p10"), comp("c4", "s500")] });
  const { fetch, calls } = fakeFetch((url) => isSelf(url) ? SELF_OK : errs[handleOf(url)] || okRoute(url));
  const r = await syncCompetitors({ db, fetch, token: TOKEN, igUserId: "OURIG", now: NOW, sleep: noSleep });
  assertEquals([r.ok, r.unreachable.length, r.failed.map((f) => f.handle).sort(), r.self_checked], [1, 0, ["p10", "s500", "t190"], false]);
  assertEquals(calls.filter(isSelf).length, 0);
  assertEquals(db.t("sync_log")[0].result, "partial");
});
