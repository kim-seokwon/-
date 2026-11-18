//  108 광고 데이터 제외 — 목표 잘못 설정한 4세트(VISIT_INSTAGRAM_PROFILE)를 판정·합계에서 빼고 화면에 '제외 N세트'를 보인다.
//  실제 11-08~11-16 스냅샷(fixtures/ad-panel-1116.json) 기준 제외 전/후 누적 팔로우당 비용.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPanel, sns3Rows, panelHtml, excludedNote } from '../adPanel.js';

const FX = JSON.parse(readFileSync(new URL('./fixtures/ad-panel-1116.json', import.meta.url)));
const EX = new Set(['120255644017600038', '120255644017680038', '120255644017700038', '120255666999860038']);
const BRANDS = [{ id: 'b-hhh', name: '하이헤이호', ad_prefixes: ['hhh', '하헤호'] }, { id: 'b-lohi', name: '로하이스튜디오', ad_prefixes: ['lohi'] }, { id: 'b-tovee', name: '토비', ad_prefixes: ['tovee'] }];
const RULES = { 'b-hhh': { up_max: 800, stop_over: 1300 }, 'b-lohi': { up_max: 1000, stop_over: 1600 }, 'b-tovee': { up_max: 1000, stop_over: 1600 } };
const NOW = Date.parse('2026-11-16T03:00:00Z');
const mark = on => FX.links.map(l => ({ ...l, excluded: on && EX.has(l.adset_id), excluded_reason: on && EX.has(l.adset_id) ? '목표 오류(VISIT_INSTAGRAM_PROFILE)' : null }));
const run = (on, period = 'cum') => buildPanel({ links: mark(on), daily: FX.daily, rulesBy: RULES, brands: BRANDS, period, now: NOW });
const brief = g => Object.fromEntries(g.map(b => [b.name, [b.spend, b.follows, b.cpf, b.kind]]));

test('누적: 제외 전/후 브랜드 합계·팔로우당 비용·판정', () => {
    assert.deepEqual(brief(run(false)), { 하이헤이호: [304892, 239, 1276, 'keep'], 로하이스튜디오: [266608, 259, 1029, 'keep'], 토비: [45119, 31, 1455, 'keep'] });
    assert.deepEqual(brief(run(true)), { 하이헤이호: [274352, 234, 1172, 'keep'], 로하이스튜디오: [235975, 250, 944, 'up'], 토비: [19739, 27, 731, 'up'] });
    const ex = run(true).excluded;
    assert.deepEqual([ex.sets, ex.spend, ex.follows], [4, 86553, 18]);
});
test('제외 세트는 세트 목록에서도 빠진다 · 이름이 비슷한 _PV 세트는 남는다', () => {
    const names = run(true).flatMap(b => b.sets.map(s => s.name));
    for (const n of ['hhh_멜로우오버롤', 'lohi_FW피그먼트', 'lohi_플리스재킷', 'tovee_0901가을_boost']) assert.ok(!names.includes(n), n);
    for (const n of ['hhh_멜로우오버롤_PV', 'lohi_FW피그먼트_PV', 'tovee_0901가을_PV']) assert.ok(names.includes(n), n);
});
test('어제: 제외 세트가 어제 지출 0이면 판정 그대로, 제외 표시는 남는다', () => {
    assert.deepEqual(brief(run(true, 'yesterday')), brief(run(false, 'yesterday')));
    assert.equal(run(true, 'yesterday').excluded.sets, 4);
});
test('세트에 제외 광고가 하나라도 있으면 세트째 뺀다(제외는 세트 단위)', () => {
    const links = [{ ad_id: 'a', adset_id: 'S', adset_name: 'hhh_x', adset_status: 'ACTIVE', excluded: true }, { ad_id: 'b', adset_id: 'S', adset_name: 'hhh_x', adset_status: 'ACTIVE' }];
    const daily = [{ ad_id: 'a', day: '2026-11-15', spend: 10000, follows: 1 }, { ad_id: 'b', day: '2026-11-15', spend: 5000, follows: 1 }];
    const g = buildPanel({ links, daily, rulesBy: RULES, brands: BRANDS, now: NOW });
    assert.equal(g.length, 0); assert.deepEqual([g.excluded.sets, g.excluded.spend], [1, 10000]);
});
test('화면: "제외 4세트(목표 오류)" 한 줄 · 제외 없으면 안 보임 · 사유는 이스케이프', () => {
    const g = run(true);
    //  SNS 3단 목록 머리줄은 main.js 가 excludedNote(groups.excluded)를 그대로 끼운다
    assert.match(excludedNote(g.excluded), /제외 4세트\(목표 오류\) · 지출 86,553원 · 팔로우 18명은 판정·합계에서 뺌/);
    assert.match(panelHtml({ groups: g, period: 'cum', now: NOW }), /제외 4세트\(목표 오류\)/);
    assert.equal(excludedNote(run(false).excluded), '');
    assert.doesNotMatch(panelHtml({ groups: g, period: 'cum', now: NOW, loading: true }), /제외 \d+세트/);
    //  3단 목록에도 제외 세트가 안 들어간다
    const ids = sns3Rows({ groups: g }).setRows.map(r => r.id);
    assert.ok(ids.length > 0); assert.ok(!ids.some(id => ['120255644017600038', '120255644017680038', '120255644017700038', '120255666999860038'].includes(id)));
    assert.equal(excludedNote(null), '');
    assert.match(excludedNote({ sets: 1, spend: 1, follows: 0, reason: '<b>"x' }), /title="&lt;b&gt;&quot;x"/);
});
test('108 적용 전(excluded 열 없음)에도 깨지지 않고 제외 없이 계산', () => {
    const g = buildPanel({ links: FX.links, daily: FX.daily, rulesBy: RULES, brands: BRANDS, period: 'cum', now: NOW });
    assert.deepEqual(brief(g), brief(run(false))); assert.equal(g.excluded.sets, 0);
});
