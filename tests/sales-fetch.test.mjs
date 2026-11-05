// 정산 속도·잘림(11-05) — 1000줄 잘림 없이 다 받기 · 상품줄 동시 받기 · 정산 화면이 주문 원본을 안 기다리기
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { monthWindows, fetchByMonth, fetchItems, itemPool, PAGE } from '../salesFetch.js';

//  PostgREST 처럼 거르는 가짜 표 — gte/lt/lte/in/order(desc)/limit, 그리고 limit 없으면 1000줄에서 자른다
const table = (rows, log = []) => () => {
    const f = []; let lim = PAGE;
    const q = {
        select: () => q,
        in: (c, v) => (f.push(r => v.includes(r[c])), q),
        gte: (c, v) => (f.push(r => r[c] >= v), q),
        lt: (c, v) => (f.push(r => r[c] < v), q),
        lte: (c, v) => (f.push(r => r[c] <= v), q),
        order: () => q,
        limit: n => (lim = Math.min(n, PAGE), q),
        then: res => { log.push(1); const out = rows.filter(r => f.every(g => g(r))).sort((a, b) => (a.order_date < b.order_date ? 1 : -1)).slice(0, lim); setTimeout(() => res({ data: out, error: null }), 1); },
    };
    return q;
};
//  주문 시각은 화면과 같은 '+09:00' 문자열 — 비교가 문자열 순서와 시간 순서가 같도록 한 형식으로만 만든다
const at = (m, d, h, i = 0) => `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(i).padStart(2, '0')}:00+09:00`;

test('달 경계(KST)로 자른다 — 월 화면은 1구간, 연간은 12구간, 끝은 to', () => {
    assert.deepEqual(monthWindows('2026-10-01T00:00:00+09:00', '2026-11-01T00:00:00+09:00'), [['2026-10-01T00:00:00+09:00', '2026-11-01T00:00:00+09:00']]);
    const y = monthWindows('2026-01-01T00:00:00+09:00', '2027-01-01T00:00:00+09:00');
    assert.equal(y.length, 12);
    assert.equal(y[11][0], '2026-12-01T00:00:00+09:00');
    assert.equal(y[11][1], '2027-01-01T00:00:00+09:00');
    for (let i = 1; i < y.length; i++) assert.equal(y[i][0], y[i - 1][1], '구간이 이어진다');
});

test('한 달 1,513건(운영 하이헤이호 10월)도 잘리지 않고 다 받는다 — 페이지 경계에 같은 시각이 걸려도', async () => {
    const rows = [];
    for (let i = 0; i < 1513; i++) rows.push({ id: `o${i}`, order_date: at(10, 1 + (i % 30), 10, Math.floor(i / 30) % 60) });
    //  1000번째 근처에 같은 시각 5건을 심는다
    for (let i = 0; i < 5; i++) rows.push({ id: `tie${i}`, order_date: at(10, 12, 10, 16) });
    const before = await table(rows)().gte('order_date', at(10, 1, 0)).lt('order_date', at(11, 1, 0));
    assert.equal(before.data.length, 1000, '예전 방식(한 번에)은 1000줄에서 잘린다');
    const got = await fetchByMonth(table(rows), '2026-10-01T00:00:00+09:00', '2026-11-01T00:00:00+09:00');
    assert.equal(got.length, rows.length);
    assert.equal(new Set(got.map(r => r.id)).size, rows.length, '중복 없음');
    for (let i = 1; i < got.length; i++) assert.ok(got[i - 1].order_date >= got[i].order_date, '최신순');
});

test('연간 — 달마다 따로(동시에) 받아 합친다 · 기간 밖은 안 들어온다', async () => {
    const rows = [{ id: 'dec25', order_date: '2025-12-31T23:59:00+09:00' }, { id: 'jan27', order_date: '2027-01-01T00:00:00+09:00' }];
    for (let m = 1; m <= 12; m++) for (let i = 0; i < 300; i++) rows.push({ id: `${m}-${i}`, order_date: at(m, 1 + (i % 28), 9, i % 60) });
    const log = [];
    const got = await fetchByMonth(table(rows, log), '2026-01-01T00:00:00+09:00', '2027-01-01T00:00:00+09:00');
    assert.equal(got.length, 3600);
    assert.ok(!got.some(r => r.id === 'dec25' || r.id === 'jan27'));
    assert.equal(log.length, 12, '달마다 1번');
});

