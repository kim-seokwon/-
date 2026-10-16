// 우체국 발번 1건 — 외부 호출·DB는 주입받는다(테스트에서 가짜로 갈아끼움).
//  - 우체국 orderNo = `몰키:주문번호` : 두 몰에 같은 주문번호가 있어도 우체국 쪽에서 섞이지 않는다.
//  - 이전 시도가 있던 주문(실패·pending 고착)은 InsertOrder 전에 GetResInfo로 이미 접수된 운송장을 먼저 찾아 채택한다.
//    (우체국 접수는 됐는데 DB 저장이 실패한 경우, 다시 눌러도 두 번 접수되지 않게)
//  - 잠금(lease) : 선점한 시도는 attempt(shipment_jobs.attempts, 선점마다 +1)를 받고 lease = 선점 시각 + STALE_MS.
//      · 외부 호출은 EXT_TIMEOUT_MS 로 끊긴다(index.ts fetch signal).
//      · lease 가 EXT_TIMEOUT_MS 보다 적게 남으면 외부 호출을 새로 시작하지 않는다.
//        → lease 가 끝난 시점엔 이 시도의 외부 호출이 반드시 끝나 있다. 그때부터만 남이 잠금을 풀 수 있다.
//      · 결과 저장·실패 처리·잠금 해제는 "attempts = 내 attempt" 조건부 update. 오래된 시도는 덮어쓰지 못한다.
//  - 타임아웃은 자동 재시도하지 않는다(팀장 결정 10-15). InsertOrder 를 보낸 뒤 응답을 못 받으면(타임아웃·네트워크·저장 실패)
//    또는 pending 이 고착되면 확인필요(_shared/ship-unknown.ts)로 두고, 사람이 [접수 확인]→(없을 때만)[다시 시도].

export const EXT_TIMEOUT_MS = 30 * 1000;   // 우체국 호출 1번의 상한
export const STALE_MS = 5 * 60 * 1000;     // pending 이 이보다 오래 멈춰 있으면 고착으로 본다(= lease 길이)
import { CONFIRM_WAIT_MS, gate, type Mode, UNKNOWN, UNKNOWN_NONE, unknownState } from "../_shared/ship-unknown.ts";

export const NOT_FOUND = "ERR-225";        // GetResInfo: 신청정보가 존재하지 않습니다

export const epostOrderNo = (mallKey: string, orderNo: string) => {
  const v = `${mallKey}:${orderNo}`;
  if (v.length > 50) throw new Error(`우체국 주문번호 50자 초과: ${v}`);
  return v;
};

