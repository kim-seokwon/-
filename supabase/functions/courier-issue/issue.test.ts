import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import { epostOrderNo, EXT_TIMEOUT_MS, issueOne, kstYmd, NOT_FOUND, STALE_MS, type Issued, type IssueDeps, type Job } from "./issue.ts";
import { CONFIRM_WAIT_MS, unknownState } from "../_shared/ship-unknown.ts";

Deno.test("우체국 orderNo = 몰키:주문번호, 50자 초과는 거절 / 타임아웃 < 잠금", () => {
  assertEquals(epostOrderNo("hiheiho", "20261015-0000001"), "hiheiho:20261015-0000001");
  assertThrows(() => epostOrderNo("m".repeat(30), "20261015-0000001-0000000"));
  assertEquals(kstYmd("2026-10-14T16:30:00Z"), "20261015");
  assertEquals(EXT_TIMEOUT_MS * 4 < STALE_MS, true); // 조회 3번 + 접수 1번이 잠금 안에 끝난다
});

const tick = () => new Promise((r) => setTimeout(r, 0));
const TIMEOUT = () => new DOMException("Signal timed out.", "TimeoutError");

// 가짜 DB(claim_shipment_job 규칙 + attempts 조건부 update) + 가짜 우체국(orderNo+신청일자로 조회)
function world() {
  let t = Date.parse("2026-10-15T03:00:00Z");
  const jobs = new Map<string, NonNullable<Job>>();
  const epost = new Map<string, { regiNo: string; ymd: string }>(); // 우체국이 실제로 받은 접수
  const hidden = new Set<string>();   // 받았지만 아직 GetResInfo 에 안 보이는 접수(반영 지연)
  let inserts = 0; let resInfo = 0; let seq = 0; let failSave = false;
  let hang: null | { resolve: () => void; reject: (e: Error) => void } = null;
  let hangNext: null | { received: boolean } = null;
  let nextInsert: null | ((pno: string) => Promise<Issued>) = null;
  const receive = (pno: string) => {
    const regiNo = String(6013082360000 + ++seq);
    epost.set(pno, { regiNo, ymd: kstYmd(t) });
    return regiNo;
  };
  const deps = (mall: string, no: string): IssueDeps => {
    const k = `${mall}|${no}`;
    const fenced = (attempt: number, patch: Partial<NonNullable<Job>>, cutoff?: string) => {
      const j = jobs.get(k);
      if (!j || j.attempts !== attempt || j.status !== "pending" || j.invoice_no || (cutoff && !(j.updated_at! < cutoff))) return false;
      jobs.set(k, { ...j, ...patch, updated_at: new Date(t).toISOString() });
      return true;
    };
    return {
      now: () => t,
      getJob: async () => jobs.has(k) ? { ...jobs.get(k)! } : null,
      claim: async () => {
        const j = jobs.get(k); const iso = new Date(t).toISOString();
        if (!j) { jobs.set(k, { status: "pending", attempts: 1, last_error: null, created_at: iso, updated_at: iso }); return true; }
        if (j.invoice_no || ["pending", "registering", "registered"].includes(j.status)) return false;
        jobs.set(k, { ...j, status: "pending", attempts: (j.attempts ?? 0) + 1, last_error: null, updated_at: iso }); return true;
      },
      releaseStale: async (cutoff, a, msg) => fenced(a, { status: "failed", last_error: msg }, cutoff),
      setProviderOrderNo: async (_no, a) => fenced(a, {}),
      getResInfo: async (pno, ymd) => {
        resInfo++;
        const e = epost.get(pno);
        return e && e.ymd === ymd && !hidden.has(pno) ? { found: [{ regiNo: e.regiNo, treatStusCd: "01" }] } : { code: NOT_FOUND, message: "신청정보가 존재하지 않습니다" };
      },
      insertOrder: async (pno) => {
        inserts++;
        if (nextInsert) { const f = nextInsert; nextInsert = null; return await f(pno); }
        if (hangNext) {   // 응답이 오지 않는 호출. received=true 면 우체국은 이미 접수했다(최악)
          const h = hangNext; hangNext = null;
          const regiNo = h.received ? receive(pno) : null;
          return await new Promise<Issued>((resolve, reject) => {
            hang = { resolve: () => resolve({ ok: true, regiNo: regiNo ?? receive(pno) }), reject };
          });
        }
        if (epost.has(pno)) return { ok: false, code: "ERR-999", message: "중복" };
        return { ok: true, regiNo: receive(pno) };
      },
      saveIssued: async (regiNo, _no, a) => {
        if (failSave) { failSave = false; throw new Error("DB 저장 실패"); }
        return fenced(a, { status: "issued", invoice_no: regiNo });
      },
      saveFailed: async (m, a) => fenced(a, { status: "failed", last_error: m }),
    };
  };
  return {
    deps, jobs, epost, hidden,
    get inserts() { return inserts; }, get resInfo() { return resInfo; },
    failNext() { failSave = true; },
    hangNext(received: boolean) { hangNext = { received }; },
    // 감독 재현: 우체국은 받았는데 우리는 타임아웃, 그리고 GetResInfo 반영이 늦다
    timeoutReceivedHidden() { nextInsert = async (pno) => { receive(pno); hidden.add(pno); throw TIMEOUT(); }; },
    timeoutNotReceived() { nextInsert = async () => { throw TIMEOUT(); }; },
    nextInsertIs(f: (pno: string) => Promise<Issued>) { nextInsert = f; },
    get hang() { return hang!; },
    tick(ms: number) { t += ms; },
  };
}
const st = (w: ReturnType<typeof world>, k: string) => unknownState(w.jobs.get(k));

