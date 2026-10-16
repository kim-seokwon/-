// 확인필요(unknown) — 우체국 접수·카페24 등록 호출이 타임아웃/네트워크 오류로 끝나 "갔는지 안 갔는지 모르는" 상태.
// shipment_jobs.status CHECK 에 unknown 이 없어 마이그레이션 없이 status='failed' + last_error 접두어로 표시한다.
//  - 자동·일반 재실행은 막는다(선점 RPC 는 failed 를 다시 잡으므로, 선점 전에 코드에서 막는다).
//  - [접수 확인](mode=confirm): 공급자에서 조회해 있으면 채택, 확인필요 뒤 CONFIRM_WAIT_MS 가 지나도 없으면 checked_none.
//  - [다시 시도](mode=retry): checked_none 일 때만.
export const UNKNOWN = "timeout_unknown:";
export const UNKNOWN_NONE = "timeout_unknown:checked_none:";
export const CONFIRM_WAIT_MS = 5 * 60 * 1000; // 공급자 반영 지연 — 이보다 일찍 "없음"이라 판정하지 않는다

export type Mode = "run" | "confirm" | "retry";
type J = { status?: string; last_error?: string | null } | null | undefined;

// null: 확인필요 아님 / "unknown": 확인 전 / "none": 확인했더니 없음(다시 시도 가능)
export function unknownState(job: J): null | "unknown" | "none" {
  if (job?.status !== "failed" || !job.last_error?.startsWith(UNKNOWN)) return null;
  return job.last_error.startsWith(UNKNOWN_NONE) ? "none" : "unknown";
}

// 모드별 입장 검사. 통과면 null, 막히면 결과를 돌려준다.
export function gate(mode: Mode, st: null | "unknown" | "none", where: string) {
  if (mode === "run" && st) {
    return { ok: false, unknown: true, checkedNone: st === "none", message: `확인필요 — ${where}에서 접수 여부 확인 후 [접수 확인]` };
  }
  if (mode === "confirm" && !st) return { ok: false, message: "확인필요 건이 아님" };
  if (mode === "retry" && st !== "none") {
    return { ok: false, unknown: !!st, message: st ? "[접수 확인]에서 없음이 확인돼야 다시 시도할 수 있음" : "확인필요 건이 아님" };
  }
  return null;
}
