//  P0-03 연결 누락 계약 — 합성 데이터만(운영 DB 읽기·쓰기 없음). 근거 .work/개선요청-1118/연결누락.md
import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../linkGaps.js';

const items = [
    { id: 'a', name: '골덴 오버롤', brand_id: 'B1', status: '메인투입', vendor_id: 'V1', tech_pack_id: 'T1', product_id: 'S1', created_at: '2026-10-01' },
    { id: 'b', name: '기모 맨투맨', brand_id: 'B1', status: '샘플 중', vendor_id: null, tech_pack_id: null, product_id: '', created_at: '2026-09-01' },
    { id: 'c', name: '데님', brand_id: 'B1', status: '메인투입', vendor_id: '', tech_pack_id: 'T2', product_id: null, created_at: '2026-10-05' },
    { id: 'd', name: '옛 니트', brand_id: 'B1', status: '출고완료', vendor_id: null, product_id: null, created_at: '2025-01-01' },
    { id: 'e', name: '볼캡', brand_id: 'B2', status: '시작전', vendor_id: 'V2', product_id: 'S2', created_at: '2026-08-01' },
];
const seasons = [{ id: 'S1', name: '26FW 하이헤이호', brand_id: 'B1', start_date: '2026-09-20' }, { id: 'S0', name: '25FW 하이헤이호', brand_id: 'B1', start_date: '2025-09-01' }, { id: 'S2', name: '26FW 로하이', brand_id: 'B2', start_date: '2026-09-01' }];
const vendors = [{ id: 'V1', name: '영진사' }, { id: 'V2', name: '다른공장' }, { id: 'V3', name: '중단공장', status: 'inactive' }];

test('(1) 시즌없음·생산처없음 — 미완료 먼저, 메인투입 먼저, 출고완료는 따로', () => {
    assert.deepEqual(L.gapList(items, 'season').map(i => i.id), ['c', 'b']);
    assert.deepEqual(L.gapList(items, 'season', { includeDone: true }).map(i => i.id), ['c', 'b', 'd']);
    assert.deepEqual(L.gapList(items, 'vendor').map(i => i.id), ['c', 'b']);
    assert.deepEqual(L.gapCounts(items), { season: { open: 2, done: 1, total: 3 }, vendor: { open: 2, done: 1, total: 3 } });
    assert.throws(() => L.gapList(items, 'brand'));
});

test('(1) 후보는 제시만 — 같은 브랜드·가까운 시즌 순, 중단 생산처 제외', () => {
    const sc = L.seasonCandidates(items[2], seasons);
    assert.deepEqual(sc.map(x => x.id), ['S1', 'S0']);
    const vc = L.vendorCandidates(items[2], vendors, items);
    assert.deepEqual(vc.map(x => x.id), ['V1', 'V2']);
    assert.ok(!vc.some(x => x.id === 'V3'));
});

test('(1) 일괄 연결 — 사람이 고른 값만, 이미 연결된 건 덮어쓰지 않음, 자동 지정 금지', () => {
    const r = L.planBulkLink({ items, ids: ['b', 'c', 'a', 'zz', 'c'], gap: 'season', value: 'S1', targets: seasons });
    assert.deepEqual(r.updates, [{ id: 'b', patch: { product_id: 'S1' } }, { id: 'c', patch: { product_id: 'S1' } }]);
    assert.deepEqual(r.skipped, [{ id: 'a', reason: 'already_linked' }, { id: 'zz', reason: 'not_found' }]);
    assert.throws(() => L.planBulkLink({ items, ids: ['b'], gap: 'vendor', value: '', targets: vendors }), /자동 지정 금지/);
    assert.throws(() => L.planBulkLink({ items, ids: ['b'], gap: 'vendor', value: 'V9', targets: vendors }), /없는 대상/);
    assert.throws(() => L.planBulkLink({ items, ids: [], gap: 'vendor', value: 'V1', targets: vendors }));
});