test('같은 시각 주문이 1000건을 넘으면 조용히 자르지 않고 오류', async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => ({ id: `s${i}`, order_date: at(10, 5, 12) }));
    await assert.rejects(fetchByMonth(table(rows), '2026-10-01T00:00:00+09:00', '2026-11-01T00:00:00+09:00'), /같은 시각 주문이 1000건/);
});

test('상품줄 — 100개씩, 동시에 최대 8개, 순서·빠짐 없이', async () => {
    let live = 0, peak = 0, calls = 0;
    const sb = { from: () => { let ids; const q = { select: () => q, in: (_c, v) => (ids = v, q),
        then: res => { calls++; live++; peak = Math.max(peak, live); setTimeout(() => { live--; res({ data: ids.map(id => ({ channel_order_id: id })), error: null }); }, 5); } }; return q; } };
    const ids = Array.from({ length: 1234 }, (_, i) => `o${i}`);
    const t0 = Date.now();
    const got = await fetchItems(sb, ids);
    assert.equal(got.length, 1234);
    assert.deepEqual(got.map(r => r.channel_order_id), ids);
    assert.equal(calls, 13);
    assert.ok(peak > 1 && peak <= 8, `동시 ${peak}`);
    assert.ok(Date.now() - t0 < 13 * 5, '차례로 기다리지 않는다');
    assert.deepEqual(await fetchItems(sb, []), []);
});

test('상품줄 한 묶음이 실패해도 나머지는 받고 화면은 뜬다(예전 동작 유지)', async () => {
    let n = 0;
    const sb = { from: () => { let ids; const q = { select: () => q, in: (_c, v) => (ids = v, q),
        then: res => { const k = n++; res(k === 1 ? { data: null, error: new Error('timeout') } : { data: ids.map(id => ({ channel_order_id: id })), error: null }); } }; return q; } };
    const warn = console.warn; console.warn = () => {};
    try { assert.equal((await fetchItems(sb, Array.from({ length: 250 }, (_, i) => i))).length, 150); } finally { console.warn = warn; }
});

test('한 달 화면은 4조각으로 나눠 동시에 — 구간이 빈틈·겹침 없이 이어지고 기간 밖은 안 들어온다', async () => {
    const rows = [{ id: 'sep', order_date: '2026-09-30T23:59:59+09:00' }, { id: 'nov', order_date: '2026-11-01T00:00:00+09:00' }];
    for (let i = 0; i < 1513; i++) rows.push({ id: `o${i}`, order_date: at(10, 1 + (i % 31), Math.floor(i / 31) % 24, i % 60) });
    const spans = [], log = [];
    const build = () => { const q = table(rows, log)(); const g = q.gte, l = q.lt; q.gte = (c, v) => (spans.push(['gte', v]), g(c, v)); q.lt = (c, v) => (spans.push(['lt', v]), l(c, v)); return q; };
    const got = await fetchByMonth(build, '2026-10-01T00:00:00+09:00', '2026-11-01T00:00:00+09:00');
    assert.equal(got.length, 1513);
    assert.equal(log.length, 4, '1000줄 넘는 달도 조각마다 한 번 — 차례 기다림 없음');
    const g = spans.filter(x => x[0] === 'gte').map(x => x[1]).sort(), l = spans.filter(x => x[0] === 'lt').map(x => x[1]).sort();
    assert.equal(g[0], '2026-10-01T00:00:00+09:00'); assert.equal(l[3], '2026-11-01T00:00:00+09:00');
    for (let i = 1; i < 4; i++) assert.equal(g[i], l[i - 1], '앞 조각 끝 = 다음 조각 시작');
});

test('상품줄은 원본 페이지가 올 때마다 바로 — 한 풀(동시 한도 공유)로', async () => {
    let live = 0, peak = 0, calls = 0;
    const sb = { from: () => { let ids; const q = { select: () => q, in: (_c, v) => (ids = v, q),
        then: res => { calls++; live++; peak = Math.max(peak, live); setTimeout(() => { live--; res({ data: ids.map(id => ({ channel_order_id: id })), error: null }); }, 3); } }; return q; } };
    const rows = [];
    for (let m = 1; m <= 12; m++) for (let i = 0; i < 250; i++) rows.push({ id: `${m}-${i}`, order_date: at(m, 1 + (i % 28), 9, i % 60) });
    const pool = itemPool(sb), ps = [];
    let firstItemBeforeAllPages = false, pagesDone = 0;
    const got = await fetchByMonth(table(rows), '2026-01-01T00:00:00+09:00', '2027-01-01T00:00:00+09:00', { onPage: part => { if (calls > 0 && pagesDone < 12) firstItemBeforeAllPages = true; pagesDone++; ps.push(pool(part.map(o => o.id))); } });
    const items = (await Promise.all(ps)).flat();
    assert.equal(got.length, 3000); assert.equal(items.length, 3000);
    assert.equal(new Set(items.map(x => x.channel_order_id)).size, 3000);
    assert.ok(peak <= 8, `동시 ${peak}`);
    assert.ok(firstItemBeforeAllPages, '원본을 다 받기 전에 상품줄 요청이 나갔다');
});

