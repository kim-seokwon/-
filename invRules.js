//  재고 집계 기준·이력·마이너스 원인(개선요청 9) — DB 를 부르지 않는다(이력 조회만 받은 client 로). 화면(main.js)과 시험이 같은 함수를 쓴다.
//  ① 운영 품목 한 기준: active 이고 is_test 가 아님(141). 서버 주간 브리핑(089 → 141 패치)과 같은 식이다.
//     이름·SKU 글자로 테스트를 짐작하지 않는다 — 글자 일치는 '후보' 안내에만 쓴다(자동 분류 없음).
//  ② 마이너스·안전재고 이하·재발주는 운영 품목에서만 센다. 왼쪽 메뉴·경고·재발주 목록·브리핑이 같은 함수를 쓴다.
//  ③ 이력은 고른 품목 하나의 전체(기초재고 포함)를 쪽 단위로 읽는다.
//  ④ 마이너스 원인은 품목 전체 원장 요약(141 inventory_item_flow 또는 그 품목 전체 이력)으로만 판정한다.

export const isTestItem = i => !!i && i.is_test === true;
export const isOpItem = i => !!i && i.active !== false && !isTestItem(i);
//  테스트로 보이는 이름 — 표시 안내만(분류는 사람이 한다)
export const TEST_HINT_RX = /^test|테스트|^\[?test\]?/i;
export const looksTest = i => !!i && !isTestItem(i) && (TEST_HINT_RX.test(String(i.sku || '')) || TEST_HINT_RX.test(String(i.name || '')));

export const isNeg = i => Number(i && i.on_hand) < 0;
//  089 와 같은 식: 안전재고가 0보다 클 때만 본다(0/0 품목을 '부족'으로 세지 않는다)
export const isLow = i => Number(i && i.safety_stock) > 0 && Number(i.on_hand) <= Number(i.safety_stock);

//  재발주 = 안전재고 이하(low) ∪ 리드타임 안에 품절 예상(soon). 운영 품목만.
export function reorderRows(items, orders, { lead = 14, win = 30, now = Date.now() } = {}) {
    const nameQty = {};
    (orders || []).forEach(o => {
        if (!o || !o.order_date) return;
        if ((now - new Date(o.order_date).getTime()) / 864e5 > win) return;
        (o.items || []).forEach(it => { const n = String(it.product_name || '').trim(); if (n) nameQty[n] = (nameQty[n] || 0) + (Number(it.quantity) || 1); });
    });
    const velOf = item => {
        const nm = String(item.name || '').trim(); if (!nm) return 0;
        let q = nameQty[nm] || 0;
        if (!q) for (const k in nameQty) { if (k.includes(nm) || nm.includes(k)) q += nameQty[k]; }
        return q / win;
    };
    return (items || []).filter(isOpItem).map(i => {
        const v = velOf(i), oh = Number(i.on_hand) || 0;
        const days = v > 0 ? Math.floor(oh / v) : null;
        const low = isLow(i), soon = days !== null && days <= lead;
        return { i, v, days, low, soon };
    }).filter(r => r.low || r.soon).sort((a, b) => (a.days ?? 999) - (b.days ?? 999));
}

//  화면 숫자 한 벌 — 왼쪽 메뉴·경고·재발주 목록이 이것만 읽는다
export function invCounts(items, orders, opt) {
    const op = (items || []).filter(isOpItem);
    const reorder = reorderRows(items, orders, opt);
    const byBrand = {};
    op.forEach(i => { const k = String(i.brand_id ?? ''); byBrand[k] = (byBrand[k] || 0) + 1; });
    return {
        all: op.length, neg: op.filter(isNeg).length, low: op.filter(isLow).length,
        reorder: reorder.length, reorderRows: reorder, byBrand,
        excluded: (items || []).length - op.length, test: (items || []).filter(isTestItem).length,
    };
}