test('(2) 메인투입 판정 — 골덴 오버롤(생산처 있음·작업 0) · 생산처 없음', () => {
    const jobs = [{ id: 'j1', item_id: 'e' }];
    assert.deepEqual(L.mainInputAlerts(items, jobs), [
        { id: 'a', noVendor: false, noPack: false, noJob: true },
        { id: 'c', noVendor: true, noPack: false, noJob: true },
    ]);
    assert.equal(L.mainInputGap(items[0], [{ item_id: 'a' }]), null, '작업 있으면 경고 없음');
    assert.equal(L.mainInputGap(items[1], []), null, '메인투입 아니면 판정 안 함');
});

test('(2) 생산 투입 사전채움 + 확인 후 1회만 생성(합성 store)', async () => {
    const pre = L.prefillVendorJob(items[0]);
    assert.deepEqual(pre.row, { vendor_id: 'V1', title: '골덴 오버롤', stage: '진행중', due_date: null, tech_pack_id: 'T1', item_id: 'a' });
    assert.deepEqual(L.prefillVendorJob(items[2]).missing, ['vendor']);
    const db = []; let calls = 0;
    const store = { jobsOf: async id => db.filter(j => j.item_id === id), insertJob: async row => { calls++; await new Promise(r => setTimeout(r, 5)); db.push(row); return { error: null }; } };
    assert.equal((await L.createVendorJobOnce(store, items[0])).reason, 'need_confirm');
    const [x, y] = await Promise.all([L.createVendorJobOnce(store, items[0], { confirmed: true }), L.createVendorJobOnce(store, items[0], { confirmed: true })]);
    assert.deepEqual([x.created, y.created, y.reason], [true, false, 'in_flight'], '두 번 눌러도 한 건');
    assert.equal((await L.createVendorJobOnce(store, items[0], { confirmed: true })).reason, 'exists');
    assert.equal(calls, 1); assert.equal(db.length, 1);
    assert.equal((await L.createVendorJobOnce(store, items[2], { confirmed: true })).reason, 'missing');
    const bad = { jobsOf: async () => [], insertJob: async () => ({ error: { message: 'rls' } }) };
    assert.deepEqual(await L.createVendorJobOnce(bad, items[0], { confirmed: true }), { created: false, reason: 'error', error: 'rls' });
});

test('(3) 테스트 판정 — 이름은 후보만, 집계 제외는 판정된 것만, 1회 판정', () => {
    const ss = [{ id: 'q1', name: '스모크테스트' }, { id: 'q2', name: '26FW' }, { id: 'q3', name: '[테스트] 시즌' }];
    assert.deepEqual(L.testCandidates(ss, 'products', []).map(x => x.id), ['q1', 'q3']);
    assert.deepEqual(L.excludeTests(ss, [], 'products').map(x => x.id), ['q1', 'q2', 'q3'], '이름만으로 빼지 않음');
    let { verdicts } = L.decideVerdict([], { table: 'products', id: 'q1', verdict: 'test', by: 'u1', at: 't' });
    ({ verdicts } = L.decideVerdict(verdicts, { table: 'products', id: 'q3', verdict: 'real', by: 'u1', at: 't' }));
    assert.deepEqual(L.excludeTests(ss, verdicts, 'products').map(x => x.id), ['q2', 'q3']);
    assert.deepEqual(L.testCandidates(ss, 'products', verdicts), [], '판정한 건 다시 묻지 않음');
    assert.equal(L.excludeTests([{ id: 'q1' }], verdicts, 'tech_packs').length, 1, '표가 다르면 다른 대상');
    assert.equal(L.decideVerdict(verdicts, { table: 'products', id: 'q1', verdict: 'test', by: 'u2' }).changed, false);
    assert.throws(() => L.decideVerdict(verdicts, { table: 'products', id: 'q1', verdict: 'real', by: 'u2' }), /이미 판정/);
    assert.equal(L.decideVerdict(verdicts, { table: 'products', id: 'q1', verdict: 'real', by: 'u2', change: true }).changed, true);
    assert.throws(() => L.decideVerdict([], { table: 'products', id: 'x', verdict: 'maybe', by: 'u' }));
    assert.throws(() => L.decideVerdict([], { table: 'products', id: 'x', verdict: 'test', by: '' }));
});