Deno.test("감독 재현①: 접수 타임아웃 + 우체국 반영 지연 → 즉시 재실행해도 InsertOrder 안 함(확인필요), 반영 뒤 [접수 확인]이 채택 → inserts=1", async () => {
  const w = world(); w.timeoutReceivedHidden();
  const r1 = await issueOne(w.deps("hiheiho", "T1"), "hiheiho", "T1");
  assertEquals(r1.ok, false); assertEquals(r1.unknown, true);
  assertEquals(st(w, "hiheiho|T1"), "unknown");
  // 곧바로 다시 발번 — 막힌다(조회도 안 함)
  const r2 = await issueOne(w.deps("hiheiho", "T1"), "hiheiho", "T1");
  assertEquals(r2.unknown, true);
  assertEquals(w.inserts, 1); assertEquals(w.resInfo, 0);
  // 반영 대기 시간 전 [접수 확인] — 아직 "없음"으로 판정하지 않는다
  const c1 = await issueOne(w.deps("hiheiho", "T1"), "hiheiho", "T1", "confirm");
  assertEquals(c1.unknown, true); assertEquals(c1.checkedNone, undefined); assertEquals(w.resInfo, 0);
  // 5분 뒤 반영됨 → [접수 확인]이 채택
  w.tick(CONFIRM_WAIT_MS); w.hidden.clear();
  const c2 = await issueOne(w.deps("hiheiho", "T1"), "hiheiho", "T1", "confirm");
  assertEquals(c2.ok && c2.recovered, true);
  assertEquals(w.inserts, 1); assertEquals(w.epost.size, 1);
  assertEquals(w.jobs.get("hiheiho|T1")?.invoice_no, w.epost.get("hiheiho:T1")?.regiNo);
});

Deno.test("감독 재현(이전 회차): 응답 대기 중 타임아웃 → STALE+1초 재실행도 막힘 → [접수 확인]으로 채택, inserts=1", async () => {
  const w = world(); w.hangNext(true);
  const first = issueOne(w.deps("hiheiho", "R1"), "hiheiho", "R1");
  await tick(); await tick();
  w.tick(EXT_TIMEOUT_MS); w.hang.reject(TIMEOUT());
  assertEquals((await first).unknown, true);
  w.tick(STALE_MS + 1000 - EXT_TIMEOUT_MS);
  assertEquals((await issueOne(w.deps("hiheiho", "R1"), "hiheiho", "R1")).unknown, true);
  assertEquals(w.inserts, 1);
  w.tick(CONFIRM_WAIT_MS);
  const c = await issueOne(w.deps("hiheiho", "R1"), "hiheiho", "R1", "confirm");
  assertEquals(c.recovered, true);
  assertEquals(w.inserts, 1); assertEquals(w.epost.size, 1);
});

