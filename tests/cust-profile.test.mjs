// 고객분석(_loadCustProfile · _custMembersAgg · refreshData 무효화) 회귀 테스트 — main.js 함수를 떼어 가짜 DB 위에서 돌린다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const method = (head, name) => {
    const a = src.indexOf('    ' + head);
    assert.ok(a > 0, name + ' 를 main.js 에서 못 찾음');
    const oneLine = src.indexOf('\n', a);
    const b = src.slice(a, oneLine).trimEnd().endsWith('}') ? oneLine : src.indexOf('\n    }\n', a) + 6;
    const body = src.slice(a, b).trim();
    return eval('(' + (body.startsWith('async ') ? 'async function ' + body.slice(6) : 'function ' + body) + ')');
};
const M = {
    _loadCustProfile: method('async _loadCustProfile(brand, force) {', '_loadCustProfile'),
    _retryCustProfile: method('_retryCustProfile(brand) {', '_retryCustProfile'),
    _invalidateCust: method('_invalidateCust() {', '_invalidateCust'),
    _custMembersAgg: method('_custMembersAgg(M) {', '_custMembersAgg'),
    _custMembersHTML: method('_custMembersHTML(m, retry) {', '_custMembersHTML'),
    refreshData: method('async refreshData() {', 'refreshData'),
};
globalThis.tipHTML = () => '<i class="tip-q"></i>'; globalThis.TIPS = {};   // 도움말 ? 툴팁(helpWidget) 자리 — 회원수 문구만 본다
globalThis.mockData = { brands: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }] };
const MALLS = [{ mall_key: 'a1', brand_id: 1, channel: 'cafe24' }, { mall_key: 'b1', brand_id: 2, channel: 'cafe24' }];
const tick = () => new Promise(r => setTimeout(r, 5));

// 표마다 응답을 정한다. hook(table, mallKeys) 가 { data, error, wait } 를 돌려준다.
const mkSb = hook => ({ from: table => { let keys = []; const q = {
    select: () => q, order: () => q, range: () => q, gte: () => q,
    in: (c, vs) => (keys = vs, q),
    then: (res, rej) => { const r = hook(table, keys) || {}; (r.wait || Promise.resolve()).then(() => res({ data: r.data ?? [], error: r.error ?? null })).catch(rej); },
}; return q; } });
const mkApp = hook => {
    const t = { ...M, supabase: mkSb(hook), malls: MALLS, _mallsLoaded: true, renders: 0, requestRender() { this.renders++; } };
    t.ensureViewData = function () { this._loadCustProfile(this.brand); };
    return t;
};

test('브랜드를 빨리 바꿔도 두 브랜드 모두 로드된다(경합)', async () => {
    let release; const gate = new Promise(r => (release = r));
    const t = mkApp((tb, keys) => tb === 'channel_orders' ? { data: [{ id: 1, op_status: 'done', mem: keys[0] }], wait: keys[0] === 'a1' ? gate : null } : { data: [] });
    const pa = t._loadCustProfile('A');
    const pb = t._loadCustProfile('B');          // A 가 아직 도는 중
    await pb; release(); await pa;
    assert.equal(t.custState.A, 'ok'); assert.equal(t.custState.B, 'ok');
    assert.equal(t.custProfile.A[0].mem, 'a1'); assert.equal(t.custProfile.B[0].mem, 'b1');
});

test('실패는 0으로 캐시하지 않고 오류 상태 → [다시 시도] 로 재조회', async () => {
    let fail = true, calls = 0;
    const t = mkApp(tb => { if (tb === 'channel_orders') { calls++; return fail ? { error: { message: 'timeout' } } : { data: [{ id: 9, op_status: 'done' }] }; } return { data: [] }; });
    await t._loadCustProfile('A');
    assert.equal(t.custState.A, 'error'); assert.equal(t.custErr.A, 'timeout');
    assert.equal(t.custProfile, undefined, '실패 결과가 캐시됨');
    await t._loadCustProfile('A');               // 자동 재조회는 안 한다(무한 재시도 방지)
    assert.equal(calls, 1);
    fail = false; await t._retryCustProfile('A'); await tick();
    assert.equal(t.custState.A, 'ok'); assert.equal(t.custProfile.A.length, 1); assert.equal(calls, 2);
    // 회원수 표 오류(표 없음 아닌 것)도 오류로 남는다
    const t2 = mkApp(tb => tb === 'cafe24_member_counts' ? { error: { code: '57014', message: 'canceling' } } : { data: [] });
    await t2._loadCustProfile('A');
    assert.deepEqual(t2.custMembers.A, { error: 'canceling' });
    const t3 = mkApp(tb => tb === 'cafe24_member_counts' ? { error: { code: 'PGRST205', message: 'no table' } } : { data: [] });
    await t3._loadCustProfile('A');
    assert.deepEqual(t3.custMembers.A, { rows: [], malls: ['a1'] });
});