// KST yyyymmdd
export const kstYmd = (t: string | number | Date) => {
  const d = new Date(new Date(t).getTime() + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
};

export type Job = { status: string; invoice_no?: string | null; attempts?: number; last_error?: string | null; created_at?: string; updated_at?: string } | null;
export type Issued = { ok: boolean; regiNo?: string | null; reqNo?: string | null; code?: string; message?: string };
export type ResInfo = { regiNo?: string | null; reqNo?: string | null; treatStusCd?: string | null };

// 조건부 update 들은 "attempts = attempt 이고 아직 pending·송장 없음" 일 때만 바꾸고, 바꿨으면 true.
export interface IssueDeps {
  now(): number;
  getJob(): Promise<Job>;
  claim(): Promise<boolean>;                                        // claim_shipment_job (attempts +1)
  releaseStale(cutoffIso: string, attempt: number, message: string): Promise<boolean>; // + updated_at < cutoff → failed(last_error=message)
  setProviderOrderNo(no: string, attempt: number): Promise<boolean>;
  getResInfo(providerOrderNo: string, reqYmd: string): Promise<{ found: ResInfo[] } | { code: string; message: string }>;
  insertOrder(providerOrderNo: string): Promise<Issued>;
  saveIssued(regiNo: string, providerOrderNo: string, attempt: number): Promise<boolean>;
  saveFailed(message: string, attempt: number): Promise<boolean>;
}

export type IssueResult = { ok: boolean; regiNo?: string | null; idempotent?: boolean; recovered?: boolean; message?: string; reqNo?: string | null; manual?: boolean; unknown?: boolean; checkedNone?: boolean };

const busy = (s?: string) => ({ ok: false, message: `이미 처리 중 (${s || "pending"})` });

// 이미 우체국에 접수된 운송장 찾기. 없으면 null, 조회 자체가 실패하면 throw(→ 새로 접수하지 않는다).
export async function findExisting(d: IssueDeps, providerOrderNo: string, job: Job, guard: () => void = () => {}): Promise<ResInfo | null> {
  const days = new Set<string>([kstYmd(d.now())]);
  if (job?.created_at) days.add(kstYmd(job.created_at));
  if (job?.updated_at) days.add(kstYmd(job.updated_at));
  for (const ymd of days) {
    guard();
    const r = await d.getResInfo(providerOrderNo, ymd);
    if ("code" in r) {
      if (r.code === NOT_FOUND) continue;
      throw new Error(`우체국 접수 확인 실패(${r.code}) ${r.message} — 중복 접수 방지로 발번 중단`);
    }
    const hit = r.found.find((x) => x.regiNo && x.treatStusCd !== "05"); // 05 = 신청취소
    if (hit) return hit;
  }
  return null;
}

// 기접수 채택. 저장이 조건부라 실패하면 지금 DB 상태로 판단한다.
async function adopt(d: IssueDeps, hit: ResInfo, providerOrderNo: string, attempt: number): Promise<IssueResult> {
  if (await d.saveIssued(hit.regiNo!, providerOrderNo, attempt)) return { ok: true, regiNo: hit.regiNo, reqNo: hit.reqNo, recovered: true };
  const cur = await d.getJob();
  if (cur?.invoice_no === hit.regiNo) return { ok: true, regiNo: hit.regiNo, idempotent: true };
  return { ok: false, manual: true, message: `우체국 기접수 ${hit.regiNo} 확인 — 다른 시도와 겹쳐 저장 못함, 수동 확인` };
}

export async function issueOne(d: IssueDeps, mallKey: string, orderNo: string, mode: Mode = "run"): Promise<IssueResult> {
  const providerOrderNo = epostOrderNo(mallKey, orderNo);
  const before = await d.getJob();
  if (before?.invoice_no) return { ok: true, regiNo: before.invoice_no, idempotent: true };
  const prev = unknownState(before);
  const blocked = gate(mode, prev, "우체국 계약고객전용시스템");
  if (blocked) return blocked;
  if (mode === "confirm") {   // 우체국 반영이 늦을 수 있다 — 확인필요가 된 지 CONFIRM_WAIT_MS 전엔 조회하지 않는다
    const since = before?.updated_at ? d.now() - new Date(before.updated_at).getTime() : Infinity;
    if (since < CONFIRM_WAIT_MS) return { ok: false, unknown: true, message: `반영 대기 — ${Math.ceil((CONFIRM_WAIT_MS - since) / 60000)}분 뒤 [접수 확인]` };
  }

  let start = d.now();
  if (!(await d.claim())) {
    const cur = await d.getJob();
    if (cur?.invoice_no) return { ok: true, regiNo: cur.invoice_no, idempotent: true };
    const age = cur?.updated_at ? d.now() - new Date(cur.updated_at).getTime() : 0;
    if (cur?.status !== "pending" || age < STALE_MS) return busy(cur?.status);
    // lease 가 끝난 pending(함수가 죽음): 그 시도의 외부 호출은 끝났다. 접수돼 있으면 채택, 아니면 확인필요 — 새로 접수하지 않는다
    const hit = await findExisting(d, providerOrderNo, cur);
    if (hit?.regiNo) return await adopt(d, hit, providerOrderNo, cur.attempts ?? 0);
    const msg = `${UNKNOWN}pending 고착 — 우체국 접수 여부 확인 필요`;
    if (!(await d.releaseStale(new Date(d.now() - STALE_MS).toISOString(), cur.attempts ?? 0, msg))) return busy();
    return { ok: false, unknown: true, message: msg.slice(UNKNOWN.length) };
  }

  const attempt = (await d.getJob())?.attempts ?? 0;
  const leaseEnd = start + STALE_MS;
  const guard = () => {
    if (d.now() + EXT_TIMEOUT_MS > leaseEnd) throw new Error("잠금 시간 부족 — 우체국 호출 안 함, 다시 시도");
  };

  let sent = false;   // InsertOrder 를 보냈나 — 보낸 뒤의 오류는 접수됐을 수도 있다
  let issued: Issued | null = null;
  try {
    if (before) {
      // 이전 시도가 있던 주문: 접수는 됐는데 응답·저장만 실패했을 수 있다
      const hit = await findExisting(d, providerOrderNo, before, guard);
      if (hit?.regiNo) return await adopt(d, hit, providerOrderNo, attempt);
      if (mode === "confirm") {
        await d.saveFailed(`${UNKNOWN_NONE}우체국 조회 결과 없음 — [다시 시도] 가능`, attempt);
        return { ok: false, unknown: true, checkedNone: true, message: "우체국에 접수 없음 확인 — [다시 시도] 가능" };
      }
    }
    if (!(await d.setProviderOrderNo(providerOrderNo, attempt))) return busy();
    guard();
    sent = true;
    issued = await d.insertOrder(providerOrderNo);
    if (issued.ok && issued.regiNo) {
      if (await d.saveIssued(issued.regiNo, providerOrderNo, attempt)) return { ok: true, regiNo: issued.regiNo, reqNo: issued.reqNo };
      if ((await d.getJob())?.invoice_no === issued.regiNo) return { ok: true, regiNo: issued.regiNo, idempotent: true }; // 다른 시도가 같은 접수를 채택
      return { ok: false, manual: true, regiNo: issued.regiNo, message: `우체국 접수 ${issued.regiNo} 됐으나 잠금을 잃어 저장 못함 — 수동 확인` };
    }
    // 우체국이 오류코드로 거절 → 접수 안 됨. 일반 실패(다시 눌러도 된다)
    if (!issued.ok && issued.code) {
      const msg = `${issued.code} ${issued.message || "발번 실패"}`.trim();
      await d.saveFailed(msg, attempt);
      return { ok: false, message: msg };
    }
    // 오류코드도 송장도 없는 응답(5xx·빈 응답 등)은 접수 여부를 모른다
    throw new Error(`우체국 응답에 송장·오류코드 없음`);
  } catch (e) {
    if (!sent) {
      // 선점 RPC 가 last_error 를 지웠다 — 확인필요였던 건은 표식을 되살려 일반 재실행을 계속 막는다
      const keep = prev === "none" ? UNKNOWN_NONE : prev ? UNKNOWN : "";
      await d.saveFailed(keep + String(e), attempt).catch(() => false);
      throw e;
    }
    // 보낸 뒤 오류(타임아웃·네트워크·저장 실패): 자동 재시도 안 함 → 확인필요
    const got = issued?.regiNo ? ` 받은 송장 ${issued.regiNo}` : "";
    const msg = `우체국 응답 확인 못함(${String(e)})${got} — 우체국 시스템에서 접수 여부 확인 필요`;
    await d.saveFailed(UNKNOWN + msg, attempt).catch(() => false);
    return { ok: false, unknown: true, regiNo: issued?.regiNo ?? null, message: msg };
  }
}
