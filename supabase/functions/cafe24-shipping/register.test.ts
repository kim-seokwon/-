import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { EXT_TIMEOUT_MS, matchShipments, registerOne, shipmentRequestBody, STALE_MS, type RegisterDeps, type RegJob, type Shipment } from "./register.ts";
import { CONFIRM_WAIT_MS, unknownState } from "../_shared/ship-unknown.ts";

const INV = "6013082362377";
const ITEMS = ["20261015-0000001-01", "20261015-0000001-02"];
const TIMEOUT = () => new DOMException("Signal timed out.", "TimeoutError");

Deno.test("본문: 카페24 공식 형식 { shop_no, request:{...} }, 상태는 배송대기(standby)", () => {
  const b = shipmentRequestBody(INV, "0012", ["20261015-0000001-01"]);
  assertEquals(b, { shop_no: 1, request: { tracking_no: INV, shipping_company_code: "0012", status: "standby", order_item_code: ["20261015-0000001-01"] } });
  assertEquals("shipment" in b, false);
  assertEquals(EXT_TIMEOUT_MS * 2 < STALE_MS, true); // GET 1번 + POST 1번이 잠금 안에 끝난다
});

const tick = () => new Promise((r) => setTimeout(r, 0));

// 가짜 DB(claim_shipment_registration 규칙 + attempts 조건부 update) + 가짜 카페24
function world() {
  let t = Date.parse("2026-10-15T03:00:00Z");
  let job: RegJob = { status: "issued", invoice_no: INV, attempts: 1, last_error: null, updated_at: new Date(t).toISOString() };
  const cafe24: Shipment[] = [];
  let hidden = false;   // 받았지만 GET 에 아직 안 보임(반영 지연)
  const posts: unknown[] = [];
  let gets = 0;
  let failMarkOnce = false;
  let hang: null | { resolve: () => void; reject: (e: Error) => void } = null;
  let hangNext = false;
  let timeoutNext = false;
  const fenced = (a: number, patch: Partial<NonNullable<RegJob>>, cutoff?: string) => {
    if (!job || job.attempts !== a || job.status !== "registering" || (cutoff && !(job.updated_at! < cutoff))) return false;
    job = { ...job, ...patch, updated_at: new Date(t).toISOString() };
    return true;
  };
  const deps: RegisterDeps = {
    now: () => t,
    getJob: async () => job && { ...job },
    claim: async () => {
      if (job?.status === "registered") return "registered";
      if (job?.status === "registering") return "busy";
      job = { ...job!, status: "registering", attempts: (job?.attempts ?? 0) + 1, last_error: null, updated_at: new Date(t).toISOString() };
      return "claimed";
    },
    releaseStale: async (cutoff, a, msg) => fenced(a, { status: "failed", last_error: msg }, cutoff),
    listShipments: async () => { gets++; return hidden ? [] : structuredClone(cafe24); },
    postShipment: async (b) => {
      posts.push(b);
      const r = b.request as { tracking_no: string; shipping_company_code: string; status: string; order_item_code?: string[] };
      // 카페24는 받자마자 붙인다(응답이 늦게 와도)
      cafe24.push({ tracking_no: r.tracking_no, shipping_company_code: r.shipping_company_code, items: (r.order_item_code || []).map((c) => ({ order_item_code: c, status: r.status })) });
      if (timeoutNext) { timeoutNext = false; hidden = true; throw TIMEOUT(); }
      if (hangNext) { hangNext = false; await new Promise<void>((resolve, reject) => { hang = { resolve, reject }; }); }
    },
    markRegistered: async (at, a) => {
      if (failMarkOnce) { failMarkOnce = false; throw new Error("DB 저장 실패"); }
      return fenced(a, { status: "registered", registered_at: at });
    },
    markFailed: async (m, a) => fenced(a, { status: "failed", last_error: m }),
    updateOrder: async () => {},
  };
  return {
    deps, posts, cafe24,
    get gets() { return gets; },
    get job() { return job; }, set job(v) { job = v; },
    failNext() { failMarkOnce = true; }, hangNext() { hangNext = true; },
    timeoutHiddenNext() { timeoutNext = true; }, reveal() { hidden = false; },
    get hang() { return hang!; },
    tick(ms: number) { t += ms; },
  };
}

