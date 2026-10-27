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

//  매출 분석 '반품·교환률' 카드 — 주문 원본(channel_orders)에서 센다.
//   sales_monthly 는 결제금액(pay_amount) 있는 주문만 남겨 결제 후 취소 상당수(10월 112건 중 85건)가 빠진다 → 쓰지 않는다.
//   건수 = 취소·반품·교환(입금 전 취소 제외), 환불 = 취소·반품의 실제 환불액(refund_amount). 교환은 환불 아님.
export function claimSummary(orders) {
    let cnt = 0, refund = 0;
    for (const o of orders || []) {
        const s = o.op_status;
        if (!['cancel', 'return', 'exchange'].includes(s) || isUnpaidCancel(o, s)) continue;
        cnt += 1;
        if (s !== 'exchange') refund += Number(o.refund_amount) || 0;
    }
    return { cnt, refund };
}

//  반품·교환률 카드·'취소 N건 제외' 한 줄이 볼 몰 — null = 회사 전체(제한 없음), [] = 몰 없음(→ 0건, 조회 안 함)
//   bf: 'ALL' 또는 브랜드 이름 · allowed: 계정이 볼 수 있는 브랜드 이름 Set(제한 없으면 null)
export function claimMallKeys(malls, brands, bf, allowed) {
    const nameOf = m => { const b = (brands || []).find(x => x.id === m.brand_id); return b ? b.name : (m.label || m.mall_key); };
    if (bf === 'ALL') return allowed ? (malls || []).filter(m => allowed.has(nameOf(m))).map(m => m.mall_key) : null;
    return (malls || []).filter(m => nameOf(m) === bf).map(m => m.mall_key);
}

//  그 범위 클레임 주문을 받아 센다. 실패는 던진다(화면이 '다시 시도'를 띄운다).
export async function fetchClaims(sb, { mallKeys, fromISO, toISO }) {
    if (Array.isArray(mallKeys) && !mallKeys.length) return { cnt: 0, refund: 0 };
    //  한 번에 최대 1000줄(PostgREST) — 연간·전체는 넘을 수 있어 나눠 받는다
    const PAGE = 1000, rows = [];
    for (let from = 0; ; from += PAGE) {
        let q = sb.from('channel_orders').select('id, op_status, fin_unpaid, refund_amount')
            .in('op_status', ['cancel', 'return', 'exchange'])
            .gte('order_date', fromISO).lt('order_date', toISO);
        if (mallKeys) q = q.in('mall_key', mallKeys);
        const { data, error } = await q.order('id').range(from, from + PAGE - 1);
        if (error) throw error;
        rows.push(...(data || []));
        if (!data || data.length < PAGE) break;
    }
    return claimSummary(rows);
}
