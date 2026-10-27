// 입금 전 취소는 환불 아님(사장님 10-27) — 환불·반품·교환률·환불 금액·클레임 탭 어디에도 안 들어가고, 결제 후 취소·반품은 그대로 환불.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isUnpaidCancel, isRefund, stateLabel, markUnpaid, claimCount, claimSummary } from '../orderRefund.js';

const src = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');

//  10월 모양: 입금 전 취소 56 · 결제 후 취소 3 · 반품 2 · 교환 1 · 정상 4
const unpaid = Array.from({ length: 56 }, (_, i) => ({ id: 'u' + i, op_status: 'cancel', pay_amount: null, raw: { paid: 'F' }, fin_unpaid: true }));
const paidCancel = [1, 2, 3].map(i => ({ id: 'c' + i, op_status: 'cancel', pay_amount: 10000, refund_amount: 10000, raw: { paid: 'T' }, fin_unpaid: false }));
const returns = [1, 2].map(i => ({ id: 'r' + i, op_status: 'return', pay_amount: 20000, refund_amount: 20000, raw: { paid: 'T' } }));
const exch = [{ id: 'e1', op_status: 'exchange', pay_amount: 30000, raw: { paid: 'T' } }];
const done = [1, 2, 3, 4].map(i => ({ id: 'd' + i, op_status: 'done', pay_amount: 5000, raw: { paid: 'T' } }));
const all = [...unpaid, ...paidCancel, ...returns, ...exch, ...done];
const st = o => o.op_status;

test('입금 전 취소는 환불이 아니고, 결제 후 취소·반품은 환불이다', () => {
    assert.equal(all.filter(o => isRefund(o, st(o))).length, 5);
    assert.equal(all.filter(o => isUnpaidCancel(o, st(o))).length, 56);
    //  fin_unpaid 만 있거나 raw.paid 만 있어도 잡힌다
    assert.equal(isUnpaidCancel({ fin_unpaid: true }, 'cancel'), true);
    assert.equal(isUnpaidCancel({ raw: { paid: 'F' } }, 'cancel'), true);
    //  결제금액이 비어 있는 결제 후 취소(10월 85건)는 여전히 환불
    assert.equal(isRefund({ pay_amount: null, raw: { paid: 'T' }, fin_unpaid: false }, 'cancel'), true);
    //  교환·정상은 환불 아님, 취소 아닌 미입금 주문은 입금 전 취소 아님
    assert.equal(isRefund(exch[0], 'exchange'), false);
    assert.equal(isUnpaidCancel({ raw: { paid: 'F' } }, 'pre'), false);
});

test('환불 금액에 입금 전 취소가 안 들어간다', () => {
    const amt = all.filter(o => isRefund(o, st(o))).reduce((s, o) => s + (o.refund_amount || 0), 0);
    assert.equal(amt, 70000);
});

test('상태 이름 — 입금 전 취소는 따로, 결제 후 취소는 그대로 취소', () => {
    assert.equal(stateLabel(unpaid[0], 'cancel', '취소'), '입금 전 취소');
    assert.equal(stateLabel(paidCancel[0], 'cancel', '취소'), '취소');
    assert.equal(stateLabel(returns[0], 'return', '반품'), '반품');
});

test('클레임 탭 숫자에서 입금 전 취소만 빠진다', () => {
    assert.equal(claimCount({ cancel: 59, return: 2, exchange: 1, done: 4 }, 56), 6);
    assert.equal(claimCount({ cancel: 3, return: 2 }, undefined), 5);   // 미입금 숫자를 못 받으면 예전 그대로
    assert.equal(claimCount({ cancel: 1 }, 5), 0);                     // 음수 안 됨
});

test('반품·교환률 카드 — 10월 모양: 클레임 159건(결제금액 빈 결제 후 취소 포함), 환불 = 실제 환불액(교환 제외)', () => {
    //  운영 10월: 입금 전 취소 56 · 결제 후 취소 112(이 중 85건 pay_amount NULL) · 반품 20 · 교환 27
    const oct = [
        ...Array.from({ length: 56 }, () => ({ op_status: 'cancel', pay_amount: null, fin_unpaid: true, refund_amount: 0 })),
        ...Array.from({ length: 85 }, () => ({ op_status: 'cancel', pay_amount: null, fin_unpaid: false, refund_amount: 50000 })),
        ...Array.from({ length: 27 }, () => ({ op_status: 'cancel', pay_amount: 80000, fin_unpaid: false, refund_amount: 80000 })),
        ...Array.from({ length: 20 }, () => ({ op_status: 'return', pay_amount: 50000, fin_unpaid: false, refund_amount: 60000 })),
        ...Array.from({ length: 27 }, () => ({ op_status: 'exchange', pay_amount: 120000, fin_unpaid: false, refund_amount: 9999 })),
        ...Array.from({ length: 9 }, () => ({ op_status: 'done', pay_amount: 30000, fin_unpaid: false })),
    ];
    const r = claimSummary(oct);
    assert.equal(r.cnt, 159);
    assert.equal(r.refund, 85 * 50000 + 27 * 80000 + 20 * 60000);
});