Deno.test("감독 재현②: POST 타임아웃 + 카페24 반영 지연 → 즉시 재실행해도 POST 안 함(확인필요), 반영 뒤 [접수 확인]이 복구 → posts=1", async () => {
  const w = world(); w.timeoutHiddenNext();
  const r1 = await registerOne(w.deps, INV, "0012", ITEMS);
  assertEquals(r1.unknown, true); assertEquals(unknownState(w.job), "unknown");
  const r2 = await registerOne(w.deps, INV, "0012", ITEMS);
  assertEquals(r2.unknown, true);
  assertEquals(w.posts.length, 1);
  const gets = w.gets;
  const c1 = await registerOne(w.deps, INV, "0012", ITEMS, "confirm");   // 반영 대기 전 — 조회 안 함
  assertEquals(c1.unknown, true); assertEquals(w.gets, gets);
  w.tick(CONFIRM_WAIT_MS); w.reveal();
  const c2 = await registerOne(w.deps, INV, "0012", ITEMS, "confirm");
  assertEquals(c2, { ok: true, recovered: true });
  assertEquals(w.posts.length, 1); assertEquals(w.job?.status, "registered");
});

Deno.test("감독 재현(이전 회차): POST 응답 대기 중 타임아웃 → STALE+1초 재실행도 막힘 → [접수 확인]으로 복구, posts=1", async () => {
  const w = world(); w.hangNext();
  const first = registerOne(w.deps, INV, "0012", ITEMS);
  await tick(); await tick();
  w.tick(EXT_TIMEOUT_MS); w.hang.reject(TIMEOUT());
  assertEquals((await first).unknown, true);
  w.tick(STALE_MS + 1000 - EXT_TIMEOUT_MS);
  assertEquals((await registerOne(w.deps, INV, "0012", ITEMS)).unknown, true);
  assertEquals(w.posts.length, 1);
  w.tick(CONFIRM_WAIT_MS);
  assertEquals(await registerOne(w.deps, INV, "0012", ITEMS, "confirm"), { ok: true, recovered: true });
  assertEquals(w.posts.length, 1);
});

Deno.test("registering 고착(POST 가 STALE 넘게 살아 있음) → 재실행은 POST 없이 확인필요, 늦은 첫 응답은 덮어쓰지 못함", async () => {
  const w = world(); w.hangNext();
  const first = registerOne(w.deps, INV, "0012", ITEMS);
  await tick(); await tick();
  w.tick(STALE_MS + 1000);
  const second = await registerOne(w.deps, INV, "0012", ITEMS);
  assertEquals(second.unknown, true);
  w.hang.resolve();
  assertEquals((await first).manual, true);
  assertEquals(w.posts.length, 1); assertEquals(unknownState(w.job), "unknown");
  w.tick(CONFIRM_WAIT_MS);
  assertEquals(await registerOne(w.deps, INV, "0012", ITEMS, "confirm"), { ok: true, recovered: true });
  assertEquals(w.posts.length, 1);
});

Deno.test("확인필요 → [접수 확인] 없음 → 그때만 [다시 시도]. 확인 전 다시 시도·일반 등록은 막힘", async () => {
  const w = world();
  const d: RegisterDeps = { ...w.deps, postShipment: async (b) => { w.posts.push(b); throw TIMEOUT(); } };   // 카페24에 안 붙음
  assertEquals((await registerOne(d, INV, "0012", ITEMS)).unknown, true);
  assertEquals((await registerOne(w.deps, INV, "0012", ITEMS, "retry")).ok, false);
  w.tick(CONFIRM_WAIT_MS);
  const c = await registerOne(w.deps, INV, "0012", ITEMS, "confirm");
  assertEquals(c.checkedNone, true); assertEquals(unknownState(w.job), "none");
  assertEquals((await registerOne(w.deps, INV, "0012", ITEMS)).unknown, true);
  assertEquals(w.posts.length, 1);
  assertEquals(await registerOne(w.deps, INV, "0012", ITEMS, "retry"), { ok: true });
  assertEquals(w.posts.length, 2); assertEquals(w.job?.status, "registered");
});