Deno.test("확인필요 → [접수 확인] 없음 → 그때만 [다시 시도] 가능. 확인 전 다시 시도·일반 발번은 막힘", async () => {
  const w = world(); w.timeoutNotReceived();
  assertEquals((await issueOne(w.deps("tovee", "N1"), "tovee", "N1")).unknown, true);
  const early = await issueOne(w.deps("tovee", "N1"), "tovee", "N1", "retry");
  assertEquals(early.ok, false); assertEquals(w.inserts, 1);
  w.tick(CONFIRM_WAIT_MS);
  const c = await issueOne(w.deps("tovee", "N1"), "tovee", "N1", "confirm");
  assertEquals(c.checkedNone, true); assertEquals(st(w, "tovee|N1"), "none");
  assertEquals((await issueOne(w.deps("tovee", "N1"), "tovee", "N1")).unknown, true);   // 일반 발번은 여전히 막힘
  assertEquals(w.inserts, 1);
  const r = await issueOne(w.deps("tovee", "N1"), "tovee", "N1", "retry");
  assertEquals(r.ok, true); assertEquals(w.inserts, 2); assertEquals(st(w, "tovee|N1"), null);
});

Deno.test("[접수 확인] 중 조회 오류여도 확인필요 표식은 남는다(선점이 last_error 를 지워도)", async () => {
  const w = world(); w.timeoutNotReceived();
  await issueOne(w.deps("hiheiho", "E1"), "hiheiho", "E1");
  w.tick(CONFIRM_WAIT_MS);
  const d = { ...w.deps("hiheiho", "E1"), getResInfo: async () => ({ code: "ERR-123", message: "인증키" }) };
  await assertRejects(() => issueOne(d, "hiheiho", "E1", "confirm"), Error, "중복 접수 방지");
  assertEquals(st(w, "hiheiho|E1"), "unknown");
  assertEquals((await issueOne(w.deps("hiheiho", "E1"), "hiheiho", "E1")).unknown, true);
  assertEquals(w.inserts, 1);
});

Deno.test("응답에 송장도 오류코드도 없으면(5xx 등) 확인필요", async () => {
  const w = world(); w.nextInsertIs(async () => ({ ok: true, regiNo: null }));
  const r = await issueOne(w.deps("hiheiho", "X1"), "hiheiho", "X1");
  assertEquals(r.unknown, true); assertEquals(st(w, "hiheiho|X1"), "unknown");
});

Deno.test("우체국이 오류코드로 거절하면 일반 실패 — 다시 눌러 재발번 가능", async () => {
  const w = world(); w.nextInsertIs(async () => ({ ok: false, code: "ERR-301", message: "주소 오류" }));
  const r = await issueOne(w.deps("hiheiho", "X2"), "hiheiho", "X2");
  assertEquals(r.ok, false); assertEquals(r.unknown, undefined); assertEquals(st(w, "hiheiho|X2"), null);
  assertEquals((await issueOne(w.deps("hiheiho", "X2"), "hiheiho", "X2")).ok, true);
});

Deno.test("첫 호출이 (타임아웃이 안 걸려) STALE 넘게 살아 있어도 우체국에 접수됐으면 재실행은 채택만, 늦게 온 첫 응답도 같은 송장", async () => {
  const w = world(); w.hangNext(true);
  const first = issueOne(w.deps("hiheiho", "R2"), "hiheiho", "R2");
  await tick(); await tick();
  w.tick(STALE_MS + 1000);
  const second = await issueOne(w.deps("hiheiho", "R2"), "hiheiho", "R2");
  assertEquals(second.recovered, true);
  w.hang.resolve();
  const r1 = await first;
  assertEquals(r1.ok && r1.idempotent, true);
  assertEquals(w.inserts, 1); assertEquals(w.epost.size, 1);
});

