import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildFollowerGrowth, loadFollowerSnapshots } from '../followerGrowth.js';

const snap = (key, id, snap_date, followers) => ({ [key]: id, snap_date, followers });

test('7일 증가율: 기간 시작을 0%로 두고 자사·경쟁사를 같은 축으로 계산한다', () => {
    const model = buildFollowerGrowth({
        days: 7, endDate: '2026-11-18',
        ownAccounts: [{ id: 'o1', username: 'ours', active: true }],
        ownSnapshots: [snap('account_id', 'o1', '2026-11-11', 1000), snap('account_id', 'o1', '2026-11-18', 1100)],
        competitors: [{ id: 'c1', name: 'peer', active: true }],
        competitorSnapshots: [snap('competitor_id', 'c1', '2026-11-11', 2000), snap('competitor_id', 'c1', '2026-11-18', 2100)],
    });
    assert.equal(model.start, '2026-11-11');
    assert.equal(model.dates.length, 8);
    assert.equal(model.own[0].points[0].value, 0);
    assert.equal(model.own[0].points.at(-1).value, 10);
    assert.equal(model.competitors[0].points.at(-1).value, 5);
});

test('결측·기준 0: 시작/종료가 없거나 기준 팔로워 0이면 0%가 아니라 자료 부족으로 제외한다', () => {
    const model = buildFollowerGrowth({
        days: 7, endDate: '2026-11-18',
        ownAccounts: [{ id: 'zero', name: 'zero' }, { id: 'missing', name: 'missing' }],
        ownSnapshots: [
            snap('account_id', 'zero', '2026-11-11', 0), snap('account_id', 'zero', '2026-11-18', 20),
            snap('account_id', 'missing', '2026-11-11', 100),
        ],
        competitors: [], competitorSnapshots: [],
    });
    assert.equal(model.own.length, 0);
    assert.deepEqual(model.insufficient.map(x => x.id).sort(), ['missing', 'zero']);
});

test('경쟁사 중앙값은 날짜별 유효 계정만 사용하고 중간 스냅샷 결측은 0으로 채우지 않는다', () => {
    const competitors = ['a', 'b', 'c'].map(id => ({ id, name: id }));
    const rows = [
        snap('competitor_id', 'a', '2026-11-11', 100), snap('competitor_id', 'a', '2026-11-15', 110), snap('competitor_id', 'a', '2026-11-18', 120),
        snap('competitor_id', 'b', '2026-11-11', 200), snap('competitor_id', 'b', '2026-11-15', 240), snap('competitor_id', 'b', '2026-11-18', 260),
        snap('competitor_id', 'c', '2026-11-11', 400), snap('competitor_id', 'c', '2026-11-18', 440),
    ];
    const model = buildFollowerGrowth({ days: 7, endDate: '2026-11-18', competitors, competitorSnapshots: rows });
    const day = model.median.find(x => x.date === '2026-11-15');
    assert.equal(day.value, 15); // a +10%, b +20%, c는 그날 결측 → 둘의 중앙값
    assert.equal(model.competitors[2].points.find(x => x.date === '2026-11-15').value, null);
});

test('운영형 50계정×35일은 1000행 상한을 페이지네이션해 전부 읽는다', async () => {
    const source = Array.from({ length: 50 * 35 }, (_, i) => snap('competitor_id', `c${Math.floor(i / 35)}`, `2026-11-${String(i % 35 + 1).padStart(2, '0')}`, 100 + i));
    const ranges = [];
    const supabase = { from(table) {
        assert.equal(table, 'competitor_snapshots');
        const q = {
            select() { return q; }, gte() { return q; }, order() { return q; },
            range(from, to) { ranges.push([from, to]); return Promise.resolve({ data: source.slice(from, to + 1), error: null }); },
        };
        return q;
    } };
    const rows = await loadFollowerSnapshots(supabase, '2026-10-15');
    assert.equal(rows.length, 1750);
    assert.deepEqual(ranges, [[0, 999], [1000, 1999]]);
});

test('30일 전환과 KST 날짜축, DB 동적 행·읽기 전용 조회 계약', () => {
    const model = buildFollowerGrowth({ days: 30, endDate: '2026-11-18' });
    assert.equal(model.start, '2026-10-19');
    assert.equal(model.dates.length, 31);
    const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    assert.match(main, /setSnsGrowthDays\(days\)/);
    assert.match(main, /buildFollowerGrowth\(\{[\s\S]*?this\.igAccounts[\s\S]*?this\.competitors/);
    assert.match(main, /loadFollowerSnapshots\(this\.supabase, snapSince\)/);
    assert.match(main, /sns-growth-y/);
    assert.doesNotMatch(main.slice(main.indexOf('_snsFollowerGrowthPanel()'), main.indexOf('_snsTopNav(', main.indexOf('_snsFollowerGrowthPanel()'))), /하이헤이호|로하이|토비/);
});