test('동기화(refreshData)는 고객분석 캐시를 비우고 다시 부르며, 그 전 진행 중 결과는 버린다', async () => {
    let n = 0, release; const gate = new Promise(r => (release = r));
    const t = mkApp(tb => tb === 'channel_orders' ? (n++, { data: [{ id: n, op_status: 'done' }], wait: n === 1 ? gate : null }) : { data: [] });
    t.brand = 'A'; t.loadOrders = t.loadMalls = t.loadOrderPage = async function () { this._mallsLoaded = true; }; t.showToast = () => {};
    const old = t._loadCustProfile('A');         // 옛 로드(느림)
    await t.refreshData(); await tick();
    assert.equal(t.custProfile.A[0].id, 2, '새로 불러온 값이어야 함');
    release(); await old;
    assert.equal(t.custProfile.A[0].id, 2, '옛 로드가 새 값을 덮어씀');
});

test('일부 몰만 수집된 날은 합계에서 빼고, 전일 대비는 정확히 전날일 때만', () => {
    const agg = M._custMembersAgg;
    const R = (k, d, n) => ({ mall_key: k, snap_date: d, total: n });
    const malls = ['m1', 'm2'];
    // 10-03 은 m2 누락 → 감소로 보이면 안 된다. 최신 완전일 = 10-02, 전날 10-01 완전 → dPrev 있음
    let r = agg({ malls, rows: [R('m1', '2026-10-01', 100), R('m2', '2026-10-01', 50), R('m1', '2026-10-02', 110), R('m2', '2026-10-02', 52), R('m1', '2026-10-03', 111)] });
    assert.equal(r.date, '2026-10-02'); assert.equal(r.total, 162); assert.equal(r.dPrev, 12);
    assert.deepEqual(r.stale, { date: '2026-10-03', got: 1, need: 2 });
    assert.equal(r.dMonth, null);
    // 전날이 비면(10-05 이전 완전일은 10-02) dPrev = null(—)
    r = agg({ malls, rows: [R('m1', '2026-10-02', 110), R('m2', '2026-10-02', 52), R('m1', '2026-10-05', 120), R('m2', '2026-10-05', 60)] });
    assert.equal(r.date, '2026-10-05'); assert.equal(r.dPrev, null); assert.deepEqual(r.series, [162, 180]);
    // 완전한 날이 하나도 없으면 불완전
    r = agg({ malls, rows: [R('m1', '2026-10-05', 120)] });
    assert.deepEqual(r, { incomplete: true, latest: '2026-10-05', got: 1, need: 2 });
    assert.deepEqual(agg({ error: 'x' }), { error: 'x' });
});

test('회원수 데이터가 없으면 대체지표 안내 — 옛 "권한 연결 후" 문구 없음, 회원수=구매고객이라 하지 않음', () => {
    for (const m of [null, M._custMembersAgg({ rows: [], malls: ['a1'] })]) {
        const h = M._custMembersHTML(m);
        assert.match(h, /API 권한 미제공으로 자동 수집할 수 없습니다/);
        assert.match(h, /구매고객 수·추이를 운영 지표로/);
        assert.match(h, /전체 회원수와 다른 지표/);
        assert.doesNotMatch(h, /권한 연결 후/);
    }
    // 스냅샷이 있으면 기존 전체 회원수 UI 그대로
    const agg = M._custMembersAgg({ rows: [{ mall_key: 'a1', snap_date: '2026-10-20', total: 100 }, { mall_key: 'a1', snap_date: '2026-10-21', total: 103 }], malls: ['a1'] });
    const h = M._custMembersHTML(agg);
    assert.match(h, /전체 회원수 (<i[^>]*><\/i> )?<b[^>]*>103명/); assert.match(h, /\+3명/); assert.doesNotMatch(h, /API 권한 미제공/);
});