test('main.js — 반품·교환률 카드는 sales_monthly 가 아니라 클레임 원본(salesScoped.claims)을 쓴다', () => {
    const a = src.indexOf("const cancelThis = (cancelledOrders");
    const card = src.slice(a, src.indexOf('// 브랜드 색상은', a));
    assert.match(card, /this\.salesScoped\.claims/);
    assert.doesNotMatch(card, /cancelThisAmt \+=/);   // 서버 월집계 pay_amount 를 환불로 더하지 않는다
    assert.match(src, /claims: claimSummary\(claimRows\)/);
});

test('slim 주문에 미입금 표시를 붙인다', () => {
    const rows = markUnpaid([{ id: 1, op_status: 'cancel' }, { id: 2, op_status: 'cancel' }], [1]);
    assert.equal(rows[0].fin_unpaid, true);
    assert.equal(rows[1].fin_unpaid, undefined);
    assert.equal(isRefund(rows[0], 'cancel'), false);
    assert.equal(isRefund(rows[1], 'cancel'), true);
});

test('main.js — 클레임 목록 조회·탭 숫자·브랜드 슬라이스가 입금 전 취소를 뺀다', () => {
    assert.match(src, /filter === 'claim'\) sel = sel\.in\('op_status', \['cancel', 'return', 'exchange'\]\)\.not\('fin_unpaid', 'is', true\)/);
    assert.match(src, /claim: claimCount\(m, unpaidCancel\)/);
    assert.match(src, /cancelled: withItems\.filter\(o => this\._isCancelled\(o\) && !this\._isUnpaidCancel\(o\)\)/);
    assert.match(src, /const refundO = monthO\.filter\(o => this\._isRefund\(o\)\)/);
    //  매출에서는 계속 빠진다
    assert.match(src, /orders: withItems\.filter\(o => o\.pay_amount != null && !this\._isCancelled\(o\)\)/);
});

//  브랜드 상세 슬라이스(_loadSalesScope)를 떼어 가짜 DB로 — 반품·교환 분석 카드에 입금 전 취소가 안 들어가야 한다
test('_loadSalesScope — 입금 전 취소는 반품·취소 목록에도 매출에도 없다', async () => {
    const a = src.indexOf('    async _loadSalesScope(');
    const b = src.indexOf('\n    }\n', a) + 6;
    const fn = eval('(' + src.slice(a, b).replace('async _loadSalesScope(', 'async function _loadSalesScope(').trim() + ')');
    const slim = all.map(({ fin_unpaid, ...o }) => ({ ...o, raw: {}, order_date: '2026-10-10T00:00:00Z' }));   // slim 은 fin_unpaid·paid 없음
    const mkQ = rows => { const q = { select: () => q, eq: () => q, gte: () => q, lt: () => q, in: () => q, order: () => q,
        then: (res) => res({ data: rows, error: null }) }; return q; };
    const t = {
        malls: [], supabase: { from: tb => mkQ(tb === 'channel_orders_slim' ? slim
            : all.filter(o => ['cancel', 'return', 'exchange'].includes(o.op_status)).map(({ id, op_status, fin_unpaid, refund_amount }) => ({ id, op_status, fin_unpaid, refund_amount }))) },
        _itemsFor: async () => [], _orderState: o => o.op_status, requestRender() {}, showToast() {},
    };
    t._isCancelled = o => ['cancel', 'return'].includes(o.op_status);
    t._isUnpaidCancel = o => isUnpaidCancel(o, o.op_status);
    await fn.call(t, '하이헤이호', '2026-10-01', '2026-11-01');
    assert.equal(t.salesScoped.cancelled.length, 5);
    assert.equal(t.salesScoped.orders.length, 5);   // 교환 1 + 정상 4
    assert.ok(!t.salesScoped.cancelled.some(o => o.id.startsWith('u')));
    //  카드: 결제 후 취소 3 + 반품 2 + 교환 1 = 6건, 환불 = 취소·반품 refund_amount 70,000
    assert.deepEqual(t.salesScoped.claims, { cnt: 6, refund: 70000 });
    assert.equal(t.salesScoped.brand, '하이헤이호');
});
