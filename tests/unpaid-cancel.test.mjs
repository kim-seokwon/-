// 입금 전 취소는 환불 아님(사장님 10-27) — 환불·반품·교환률·환불 금액·클레임 탭 어디에도 안 들어가고, 결제 후 취소·반품은 그대로 환불.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isUnpaidCancel, isRefund, stateLabel, markUnpaid, claimCount, claimSummary, claimMallKeys, fetchClaims } from '../orderRefund.js';

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

test('main.js — 반품·교환률 카드·취소 N건 제외는 sales_monthly 가 아니라 클레임 원본(_claimView)을 쓴다', () => {
    const a = src.indexOf("const cancelThis = (cancelledOrders");
    const card = src.slice(a, src.indexOf('// 브랜드 색상은', a));
    assert.match(card, /this\._claimView\(bf\)/);
    assert.doesNotMatch(card, /salesAggData/);          // 반려2①: 전체 보기도 서버 월집계로 세지 않는다
    assert.doesNotMatch(card, /cancelThisAmt \+=/);
    assert.match(src, /' · 취소 \$\{cancelThisCnt\}건 제외'|` · 취소 \$\{cancelThisCnt\}건 제외`/);
    assert.match(src, /app\.retryClaims\(\)/);         // 반려2④: 실패면 다시 시도 버튼
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
});

// ── 반려2: 클레임 집계(_loadClaimScope) 네 경우 ──
const grab = name => {
    const a = src.indexOf(`    ${name}(`) >= 0 ? src.indexOf(`    ${name}(`) : src.indexOf(`    async ${name}(`);
    const b = src.indexOf('\n    }\n', a) + 6;
    const body = src.slice(a, b).trim().replace(/^async /, '');
    return eval('(' + (src.slice(a, b).includes(`async ${name}(`) ? 'async function ' : 'function ') + body + ')');
};
const loadClaim = grab('_loadClaimScope');
const claimKey = grab('_claimKey');
const claimView = src.slice(src.indexOf('    _claimView(bf)'), src.indexOf('\n', src.indexOf('    _claimView(bf)')));
const claimViewFn = eval('(function ' + claimView.trim().replace(/^_claimView/, '_claimView') + ')');
const retry = eval('(function ' + src.slice(src.indexOf('    retryClaims()'), src.indexOf('\n', src.indexOf('    retryClaims()'))).trim() + ')');
const mockData = { brands: [{ id: 'b1', name: '하이헤이호' }, { id: 'b2', name: '토비' }] };   // eval 된 함수가 찾는 이름
const octClaims = [
    ...Array.from({ length: 56 }, () => ({ op_status: 'cancel', fin_unpaid: true, refund_amount: 0, mall_key: 'hey' })),
    ...Array.from({ length: 112 }, () => ({ op_status: 'cancel', fin_unpaid: false, refund_amount: 1000, mall_key: 'hey' })),
    ...Array.from({ length: 20 }, () => ({ op_status: 'return', fin_unpaid: false, refund_amount: 500, mall_key: 'hey' })),
    ...Array.from({ length: 27 }, () => ({ op_status: 'exchange', fin_unpaid: false, refund_amount: 0, mall_key: 'hey' })),
    ...Array.from({ length: 4 }, () => ({ op_status: 'return', fin_unpaid: false, refund_amount: 700, mall_key: 'tobi' })),
];
//  가짜 supabase — 호출 기록, mall_key 필터 반영, 실패·지연 조절
const mkSb = (opts = {}) => {
    const calls = [];
    return { calls, from: () => { const f = { malls: null }; const q = {
        select: () => q, gte: () => q, lt: () => q, order: () => q, range: (a, b) => { f.a = a; f.b = b; return q; },
        in: (col, v) => { if (col === 'mall_key') f.malls = v; return q; },
        then: (res) => { calls.push(f.malls); const src = opts.rows || octClaims; const go = () => opts.fail?.() ? res({ data: null, error: new Error('timeout') })
            : res({ data: src.filter(r => !f.malls || f.malls.includes(r.mall_key)).slice(f.a ?? 0, (f.b ?? 1e9) + 1), error: null });
            opts.gate ? opts.gate.then(go) : go(); },
    }; return q; } };
};
const mkApp = (sb) => {
    const t = { supabase: sb, malls: [{ mall_key: 'hey', brand_id: 'b1' }, { mall_key: 'tobi', brand_id: 'b2' }],
        range: { from: '2026-10-01T00:00:00+09:00', to: '2026-11-01T00:00:00+09:00' }, renders: 0, ensured: 0,
        requestRender() { this.renders++; }, _salesAllowed: null };
    t._salesScopeRange = function () { return this.range; };
    t._claimKey = claimKey; t._claimView = claimViewFn; t._loadClaimScope = loadClaim; t.retryClaims = retry;
    t.ensureViewData = function () { this.ensured++; return this._loadClaimScope(this._salesBf); };
    return t;
};

