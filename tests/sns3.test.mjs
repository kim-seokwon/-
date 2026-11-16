//  SNS 운영현황 3단 — 분류 | 광고세트·게시물 목록 | 상세. 수치는 buildPanel 그대로인지
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPanel, sns3Rows, snsSetDetailHtml } from '../adPanel.js';
const BRANDS = [{ id: 'b-hhh', name: '하이헤이호' }, { id: 'b-lohi', name: '로하이스튜디오' }, { id: 'b-tovee', name: '토비' }, { id: 'b-mm', name: '머문' }];
const NOW = Date.parse('2026-11-16T12:00:00+09:00');
const links = [['a1', 's1', 'hhh_a', 'ACTIVE', 'b-hhh'], ['a2', 's2', 'hhh_b', 'PAUSED', 'b-hhh'], ['a3', 's3', 'tovee_a', 'ACTIVE', 'b-tovee'], ['a4', 's4', 'mm_a', 'ACTIVE', 'b-mm']]
    .map(([ad_id, adset_id, adset_name, adset_status, brand_id]) => ({ ad_id, adset_id, adset_name, adset_status, brand_id }));
const daily = links.map((l, i) => ({ ad_id: l.ad_id, day: '2026-11-15', spend: 10000 * (i + 1), follows: 10 }));
const groups = buildPanel({ links, daily, rulesBy: {}, brands: BRANDS, period: 'cum', now: NOW });
const accounts = [{ id: 'ig-hhh', brand_id: 'b-hhh', username: 'hhh_hiheyho' }, { id: 'ig-lohi', brand_id: 'b-lohi', username: 'lohi.studio' }];
const posts = [{ card: { media_id: 'm-hhh', brand_id: 'b-hhh', ad_names: ['HHH 게시물'] }, v: { kind: 'up', cpf: 800 } },
    { card: { media_id: 'm-lohi', brand_id: 'b-lohi', ad_names: ['LOHI 게시물'] }, v: { kind: 'keep', cpf: 1200 } }];

test('가운데 목록 = 광고 세트·게시물·인스타 계정, 키는 서로 충돌하지 않는다', () => {
    const r = sns3Rows({ groups, posts, accounts });
    assert.equal(r.setRows.length, 4); assert.equal(r.postRows.length, 2); assert.equal(r.accountRows.length, 2);
    assert.equal(new Set([...r.setRows, ...r.postRows, ...r.accountRows].map(x => x.key)).size, 8);
    assert.deepEqual(r.setRows.slice(0, 2).map(x => x.title), ['hhh_a', 'hhh_b']);
});
test('왼쪽 계정을 고르면 같은 브랜드 항목만 남는다', () => {
    const r = sns3Rows({ groups, posts, accounts, account: 'ig-hhh' });
    assert.deepEqual(r.setRows.map(x => x.brand_id), ['b-hhh', 'b-hhh']);
    assert.deepEqual(r.postRows.map(x => x.id), ['m-hhh']);
    assert.deepEqual(r.accountRows.map(x => x.id), ['ig-hhh']);
});
test('세트 상세는 buildPanel 수치와 판정 근거를 그대로 표시한다', () => {
    const g = groups.find(g => g.brand_id === 'b-hhh');
    const row = sns3Rows({ groups, posts, accounts }).setRows.find(x => x.id === 's1');
    const h = snsSetDetailHtml(row);
    assert.equal(row.cpf, g.sets[0].cpf); assert.equal(row.spend, g.sets[0].spend); assert.equal(row.follows, g.sets[0].follows);
    assert.match(h, /hhh_a/); assert.match(h, /1,000원/); assert.match(h, /지출 10,000원 ÷ 팔로우 10명 = 1,000원/);
    assert.match(h, /판정선 없음/);
});
