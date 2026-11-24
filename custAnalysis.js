//  4 고객 분석 — 카드 기준 표시 · 주문 수 대조 · 드롭 간 재구매 · 사이즈 표기 통일 (순수 함수)
//  기준(서버 136): 모든 카드 = '결제 주문'(실결제 > 0, order_facts.paid_amount 규칙) · 고객 = 연락처(없으면 받는분/주문자 이름).

export const BASIS_TEXT = '결제 주문(실결제>0, 전액 취소·반품 제외) · 고객 = 연락처(없으면 이름)';
//  서버가 136 전이면 카드마다 기준이 달랐다 — 그대로 보이되 경고를 붙인다
export const OLD_BASIS_TEXT = '서버 기준 통일(136) 전 — 재구매율은 취소·반품 주문까지 셉니다';
export const hasPaidBasis = x => !!(x && x.basis === 'paid');

//  주문의 실결제 금액 — 서버 order_paid_amount(136) = order_facts.paid_amount(125) 와 똑같은 규칙.
//  eland 취소·반품 확정 · 환불 0 · 결제액 >= 주문액(없으면 결제액) → 0(전액 취소). 그 밖은 남은 결제(pay_amount).
//  op_status·refund_amount·fin_order_amount 가 필요하다 — channel_orders 에서 이 칸을 명시 조회할 것(slim 에는 없음).
export function orderPaidAmount(o) {
    if (!o) return 0;
    const pay = Number(o.pay_amount || 0);
    const fin = o.fin_order_amount == null ? pay : Number(o.fin_order_amount);
    if (o.channel === 'eland' && ['cancel', 'return'].includes(o.op_status) && Number(o.refund_amount || 0) === 0 && pay >= fin) return 0;
    return pay;
}
//  '결제 주문' = 실결제 > 0 (서버 카드 모수와 같음)
export const isPaidOrder = o => orderPaidAmount(o) > 0;
//  화면 고객 분석이 조회하는 칸(raw 제외) — isPaidOrder 에 필요한 칸 포함
export const PAID_ORDER_COLS = 'id,channel,mall_key,order_id,order_date,buyer_name,receiver_name,pay_amount,op_status,refund_amount,fin_order_amount,channel_status,status';

//  같은 기간 주문 수가 왜 다른지 한 줄로 — brand_order_basis 결과
export function basisLine(b) {
    if (!b) return '';
    const n = v => Number(v || 0).toLocaleString();
    const parts = [`전체 주문 ${n(b.orders_all)}건`, `전액 취소·반품 ${n(b.orders_zero)}건 제외`, `결제 주문 ${n(b.orders_paid)}건`];
    if (b.orders_cancel_kept) parts.push(`그중 부분 취소·반품 ${n(b.orders_cancel_kept)}건은 남은 결제로 포함`);
    let s = parts.join(' → ');
    s += ` · 고객 ${n(b.customers)}명`;
    if (b.customers_no_phone) s += `(연락처 없는 ${n(b.customers_no_phone)}명은 이름으로 셈)`;
    return s;
}

//  VIP 순위 변동 — 비교 기록이 없으면 NEW 가 아니라 '비교 기록 없음'
export function vipMove(r) {
    const move = r?.rank_move || 'same', n = Number(r?.rank_delta || 0);
    if (move === 'none') return { cls: 'none', text: '–', title: '비교 시작일 전 기록이 없어 순위 변동을 표시하지 않습니다' };
    if (move === 'new') return { cls: 'new', text: 'NEW', title: '비교 시작일에는 순위 밖이었습니다' };
    if (move === 'up') return { cls: 'up', text: `▲${n}`, title: '' };
    if (move === 'down') return { cls: 'down', text: `▼${n}`, title: '' };
    return { cls: 'same', text: '–', title: '' };
}
export const vipNoBase = rows => (rows || []).length > 0 && (rows || []).every(r => r.rank_move === 'none');

//  드롭 간 재구매 — brand_drop_repurchase 의 drops → 표 줄
export function dropRows(drops) {
    const pct = (a, b) => (b ? Math.round(a / b * 1000) / 10 : null);
    return (drops || []).map(d => ({
        d: d.d, start: d.start_on, products: d.products, names: (d.names || []).filter(Boolean),
        buyers: d.buyers || 0,
        next: d.has_next ? d.next_buyers || 0 : null, nextRate: d.has_next ? pct(d.next_buyers || 0, d.buyers) : null,
        later: d.has_next ? d.later_buyers || 0 : null, laterRate: d.has_next ? pct(d.later_buyers || 0, d.buyers) : null,
        returning: d.returning_buyers || 0, returningRate: pct(d.returning_buyers || 0, d.buyers),
        hasNext: !!d.has_next,
    })).sort((a, b) => b.d - a.d);
}

