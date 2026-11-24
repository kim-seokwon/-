//  12 견적서 — 용도(판매/생산 원가) · 확정·발송 전 검증 · 확정 뒤 발주→청구→입금 연결 (순수 함수)
//  판매 견적 = 우리가 고객에게 내는 견적(세금계산서·입금이 따라온다 → 매출).
//  생산 원가 견적 = 공장에서 받은 원가 견적(우리가 돈을 낸다 → 매출 아님, 우리 이름으로 계산서 발행 안 함).

export const PURPOSE = { sale: '판매 견적', cost: '생산 원가 견적' };
export const PURPOSE_HINT = { sale: '고객에게 내는 견적 — 확정되면 세금계산서·입금으로 이어지고 매출로 잡힌다', cost: '공장에서 받은 원가 견적 — 발주·지급으로 이어지고 매출이 아니다' };
export const purposeOf = q => (q && q.purpose === 'cost' ? 'cost' : 'sale');
export const PAY_TERMS = ['선금 50% · 잔금 50%(출고 전)', '전액 선금', '출고 후 30일 이내', '월말 정산', '계약금 30% · 잔금 70%'];

const num = v => Number(v) || 0;
const ymd = d => (d ? String(d).slice(0, 10) : '');

//  발송·확정 전에 비어 있으면 안 되는 것 — [{ k, msg }] 비면 통과
//  draft(작성중)은 자유롭게 저장. sent·confirmed 로 올릴 때만 막는다(서버 138 트리거와 같은 규칙).
export function quoteProblems(q, status) {
    const st = status || q?.status || 'draft';
    if (st === 'draft') return [];
    const out = [];
    const items = Array.isArray(q?.items) ? q.items.filter(it => it && (it.name || num(it.qty) || num(it.price))) : [];
    if (!String(q?.client_name || '').trim() || String(q?.client_name).trim() === '미정') out.push({ k: 'client', msg: purposeOf(q) === 'cost' ? '공장(거래처) 상호' : '고객사 상호' });
    if (!items.length) out.push({ k: 'items', msg: '품목 1개 이상' });
    items.forEach((it, i) => {
        const nm = it.name || `${i + 1}번째 품목`;
        if (!String(it.name || '').trim()) out.push({ k: 'item_name', msg: `${i + 1}번째 품목 이름` });
        if (num(it.qty) <= 0) out.push({ k: 'qty', msg: `${nm} 수량(0)` });
        if (num(it.price) <= 0) out.push({ k: 'price', msg: `${nm} 단가(0원)` });
    });
    if (num(q?.total_amount) <= 0) out.push({ k: 'total', msg: '합계 0원' });
    if (!ymd(q?.quote_date)) out.push({ k: 'quote_date', msg: '견적일' });
    if (!ymd(q?.valid_until)) out.push({ k: 'valid_until', msg: '유효기간' });
    else if (ymd(q?.quote_date) && ymd(q.valid_until) < ymd(q.quote_date)) out.push({ k: 'valid_until', msg: '유효기간이 견적일보다 앞' });
    if (!ymd(q?.due_date)) out.push({ k: 'due_date', msg: '납기' });
    if (!String(q?.payment_terms || '').trim()) out.push({ k: 'payment_terms', msg: '결제조건' });
    //  공급가액 + 부가세 = 합계 (손으로 고친 값이 어긋나면 막는다)
    if (num(q?.supply_amount) + num(q?.tax_amount) !== num(q?.total_amount)) out.push({ k: 'sum', msg: '공급가액+부가세가 합계와 다름' });
    return out;
}

//  유효기간 상태 — 발송된 견적이 기한을 넘기면 '만료'(확정 전만)
export function validity(q, today) {
    const v = ymd(q?.valid_until); if (!v) return { label: '유효기간 없음', over: false };
    if ((q?.status || 'draft') === 'confirmed') return { label: v, over: false };
    const t = ymd(today);
    return t && v < t ? { label: `${v} · 만료`, over: true } : { label: v, over: false };
}

//  확정 뒤 이어지는 단계 — 확정 → 발주 → 청구 → 입금(원가 견적은 지급)
//  item = 이 견적이 연결된 제품(생산 진행) / 상태: done · todo · wait(앞 단계 전)
export function quoteChain(q, { item } = {}) {
    const cost = purposeOf(q) === 'cost';
    const conf = (q?.status || 'draft') === 'confirmed';
    const s = (done, prev) => done ? 'done' : prev ? 'todo' : 'wait';
    const ordered = !!(item || q?.item_id);
    const billed = cost ? !!q?.billed_at : q?.tax_status === 'issued';
    const paid = !!q?.paid_at;
    const paidAmt = num(q?.paid_amount);
    return [
        { k: 'confirm', label: '확정', state: conf ? 'done' : 'todo', text: conf ? '확정됨' : '발송·확정 전' },
        { k: 'order', label: cost ? '발주' : '제작 연결', state: s(ordered, conf), text: ordered ? `제품 ${item?.name || '연결됨'}` : cost ? '이 원가로 발주할 제품을 연결' : '이 견적으로 만들 제품을 연결' },
        { k: 'bill', label: cost ? '청구 받음' : '청구(세금계산서)', state: s(billed, conf), text: billed ? (cost ? `공장 청구 ${ymd(q.billed_at)}` : `발행 ${ymd(q.tax_supply_date || q.tax_issued_at)}`) : cost ? '공장 청구서 받으면 기록' : '세금계산서 발행' },
        { k: 'pay', label: cost ? '지급' : '입금', state: s(paid, billed), text: paid ? `${ymd(q.paid_at)} · ${paidAmt.toLocaleString()}원${paidAmt && paidAmt !== num(q?.total_amount) ? ` (합계와 ${(num(q.total_amount) - paidAmt).toLocaleString()}원 차이)` : ''}` : cost ? '공장에 지급하면 기록' : '입금 확인되면 기록' },
    ];
}