Deno.test("[접수 확인] 중 GET 오류여도 확인필요 표식은 남는다", async () => {
  const w = world(); w.timeoutHiddenNext();
  await registerOne(w.deps, INV, "0012", ITEMS);
  w.tick(CONFIRM_WAIT_MS);
  const d: RegisterDeps = { ...w.deps, listShipments: async () => { throw new Error("GET 502"); } };
  await assertRejects(() => registerOne(d, INV, "0012", ITEMS, "confirm"), Error, "GET 502");
  assertEquals(unknownState(w.job), "unknown");
  assertEquals((await registerOne(w.deps, INV, "0012", ITEMS)).unknown, true);
  assertEquals(w.posts.length, 1);
});

Deno.test("복구 판정: 송장만 같고 품주 일부만 붙어 있으면 POST·완료 없이 수동 확인", async () => {
  const w = world();
  w.cafe24.push({ tracking_no: INV, shipping_company_code: "0012", items: [{ order_item_code: ITEMS[0], status: "standby" }] });
  const r = await registerOne(w.deps, INV, "0012", ITEMS);
  assertEquals(r.ok, false); assertEquals(r.manual, true);
  assertEquals(w.posts.length, 0); assertEquals(w.job?.status, "failed");
});

Deno.test("복구 판정: 택배사(누락·null 포함)·상태까지 본다", () => {
  const full: Shipment = { tracking_no: INV, shipping_company_code: "0012", items: ITEMS.map((c) => ({ order_item_code: c, status: "standby" })) };
  assertEquals(matchShipments([full], INV, "0012", ITEMS).kind, "full");
  assertEquals(matchShipments([{ ...full, shipping_company_code: "0001" }], INV, "0012", ITEMS).kind, "partial");
  assertEquals(matchShipments([{ ...full, shipping_company_code: null }], INV, "0012", ITEMS).kind, "partial");
  const { shipping_company_code: _drop, ...noCode } = full;
  assertEquals(matchShipments([noCode], INV, "0012", ITEMS).kind, "partial");
  assertEquals(matchShipments([noCode], INV, "0012", []).kind, "partial");
  assertEquals(matchShipments([{ ...full, items: ITEMS.map((c) => ({ order_item_code: c, status: "shipready" })) }], INV, "0012", ITEMS).kind, "partial");
  assertEquals(matchShipments([{ ...full, items: ITEMS.map((c) => ({ order_item_code: c, status: "shipping" })) }], INV, "0012", ITEMS).kind, "full"); // 이미 배송중으로 넘어감
  assertEquals(matchShipments([{ ...full, tracking_no: "6013082360000" }], INV, "0012", ITEMS).kind, "none");
});

Deno.test("카페24 등록 성공 → DB 실패 → 확인필요, [접수 확인]이 복구 → POST 1번", async () => {
  const w = world(); w.failNext();
  assertEquals((await registerOne(w.deps, INV, "0012", ITEMS)).unknown, true);
  w.tick(CONFIRM_WAIT_MS);
  assertEquals(await registerOne(w.deps, INV, "0012", ITEMS, "confirm"), { ok: true, recovered: true });
  assertEquals(w.posts.length, 1); assertEquals(w.job?.status, "registered");
});

Deno.test("잠금 시간이 타임아웃보다 적게 남으면 카페24 POST를 시작하지 않는다", async () => {
  const w = world();
  const d: RegisterDeps = { ...w.deps, listShipments: async () => { w.tick(STALE_MS - EXT_TIMEOUT_MS + 1); return []; } };
  await assertRejects(() => registerOne(d, INV, "0012", ITEMS), Error, "잠금 시간 부족");
  assertEquals(w.posts.length, 0);
  assertEquals(w.job?.status, "failed"); assertEquals(unknownState(w.job), null);
});

Deno.test("다른 송장이 이미 붙은 주문은 등록하지 않는다", async () => {
  const w = world();
  const r = await registerOne(w.deps, "6013082369999", "0012", []);
  assertEquals(r.ok, false);
  assertEquals(w.posts.length, 0);
});