//  ── 사이즈 표기 통일 ─────────────────────────────────────────
//  같은 'M'이 '[pre-order] m'·'(3/30 순차발송) m'·'m(모자 free)'·'m - 이 상품은 프리오더…'로 흩어져 있었다.
//  키즈는 번호(1·2·3)가 상품마다 키가 달라(2 = ~115cm 또는 ~125cm) 키(cm)로 맞춘다.
const LETTER = { xxs: 'XXS', xs: 'XS', s: 'S', m: 'M', l: 'L', xl: 'XL', xxl: '2XL', '2xl': '2XL', xxxl: '3XL', '3xl': '3XL' };
export function normSize(raw) {
    if (raw == null) return null;
    let s = String(raw).normalize('NFC').toLowerCase();
    s = s.replace(/\[[^\]]*\]/g, ' ').replace(/pre-?order/g, ' ');
    s = s.replace(/\s*-\s*(?=[가-힣])[\s\S]*$/, ' ');                                   // ' - 이 상품은 프리오더로…' 안내 꼬리
    s = s.replace(/\(([^)]*(?:발송|출고|배송|기존|모자)[^)]*)\)/g, ' ');                 // 배송 안내·옛 표기·모자 안내 괄호
    s = s.replace(/일반배송|\d{1,2}\.\d{1,2}\s*이후\s*출고/g, ' ');
    s = s.replace(/(상의|하의|바지)\s*(단품)?/g, ' ').replace(/\s+/g, ' ').trim();
    const cm = s.match(/(\d{2,3})\s*cm/);
    if (cm) return `~${cm[1]}cm`;
    if (/(^|[\s/(])(free|one size|프리|os|f)($|[\s/)])/.test(s) || /^free/.test(s)) return 'FREE';
    if (/^adult/.test(s)) return 'ADULT';
    const mo = s.match(/^(\d{1,2})\s*m$/);
    if (mo) return `${mo[1]}M(개월)`;
    const lt = s.match(/^(xxxl|3xl|xxl|2xl|xxs|xs|xl|s|m|l)(?![a-z])/);
    if (lt) return LETTER[lt[1]];
    const num = s.match(/^(\d{1,3})$/);
    if (num) return `${num[1]}(키 미표기)`;
    return null;                                                                        // 색상 등 사이즈가 아닌 값
}
const sizeRank = k => {
    if (k == null) return [9, 0];
    let m = k.match(/^~(\d+)cm$/); if (m) return [0, +m[1]];
    m = k.match(/^(\d+)M\(개월\)$/); if (m) return [1, +m[1]];
    const L = ['XXS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'].indexOf(k); if (L >= 0) return [2, L];
    if (k === 'FREE') return [3, 0]; if (k === 'ADULT') return [3, 1];
    m = k.match(/^(\d+)\(/); if (m) return [4, +m[1]];
    return [5, 0];
};
export const sizeCmp = (a, b) => { const x = sizeRank(a), y = sizeRank(b); return x[0] - y[0] || x[1] - y[1]; };

//  옵션 문자열 'color=…, size=…' 에서 사이즈 원문
export function sizeOf(optionName) {
    const m = String(optionName || '').match(/size=([^,]+)/i);
    return m ? m[1].trim() : null;
}

//  상품별 사이즈 분포 — 상품 = 상품코드 앞 8자리(없으면 이름). 판매 수량 기준.
//  → { sizes:[통일 사이즈 순], rows:[{ key, name, qty, by:{size:qty}, other }], unmapped:{원문:수량} }
export function productSizeTable(items, { top = 8 } = {}) {
    const prod = {}, unmapped = {};
    (items || []).forEach(it => {
        const raw = sizeOf(it.option_name); if (!raw) return;
        const q = Number(it.quantity || 1);
        const k = String(it.variant_code || '').slice(0, 8) || String(it.product_name || '');
        const p = prod[k] = prod[k] || { key: k, name: String(it.product_name || k).replace(/\[[^\]]*\]\s*/g, '').trim() || k, qty: 0, by: {}, other: 0 };
        const sz = normSize(raw);
        p.qty += q;
        if (sz) p.by[sz] = (p.by[sz] || 0) + q; else { p.other += q; unmapped[raw] = (unmapped[raw] || 0) + q; }
    });
    const rows = Object.values(prod).sort((a, b) => b.qty - a.qty).slice(0, top);
    const sizes = [...new Set(rows.flatMap(r => Object.keys(r.by)))].sort(sizeCmp);
    return { sizes, rows, unmapped };
}
