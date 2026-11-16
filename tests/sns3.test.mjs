//  SNS 운영현황 3단 — 배치만 바꾸고 수치는 buildPanel 그대로인지
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPanel, snsColumns, sns3Html } from '../adPanel.js';
const BRANDS = [{ id: 'b-hhh', name: '하이헤이호' }, { id: 'b-lohi', name: '로하이스튜디오' }, { id: 'b-tovee', name: '토비' }, { id: 'b-mm', name: '머문' }];
const NOW = Date.parse('2026-11-16T12:00:00+09:00');
const links = [['a1', 's1', 'hhh_a', 'ACTIVE', 'b-hhh'], ['a2', 's2', 'hhh_b', 'PAUSED', 'b-hhh'], ['a3', 's3', 'tovee_a', 'ACTIVE', 'b-tovee'], ['a4', 's4', 'mm_a', 'ACTIVE', 'b-mm']]
    .map(([ad_id, adset_id, adset_name, adset_status, brand_id]) => ({ ad_id, adset_id, adset_name, adset_status, brand_id }));
const daily = links.map((l, i) => ({ ad_id: l.ad_id, day: '2026-11-15', spend: 10000 * (i + 1), follows: 10 }));
const groups = buildPanel({ links, daily, rulesBy: {}, brands: BRANDS, period: 'cum', now: NOW });
const igCards = [{ brand_id: 'b-lohi', html: '<div class="glass">LOHI-IG</div>' }, { brand_id: 'b-mm', html: '<div class="glass">MM-IG</div>' }, { brand_id: null, html: '<div class="glass">NOBRAND-IG</div>' }];

test('3열 순서 = 하이헤이호·로하이·토비, 그 밖은 아래로', () => {
    const { cols, extraGroups, extraIg } = snsColumns({ groups, brands: BRANDS, igCards });
    assert.deepEqual(cols.map(c => c.name), ['하이헤이호', '로하이스튜디오', '토비']);
    assert.equal(cols[0].group.sets.length, 2); assert.equal(cols[1].group, null); assert.equal(cols[1].ig.length, 1);
    assert.deepEqual(extraGroups.map(g => g.name), ['머문']); assert.equal(extraIg.length, 2);
});
test('수치는 buildPanel 그대로 · 진행 먼저 · 토글 하나', () => {
    const h = sns3Html({ groups, brands: BRANDS, igCards, period: 'cum', now: NOW });
    assert.equal((h.match(/class="ap-tog"/g) || []).length, 1);
    const g = groups.find(g => g.brand_id === 'b-hhh');
    assert.ok(h.includes(`${g.cpf.toLocaleString('ko-KR')}원`));
    assert.ok(h.indexOf('hhh_a') < h.indexOf('꺼진·종료 세트 1개') && h.indexOf('꺼진·종료 세트 1개') < h.indexOf('hhh_b'));
    assert.match(h, /이 기간에 집행된 광고 세트가 없어요/);   // 로하이 = 세트 없음
    assert.ok(h.indexOf('class="sns3-cols"') < h.indexOf('그 밖의 계정') && h.indexOf('그 밖의 계정') < h.indexOf('MM-IG'));
});