//  main.js — 정산 화면 문턱과 집계 로드를 떼어 본다
const src = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const grab = sig => { const a = src.indexOf(`    ${sig}`); assert.ok(a > 0, sig); const b = src.indexOf('\n    }\n', a) + 6; return src.slice(a, b).trim(); };

test('정산 화면은 집계본만 있으면 그린다 — 주문 원본(500건) 안 기다림 · 집계 실패면 원본 폴백을 기다림', () => {
    const ready = eval('(function ' + src.slice(src.indexOf('    _salesReady()') + 4, src.indexOf('\n', src.indexOf('    _salesReady()'))).trim() + ')');
    assert.equal(ready.call({ _mallsLoaded: true, _salesAggReady: true, salesAggData: { monthly: [] }, _ordersLoaded: false }), true);
    assert.equal(ready.call({ _mallsLoaded: false, _salesAggReady: true, salesAggData: { monthly: [] }, _ordersLoaded: true }), false, '몰은 기다린다');
    assert.equal(ready.call({ _mallsLoaded: true, _salesAggReady: true, salesAggData: null, _ordersLoaded: false }), false, '집계 실패 → 원본 기다림');
    assert.equal(ready.call({ _mallsLoaded: true, _salesAggReady: true, salesAggData: null, _ordersLoaded: true }), true);
    assert.match(grab('renderSales() {'), /^renderSales\(\) \{\n\s+if \(!this\._salesReady\(\)\)/);
});

test('집계 로드는 한 번만 — 정산 진입과 주문 받기가 겹쳐도 같은 회차를 같이 쓴다 · 다시 받기는 끝난 뒤 새로', async () => {
    const reload = eval('(function ' + grab('_reloadSalesAgg(force) {') + ')');
    let loads = 0, gate;
    const t = { _loadSalesAgg: () => { loads++; return new Promise(r => (gate = r)); }, requestRender() {}, ensureViewData() {} };
    const p1 = reload.call(t, false), p2 = reload.call(t, true), p3 = reload.call(t, false);
    assert.equal(loads, 1);
    assert.ok(p1 === p2 && p2 === p3);
    gate(); await p1;
    assert.equal(t._salesAggReady, true);
    reload.call(t, false); assert.equal(loads, 1, '받은 뒤 정산 재진입은 다시 안 받는다');
    reload.call(t, true); assert.equal(loads, 2, '주문 다시 받기(새로고침)는 새로');
});

test('브랜드 상세 슬라이스는 달마다 나눠 받고(1000줄 잘림 없음), 받는 사이 바뀐 브랜드를 이어 받는다', () => {
    const body = grab('async _loadSalesScope(');
    assert.match(body, /fetchByMonth\(slim, fromISO, toISO, \{ onPage/);
    assert.match(body, /fetchByMonth\(claimQ, fromISO, toISO\)/);
    assert.match(body, /this\.requestRender\(\);\n\s+this\.ensureViewData\(\);/);
    assert.match(grab('_itemsFor(ids)'), /fetchItems\(this\.supabase, ids\)/);
});

test('정산 창이 맨 앞이어도 브랜드·월을 누르면 바로 다시 그린다(맥 모드)', () => {
    const go = eval('(function ' + src.slice(src.indexOf('    _salesGo()') + 4, src.indexOf('\n', src.indexOf('    _salesGo()'))).trim() + ')');
    let r = 0, sv = 0;
    go.call({ macMode: true, currentUser: {}, switchView() { sv++; }, requestRender() { r++; } });
    assert.equal(sv, 1); assert.equal(r, 1);
    for (const f of ['setSalesYear', 'setSalesMonth', 'setSalesBrand', 'setSalesMatrixYear']) assert.match(src, new RegExp(`    ${f}\\([a-z]\\) \\{[^}]*this\\._salesGo\\(\\); \\}`), f);
});
