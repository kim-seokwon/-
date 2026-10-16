// InsertOrder 평문 필드 조립 — 네트워크 없이 테스트할 수 있게 index.ts 에서 떼어냈다.
// 우체국은 전화·우편번호에 숫자 외 글자가 있으면 "숫자로만 입력가능" 으로 거절한다(08-04 안전테스트 실패 원인).

export const CONT_CD_CLOTHING = "025"; // 매뉴얼 주요 내용품코드: 025 의류/패션잡화 (021 은 농/수/축산물)

export const digits = (v: unknown): string | undefined => {
  if (v === undefined || v === null) return undefined;
  const d = String(v).replace(/\D/g, "");
  return d || undefined;
};

// 평문 조립: key=val&key=val (빈값 제외)
export function plain(f: Record<string, unknown>): string {
  return Object.entries(f)
    .filter(([, v]) => v !== undefined && v !== null && String(v) !== "")
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
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