test('반려2① 전체 보기 — 회사 전체 클레임(입금 전 취소 제외)을 센다', async () => {
    const sb = mkSb(), t = mkApp(sb);
    await t._loadClaimScope('ALL');
    assert.deepEqual(sb.calls, [null]);                          // 몰 필터 없이 전체
    assert.equal(t._claimView('ALL').cnt, 112 + 20 + 27 + 4);
    assert.equal(t._claimView('ALL').refund, 112 * 1000 + 20 * 500 + 4 * 700);
    //  볼 수 있는 브랜드가 제한된 계정은 그 몰만
    const sb2 = mkSb(), t2 = mkApp(sb2); t2._salesAllowed = new Set(['토비']);
    await t2._loadClaimScope('ALL');
    assert.deepEqual(sb2.calls, [['tobi']]);
    assert.equal(t2._claimView('ALL').cnt, 4);
});

test('반려2② 몰 없는 브랜드(브하스 컨설팅) — 0건, 회사 전체가 붙지 않는다', async () => {
    const sb = mkSb(), t = mkApp(sb);
    await t._loadClaimScope('브하스 (컨설팅)');
    assert.deepEqual(sb.calls, []);                              // 조회 자체를 안 한다
    assert.deepEqual({ cnt: t._claimView('브하스 (컨설팅)').cnt, refund: t._claimView('브하스 (컨설팅)').refund }, { cnt: 0, refund: 0 });
    assert.deepEqual(claimMallKeys([{ mall_key: 'hey', brand_id: 'b1' }], mockData.brands, '브하스 (컨설팅)', null), []);
    assert.deepEqual(await fetchClaims(null, { mallKeys: [], fromISO: 'a', toISO: 'b' }), { cnt: 0, refund: 0 });
});

test('반려2③ 월→연간 전환 — 새 값 받기 전엔 이전 범위 값을 안 보이고, 늦게 온 이전 응답도 버린다', async () => {
    let open; const gate = new Promise(r => (open = r));
    const sb = mkSb(), t = mkApp(sb);
    await t._loadClaimScope('하이헤이호');
    assert.equal(t._claimView('하이헤이호').cnt, 159);
    t.range = { from: '2026-01-01T00:00:00+09:00', to: '2027-01-01T00:00:00+09:00' };   // 연간으로
    assert.equal(t._claimView('하이헤이호'), null);              // 159 를 연간 카드에 재사용하지 않는다
    const sbSlow = mkSb({ gate }); t.supabase = sbSlow;
    const p = t._loadClaimScope('하이헤이호');
    assert.equal(t._claimView('하이헤이호').status, 'loading');
    t.range = { from: '2026-10-01T00:00:00+09:00', to: '2026-11-01T00:00:00+09:00' };   // 받는 중에 다시 월로
    t.claimScope = { key: t._claimKey('하이헤이호'), status: 'ok', cnt: 1, refund: 1 };
    open(); await p;
    assert.equal(t._claimView('하이헤이호').cnt, 1);              // 늦게 온 연간 응답이 덮지 않는다
});

test('반려2④ 조회 실패 — 오류 상태로 남고 저절로 무한 재요청 안 함, 다시 시도하면 받아온다', async () => {
    let failing = true;
    const sb = mkSb({ fail: () => failing }), t = mkApp(sb); t._salesBf = '하이헤이호';
    await t._loadClaimScope('하이헤이호');
    assert.equal(t._claimView('하이헤이호').status, 'error');   // '불러오는 중' 아님
    await t._loadClaimScope('하이헤이호');                       // 렌더마다 다시 부르지 않는다
    assert.equal(sb.calls.length, 1);
    failing = false;
    t.retryClaims(); await new Promise(r => setTimeout(r, 0));
    assert.equal(sb.calls.length, 2);
    assert.equal(t._claimView('하이헤이호').status, 'ok');
    assert.equal(t._claimView('하이헤이호').cnt, 159);
});

test('클레임 1000줄 넘는 범위(연간·전체)도 나눠 받아 다 센다', async () => {
    const rows = Array.from({ length: 2345 }, (_, i) => ({ op_status: i % 2 ? 'cancel' : 'return', fin_unpaid: i < 300, refund_amount: 10, mall_key: 'hey' }));
    const sb = mkSb({ rows });
    const r = await fetchClaims(sb, { mallKeys: null, fromISO: 'a', toISO: 'b' });
    assert.equal(sb.calls.length, 3);
    assert.equal(r.cnt, 2345 - rows.filter((o, i) => i < 300 && o.op_status === 'cancel').length);
});
