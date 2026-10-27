// 입금 전 취소는 환불이 아니다(사장님 10-27 "주문하고 결제안한거는 환불 아니라니까").
//  돈이 들어온 적이 없으니 환불·반품·교환률·환불 금액 어디에도 안 들어가고, 매출에서도 빠진다.
//  결제 후 취소·반품은 그대로 환불이다.
//  판정: 상태가 취소 + 미입금 표시(086 channel_orders.fin_unpaid, 또는 카페24 원본 raw.paid='F').

export function isUnpaidCancel(o, state) {
    if (!o || state !== 'cancel') return false;
    return o.fin_unpaid === true || o.raw?.paid === 'F';
}

//  환불 = 결제 후 취소 + 반품. 교환은 금액이 오가지 않아 환불이 아니다.
export function isRefund(o, state) {
    return (state === 'cancel' || state === 'return') && !isUnpaidCancel(o, state);
}

//  화면 상태 이름 — 입금 전 취소는 '취소'와 따로 보인다.
export const UNPAID_CANCEL_LABEL = '입금 전 취소';
export function stateLabel(o, state, base) {
    return isUnpaidCancel(o, state) ? UNPAID_CANCEL_LABEL : base;
}

//  channel_orders_slim 은 fin_unpaid 를 안 내준다 → 따로 받은 미입금 id 로 표시해 둔다.
export function markUnpaid(rows, unpaidIds) {
    const ids = new Set((unpaidIds || []).map(String));
    return (rows || []).map(o => ids.has(String(o.id)) ? { ...o, fin_unpaid: true } : o);
}

//  주문 화면 '취소·반품·교환' 탭 숫자 — 상태별 숫자에서 입금 전 취소만 뺀다.
export function claimCount(byState, unpaidCancel) {
    const m = byState || {};
    return Math.max(0, (m.cancel || 0) - (Number(unpaidCancel) || 0)) + (m.return || 0) + (m.exchange || 0);
}

//  매출 분석 '반품·교환률' 카드 — 건수는 취소·반품·교환, '환불' 금액은 취소·반품만(교환은 환불 아님).
//   rows: sales_monthly 같은 { state, cnt, amt } 줄(이미 결제금액 있는 주문만 = 입금 전 취소 없음)
export function claimSummary(rows) {
    let cnt = 0, refund = 0;
    for (const r of rows || []) {
        if (!['cancel', 'return', 'exchange'].includes(r.state)) continue;
        cnt += r.cnt || 0;
        if (r.state !== 'exchange') refund += Number(r.amt) || 0;
    }
    return { cnt, refund };
}