//  ── 이력 ─────────────────────────────────────────────
export const HIST_PAGE = 1000, HIST_MAX_PAGES = 50;   // 한 품목 5만 줄까지(넘으면 truncated)
const viewMissing = e => !!e && (e.code === '42P01' || e.code === 'PGRST205' || /inventory_ledger_history/.test(String(e.message || '')) && /not exist|could not find/i.test(String(e.message || '')));
//  고른 품목 하나의 이력 전체. 최신순. 보기(127)가 없으면 원장 그대로. 쿼리 수 = 쪽 수(품목 수와 무관 — N+1 없음).
export async function fetchItemHistory(sb, itemId, { page = HIST_PAGE, maxPages = HIST_MAX_PAGES } = {}) {
    let table = 'inventory_ledger_history';
    const rows = [];
    for (let p = 0; p < maxPages; p++) {
        const q = () => sb.from(table).select('*').eq('inventory_item_id', itemId)
            .order('created_at', { ascending: false }).order('id', { ascending: false }).range(p * page, p * page + page - 1);
        let { data, error } = await q();
        if (error && p === 0 && table === 'inventory_ledger_history' && viewMissing(error)) { table = 'inventory_ledger'; ({ data, error } = await q()); }
        if (error) throw error;
        rows.push(...(data || []));
        if (!data || data.length < page) return { rows, truncated: false, source: table };
    }
    return { rows, truncated: true, source: table };
}

//  ── 마이너스 원인 ─────────────────────────────────────
const BASE_REASONS = ['initial', 'restock', 'adjust'];
const SOLD_REASONS = ['cafe24_order', 'channel_reconcile'];
const sellableRow = l => (l.bucket || 'sellable') === 'sellable';
//  전체 이력 → 원장 요약(141 inventory_item_flow 와 같은 칸)
export function flowFromRows(rows) {
    const s = (rows || []).filter(sellableRow);
    const base = s.filter(l => BASE_REASONS.includes(l.reason));
    const lastBase = base.reduce((m, l) => (!m || String(l.created_at) > m ? String(l.created_at) : m), null);
    const sum = f => s.filter(f).reduce((t, l) => t + (Number(l.delta) || 0), 0);
    return {
        base_n: base.length, last_base_at: lastBase,
        sold: -sum(l => SOLD_REASONS.includes(l.reason)),
        sold_since_base: lastBase ? -sum(l => SOLD_REASONS.includes(l.reason) && String(l.created_at) > lastBase) : -sum(l => SOLD_REASONS.includes(l.reason)),
        manual: sum(l => l.reason === 'manual'),
    };
}
//  flow 가 없으면(141 미적용·이력 못 읽음) 원인을 지어내지 않는다 — kind 'unknown'
export function negCause(it, flow) {
    if (!isNeg(it)) return null;
    const oh = Number(it.on_hand);
    if (!flow) return { kind: 'unknown', title: `마이너스 재고 ${oh}개 — 원인을 아직 확인하지 못했습니다`,
        body: '이동 이력을 불러온 뒤 원인을 판정합니다 — 불러오지 못했으면 다시 시도하세요.' };
    const manual = Number(flow.manual) || 0;
    const man = manual ? ` (수동 조정 ${manual > 0 ? '+' : ''}${manual})` : '';
    if (!Number(flow.base_n)) return { kind: 'no_base', title: `기초재고가 없어 판매 차감만 쌓였습니다 (${oh}개)`,
        body: `시작 수량·입고·실사가 한 번도 기록되지 않은 채 카페24 판매 ${Number(flow.sold) || 0}개가 빠졌습니다${man}. 창고에서 실제 수량을 세어 '실사 보정'으로 맞추세요.` };
    return { kind: 'oversold', title: `판매가 기록된 입고보다 많습니다 (${oh}개)`,
        body: `마지막 입고·보정 이후 판매 ${Number(flow.sold_since_base) || 0}개가 빠졌습니다${man}. 빠진 입고가 있는지 확인하고, 실제 수량을 세어 '실사 보정'으로 맞추세요.` };
}
//  최근 차감 내역(판매가능 칸에서 빠진 줄) — 조정창에 보여준다
export const recentDeductions = (rows, n = 5) => (rows || []).filter(l => sellableRow(l) && Number(l.delta) < 0).slice(0, n);

//  원인 확인을 받아야 하는 조정: 판매가능을 직접 바꾸는 실사 보정·수동 증감, 그리고 지금 마이너스일 때
export const CAUSE_GATED_MODES = ['count', 'manual'];
export const needsCauseCheck = (it, modeKey) => isNeg(it) && CAUSE_GATED_MODES.includes(modeKey);
//  원장에 남길 확인 기록(141 neg_cause) — 판정 종류와 문장을 같이
export const causeStamp = c => c ? `[${c.kind}] ${c.title}`.slice(0, 300) : '';