test('(4) 캐시미어 비니 3건 — 참조된 가운데가 기준, 앞·뒤는 병합 후보, 삭제 함수 없음', () => {
    const cfg = { styleNo: 'CB-1', parts: [1, 2] };
    const packs = [
        { id: 'p1', org_id: 'O', style_name: '캐시미어 비니', created_at: '2026-10-22T04:33:55.632Z', config: { parts: [1, 2], styleNo: 'CB-1' } },
        { id: 'p2', org_id: 'O', style_name: '캐시미어 비니 ', created_at: '2026-10-22T04:33:57.147Z', config: cfg },
        { id: 'p3', org_id: 'O', style_name: '캐시미어  비니', created_at: '2026-10-22T04:33:57.148Z', config: cfg },
        { id: 'p4', org_id: 'O', style_name: '캐시미어 비니', created_at: '2026-10-25T01:00:00Z', config: cfg },
        { id: 'p5', org_id: 'O2', style_name: '캐시미어 비니', created_at: '2026-10-22T05:00:00Z', config: cfg },
    ];
    const g = L.duplicateTechPacks(packs, { items: [{ id: 'i', tech_pack_id: 'p2' }], jobs: [] });
    assert.equal(g.length, 1, '다른 날·다른 조직은 묶지 않음');
    assert.equal(g[0].anchorId, 'p2'); assert.equal(g[0].day, '2026-10-22'); assert.ok(g[0].spanMs < 2000);
    assert.deepEqual(g[0].members.map(m => [m.id, m.role]), [['p2', 'anchor'], ['p1', 'merge_candidate'], ['p3', 'merge_candidate']]);
    const g2 = L.duplicateTechPacks([packs[1], { ...packs[2], config: { styleNo: 'CB-2' } }], {});
    assert.equal(g2[0].members[1].role, 'review', 'config 다르면 확인만');
    assert.ok(!Object.keys(L).some(k => /delete|remove|merge(?!_)/i.test(k)), '삭제·병합 실행 함수 없음');
});

test('(5) 정산 #unknown 과 내부재고 미연결은 따로 센다', () => {
    const rows = [
        { gkey: '#unknown', platform: 'kidikidi', ym: '2025-07', amt: 2152760 },
        { gkey: '#unknown', platform: 'kidikidi', ym: '2025-12', amt: 3724000 },
        { gkey: '#unknown', platform: 'kidikidi', ym: '2026-03', amt: 2774400 },
        { gkey: '#ship', platform: 'cafe24', ym: '2026-03', amt: 3000 },
        { gkey: 'P1', platform: 'cafe24', ym: '2026-03', amt: 10000 },
    ];
    const u = L.settlementUnknown(rows);
    assert.equal(u.amount, 8651160);
    assert.deepEqual([...new Set(u.parts.map(p => p.cause))], ['source_single_line']);
    assert.equal(L.unknownCause({ platform: 'cafe24' }), 'unclassified');
    const lines = [{ channel_order_id: 'o1', product_name: '맨투맨', inventory_item_id: null }, { channel_order_id: 'o1', product_name: '배송비', inventory_item_id: null },
        { channel_order_id: 'o2', product_name: '팬츠', inventory_item_id: '' }, { channel_order_id: 'o3', product_name: '캡', inventory_item_id: 'inv1' }];
    assert.deepEqual(L.inventoryUnmapped(lines), { kind: 'inventory_unmapped', cause: 'inventory_unmapped', lines: 2, orders: 2 });
    const h = L.linkHealth({ salesRows: rows, orderLines: lines });
    assert.notEqual(h.unknown.kind, h.inventory.kind);
    assert.ok(!('amount' in h.inventory), '재고 미연결은 금액으로 합치지 않음');
});
