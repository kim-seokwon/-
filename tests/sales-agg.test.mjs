// A3: 매출 집계 로드(_loadSalesAgg)가 느린 재무 일집계(dashboard_financial_daily)를 기다리지 않는지 — main.js 함수를 떼어 가짜 DB로.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const a = src.indexOf('    async _loadSalesAgg() {');
const b = src.indexOf('\n    }\n', a) + 6;
assert.ok(a > 0, '_loadSalesAgg 를 main.js 에서 못 찾음');
const fn = eval('(' + src.slice(a, b).replace('async _loadSalesAgg()', 'async function _loadSalesAgg()').trim() + ')');

// 표마다 지연(ms)·행·오류를 정한 가짜 supabase. 재무 표는 gate 를 풀어야 응답한다.
const mkSb = (spec) => ({ from: (t) => { const q = {
    select: () => q,
    range: () => q,
    then: (res, rej) => {
        const s = spec[t] || { rows: [] };
        const go = () => s.error ? res({ data: null, error: new Error(s.error) }) : res({ data: s.rows, error: null });
        if (s.gate) s.gate.then(go); else setTimeout(go, s.delay || 0);
    },
}; return q; } });
const deferred = () => { let open; const p = new Promise(r => (open = r)); return { p, open }; };
const core = { sales_monthly: { rows: [{ ym: '2026-10', amt: 1 }] }, sales_daily: { rows: [{ d: '2026-10-01', cnt: 1 }] },
    sales_channel_monthly: { rows: [] }, order_state_totals: { rows: [] }, sales_brand_channel_monthly: { rows: [] } };
const tick = () => new Promise(r => setTimeout(r, 5));

test('재무 일집계가 안 끝나도 핵심 집계는 바로 끝나고, 끝나면 채우고 다시 그린다', async () => {
    const gate = deferred(); let renders = 0;
    const t = { supabase: mkSb({ ...core, dashboard_financial_daily: { gate: gate.p, rows: [{ d: '2026-10-01', actual_paid_amount: 5 }] } }), requestRender() { renders++; } };
    await fn.call(t);                                   // gate 가 닫혀 있어도 여기서 끝나야 한다
    assert.equal(t.salesAggData.monthly.length, 1);
    assert.deepEqual(t.salesAggData.financialDaily, []);
    assert.equal(t._finLoading, true);
    gate.open(); await tick();
    assert.equal(t._finLoading, false);
    assert.equal(t.salesAggData.financialDaily.length, 1);
    assert.equal(renders, 1);
});

test('재무 일집계가 먼저 끝나면 핵심 집계와 함께 들어간다', async () => {
    const t = { supabase: mkSb({ ...Object.fromEntries(Object.entries(core).map(([k, v]) => [k, { ...v, delay: 20 }])),
        dashboard_financial_daily: { rows: [{ d: '2026-10-02' }] } }), requestRender() {} };
    await fn.call(t);
    assert.equal(t.salesAggData.financialDaily.length, 1);
    assert.equal(t._finLoading, false);
});

test('재무 일집계 실패(timeout)는 빈 칸 + 로딩 해제 — 핵심 집계는 그대로', async () => {
    const t = { supabase: mkSb({ ...core, dashboard_financial_daily: { error: 'canceling statement due to statement timeout', delay: 5 } }), requestRender() {} };
    const warn = console.warn; console.warn = () => {};
    try { await fn.call(t); await tick(); await tick(); } finally { console.warn = warn; }
    assert.equal(t._finLoading, false);
    assert.deepEqual(t.salesAggData.financialDaily, []);
    assert.equal(t.salesAggData.daily.length, 1);
});

test('다시 불러오면 옛 재무 응답이 새 결과를 덮지 않는다', async () => {
    const g1 = deferred();
    const t = { supabase: mkSb({ ...core, dashboard_financial_daily: { gate: g1.p, rows: [{ d: 'old' }] } }), requestRender() {} };
    await fn.call(t);
    t.supabase = mkSb({ ...core, dashboard_financial_daily: { rows: [{ d: 'new' }] } });
    await fn.call(t); await tick();
    g1.open(); await tick();
    assert.equal(t.salesAggData.financialDaily[0].d, 'new');
});