Deno.test("pending 고착 + 우체국에 아직 없음 → 새로 접수하지 않고 확인필요. 늦은 첫 응답은 덮어쓰지 못함, [접수 확인]이 채택", async () => {
  const w = world(); w.hangNext(false);
  const first = issueOne(w.deps("tovee", "F1"), "tovee", "F1");
  await tick(); await tick();
  w.tick(STALE_MS + 1000);
  const second = await issueOne(w.deps("tovee", "F1"), "tovee", "F1");
  assertEquals(second.unknown, true);
  assertEquals(w.inserts, 1);
  w.hang.resolve();
  const r1 = await first;
  assertEquals(r1.ok, false); assertEquals(r1.manual, true);   // 덮어쓰지 않고 수동 확인으로
  assertEquals(st(w, "tovee|F1"), "unknown");
  w.tick(CONFIRM_WAIT_MS);
  const c = await issueOne(w.deps("tovee", "F1"), "tovee", "F1", "confirm");
  assertEquals(c.recovered, true); assertEquals(c.regiNo, r1.regiNo);
  assertEquals(w.inserts, 1);
});

Deno.test("잠금 시간이 타임아웃보다 적게 남으면 우체국 호출을 새로 시작하지 않는다", async () => {
  const w = world();
  w.jobs.set("hiheiho|G1", { status: "failed", attempts: 1, created_at: "2026-10-15T02:00:00Z", updated_at: "2026-10-15T02:00:00Z" });
  const base = w.deps("hiheiho", "G1");
  const d: IssueDeps = { ...base, getResInfo: async (p, y) => { w.tick(STALE_MS - EXT_TIMEOUT_MS + 1); return await base.getResInfo(p, y); } };
  await assertRejects(() => issueOne(d, "hiheiho", "G1"), Error, "잠금 시간 부족");
  assertEquals(w.inserts, 0);
  assertEquals(w.jobs.get("hiheiho|G1")?.status, "failed");
});

Deno.test("우체국 접수 성공 → DB 저장 실패 → 확인필요(받은 송장 표시), [접수 확인]으로 채택, InsertOrder 1번", async () => {
  const w = world(); w.failNext();
  const r0 = await issueOne(w.deps("hiheiho", "A1"), "hiheiho", "A1");
  assertEquals(r0.unknown, true); assertEquals(!!r0.regiNo, true);
  w.tick(CONFIRM_WAIT_MS);
  const r = await issueOne(w.deps("hiheiho", "A1"), "hiheiho", "A1", "confirm");
  assertEquals(r.ok && r.recovered, true);
  assertEquals(r.regiNo, r0.regiNo);
  assertEquals(w.inserts, 1);
});

Deno.test("pending 고착(함수가 죽음) → 잠금 안이면 진행 중, STALE 뒤 우체국에 있으면 채택", async () => {
  const w = world();
  const iso = "2026-10-15T03:00:00.000Z";
  w.jobs.set("tovee|B1", { status: "pending", attempts: 1, created_at: iso, updated_at: iso });
  w.epost.set("tovee:B1", { regiNo: "6013082369999", ymd: "20261015" });
  assertEquals((await issueOne(w.deps("tovee", "B1"), "tovee", "B1")).ok, false);
  w.tick(STALE_MS + 1000);
  const r = await issueOne(w.deps("tovee", "B1"), "tovee", "B1");
  assertEquals(r.recovered, true); assertEquals(r.regiNo, "6013082369999");
  assertEquals(w.inserts, 0);
});

Deno.test("같은 주문번호 두 몰: 우체국 orderNo가 갈려 운송장 2개, 서로 채택하지 않음", async () => {
  const w = world();
  const a = await issueOne(w.deps("hiheiho", "20261015-0000001"), "hiheiho", "20261015-0000001");
  const b = await issueOne(w.deps("tovee", "20261015-0000001"), "tovee", "20261015-0000001");
  assertEquals(a.ok && b.ok, true);
  assertEquals(a.regiNo !== b.regiNo, true);
  assertEquals([...w.epost.keys()].sort(), ["hiheiho:20261015-0000001", "tovee:20261015-0000001"]);
  assertEquals(w.inserts, 2);
});

Deno.test("우체국 확인 조회가 225 외 오류면 새로 접수하지 않는다", async () => {
  const w = world();
  w.jobs.set("hiheiho|C1", { status: "failed", attempts: 1, created_at: "2026-10-15T00:00:00Z", updated_at: "2026-10-15T00:00:00Z" });
  const d = { ...w.deps("hiheiho", "C1"), getResInfo: async () => ({ code: "ERR-123", message: "인증키" }) };
  await assertRejects(() => issueOne(d, "hiheiho", "C1"), Error, "중복 접수 방지");
  assertEquals(w.inserts, 0);
});
