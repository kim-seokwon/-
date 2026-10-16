// InsertOrder 평문 필드 조립 — 네트워크 없이 테스트할 수 있게 index.ts 에서 떼어냈다.
// 우체국은 전화·우편번호에 숫자 외 글자가 있으면 "숫자로만 입력가능" 으로 거절한다(08-04 안전테스트 실패 원인).

export const CONT_CD_CLOTHING = "025"; // 매뉴얼 주요 내용품코드: 025 의류/패션잡화 (021 은 농/수/축산물)

export const digits = (v: unknown): string | undefined => {
  if (v === undefined || v === null) return undefined;
  const d = String(v).replace(/\D/g, "");
  return d || undefined;
};

// 평문 조립: key=val&key=val (빈값 제외)
//  값 안의 '&'·'=' 는 구분자와 겹쳐 뒤 항목이 깨진다(이스케이프 규칙 없음, 매뉴얼 2023.12) → 전각 '＆'·'＝' 로 바꿔 보낸다.
export function plain(f: Record<string, unknown>): string {
  return Object.entries(f)
    .filter(([, v]) => v !== undefined && v !== null && String(v) !== "")
    .map(([k, v]) => `${k}=${String(v).replace(/&/g, "＆").replace(/=/g, "＝")}`)
    .join("&");
}

// 발송 전 검사 — 우체국에 보내기 전에 걸러 오류 사유를 바로 보여준다(우체국 오류코드보다 알아보기 쉽게).
//  길이는 매뉴얼 '길이' 칸(단위 표기 없음 → 글자 수로 본다. 바이트 기준이면 우체국이 거절하고 그 오류가 그대로 보인다).
const REQUIRED = ["custNo", "apprNo", "payType", "reqType", "officeSer", "microYn", "orderNo", "ordCompNm", "recNm", "recZip", "recAddr1", "recAddr2", "contCd", "goodsNm"];
const MAX_LEN: Record<string, number> = { orderNo: 50, ordCompNm: 100, inqTelCn: 100, ordNm: 40, ordZip: 5, ordAddr1: 60, ordAddr2: 100, ordTel: 12, ordMob: 12,
  recNm: 40, recAddr1: 150, recAddr2: 300, recTel: 12, recMob: 12, goodsNm: 400, goodsCd: 400, goodsMdl: 400, goodsSize: 30, goodsColor: 40, qty: 5, delivMsg: 200 };
// regData = SEED128 ECB hex. 0-패딩으로 16바이트 블록 단위(seed128.ts) → 길이는 키와 무관하게 평문 UTF-8 바이트로 정해진다.
export const REGDATA_MAX = 4000;   // 매뉴얼: regData 최대 4000자 (= 평문 2000바이트)
export const regDataLen = (p: string) => Math.max(1, Math.ceil(new TextEncoder().encode(p).length / 16)) * 32;
export function checkOrder(f: Record<string, unknown>): string[] {
  const has = (k: string) => f[k] !== undefined && f[k] !== null && String(f[k]).trim() !== "";   // 공백만 = 없음
  const e: string[] = [];
  for (const k of REQUIRED) if (!has(k)) e.push(`${k} 없음`);
  if (!has("recTel") && !has("recMob")) e.push("수취인 전화·휴대폰 둘 다 없음");
  if (has("recZip") && !/^\d{5}$/.test(String(f.recZip))) e.push(`recZip ${String(f.recZip).length}자 — 숫자 5자리만`);
  for (const [k, n] of Object.entries(MAX_LEN)) if (has(k) && String(f[k]).length > n) e.push(`${k} ${String(f[k]).length}자(최대 ${n})`);
  const int = (k: string, lo: number, hi: number) => {
    if (has(k) && !(Number.isInteger(Number(f[k])) && Number(f[k]) >= lo && Number(f[k]) <= hi)) e.push(`${k} ${f[k]} — ${lo}~${hi} 정수만`);
  };
  int("weight", 1, 30); int("volume", 1, 160);
  const n = regDataLen(plain(f));   // 항목마다 한도 안이어도 합치면 넘을 수 있다(한글 3바이트)
  if (n > REGDATA_MAX) e.push(`전체 ${n}자(최대 ${REGDATA_MAX}) — 주소·상품명·배송메시지를 줄여주세요`);
  return e;
}

export type EpostCreds = { custNo: string; apprNo: string; officeSer: string };

export function orderFields(o: Record<string, unknown>, c: EpostCreds, testYn = "N"): Record<string, unknown> {
  return {
    custNo: c.custNo,
    apprNo: c.apprNo,
    officeSer: c.officeSer,
    payType: o.payType ?? "1",     // 1:일반(즉납/후납), 2:수취인부담
    reqType: o.reqType ?? "1",     // 1:일반소포, 2:반품소포
    microYn: o.microYn ?? "N",     // 초소형 여부(필수)
    weight: o.weight,              // kg (정수)
    volume: o.volume,              // cm (정수)
    orderNo: o.orderNo,            // 채널 주문번호(필수)
    ordCompNm: o.ordCompNm,        // 주문처명=몰/브랜드(필수)
    inqTelCn: digits(o.inqTelCn),  // 문의처 — 비면 계약고객전용시스템 '전용라벨관리' 값
    ordNm: o.ordNm, ordZip: digits(o.ordZip), ordAddr1: o.ordAddr1, ordAddr2: o.ordAddr2,
    ordTel: digits(o.ordTel), ordMob: digits(o.ordMob),
    recNm: o.recNm,                // 수취인명(필수)
    recZip: digits(o.recZip),      // 수취인 우편번호(필수)
    recAddr1: o.recAddr1,          // 수취인 주소(필수)
    recAddr2: o.recAddr2,          // 수취인 상세주소(필수)
    recTel: digits(o.recTel), recMob: digits(o.recMob), // recTel/recMob 중 하나 필수
    contCd: o.contCd ?? CONT_CD_CLOTHING, // 주요 내용품코드(필수)
    goodsNm: o.goodsNm,            // 상품명(필수)
    goodsCd: o.goodsCd, goodsMdl: o.goodsMdl, goodsSize: o.goodsSize, goodsColor: o.goodsColor, qty: o.qty,
    delivMsg: o.delivMsg,          // 배송 메시지
    printYn: o.printYn ?? "N",     // N: 계약고객전용시스템 '운송장 출력' 메뉴에서 라벨 출력
    testYn,                        // Y면 테스트 접수(실발송 없음)
  };
}
