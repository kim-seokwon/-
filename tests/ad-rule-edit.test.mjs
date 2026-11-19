//  116 광고 판정선 수정 — 화면 순수 함수(검증·영향 계산·문구). 합성 데이터만.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as E from '../adRuleEdit.js';

const now = Date.parse('2026-11-18T03:00:00Z');                 // KST 11-18 12시 → 어제 11-17
const B = '00000000-0000-0000-0000-0000000000a1';
const brands = [{ id: B, name: '하이헤이호' }];
const links = [
    { ad_id: 'a1', adset_id: 's1', adset_name: '세트1', effective_status: 'ACTIVE', brand_id: B },
    { ad_id: 'a2', adset_id: 's2', adset_name: '세트2', effective_status: 'ACTIVE', brand_id: B },
    { ad_id: 'a3', adset_id: 's3', adset_name: '세트3', effective_status: 'PAUSED', brand_id: B },
];
//  최근 3일(11-15~17) 팔로워당: s1 = 9000/10 = 900, s2 = 12000/10 = 1200, s3(꺼짐) = 12000/10
const daily = ['2026-11-15', '2026-11-16', '2026-11-17'].flatMap(day => [
    { ad_id: 'a1', day, spend: 3000, follows: day === '2026-11-17' ? 4 : 3 },
    { ad_id: 'a2', day, spend: 4000, follows: day === '2026-11-17' ? 4 : 3 },
    { ad_id: 'a3', day, spend: 4000, follows: day === '2026-11-17' ? 4 : 3 },
]);
const rulesBy = { [B]: { ...E.DEFAULT_RULE, up_max: 1000, stop_over: 1300 } };

test('검증 — RPC 와 같은 규칙, 쉼표·원 허용', () => {
    assert.deepEqual(E.validateRule({ up_max: '1,000', stop_over: '1,300원', min_days: '2', min_spend: '20000' }).value, { up_max: 1000, stop_over: 1300, min_days: 2, min_spend: 20000 });
    assert.equal(E.validateRule({ up_max: 1000, stop_over: 1000 }).errors.stop_over, '증액선보다 커야 합니다');
    assert.equal(E.validateRule({ up_max: 0, stop_over: 1000 }).errors.up_max, '0보다 커야 합니다');
    assert.equal(E.validateRule({ up_max: 'abc', stop_over: 1000 }).errors.up_max, '숫자만');
    assert.equal(E.validateRule({ up_max: 1, stop_over: 2, min_days: 0 }).errors.min_days, '1일 이상');
    assert.ok(E.validateRule({ stop_over: 1200 }, rulesBy[B]).ok, '빈 칸은 지금 값');
    assert.equal(E.ruleChanged(rulesBy[B], { ...rulesBy[B] }), false);
    assert.equal(E.ruleChanged(rulesBy[B], { ...rulesBy[B], stop_over: 1000 }), true);
});

test('영향 — 유지선 1300→1100 이면 진행 중 s2 가 유지→중단, 꺼진 세트는 세지 않음', () => {
    const r = E.ruleImpact({ links, daily, brands, rulesBy, brandId: B, next: { up_max: 1000, stop_over: 1100 }, now });
    assert.equal(r.total, 2);
    assert.equal(r.changed, 1);
    assert.deepEqual(r.moves, [{ from: 'keep', to: 'stop', n: 1 }]);
    assert.match(r.text, /진행 중 2개 중 1개 판정이 바뀜 · 유지→중단 1/);
    const up = E.ruleImpact({ links, daily, brands, rulesBy, brandId: B, next: { up_max: 1250, stop_over: 1300 }, now });
    assert.deepEqual(up.moves, [{ from: 'keep', to: 'up', n: 1 }]);
    assert.match(E.ruleImpact({ links, daily, brands, rulesBy, brandId: B, next: rulesBy[B], now }).text, /바뀌는 광고 없음/);
    assert.match(E.ruleImpact({ links: [], daily: [], brands, rulesBy, brandId: B, next: rulesBy[B], now }).text, /진행 중인 광고가 없어/);
});

test('표 머리 한 줄 · 저장 오류 문구', () => {
    assert.equal(E.ruleLine({ up_max: 1000, stop_over: 1200 }), '증액 ≤1,000 · 유지 ≤1,200');
    assert.equal(E.saveErrorText({ code: '42501', message: 'x' }), '판정선은 조직 관리자만 바꿀 수 있습니다');
    assert.match(E.saveErrorText({ code: 'PGRST202', message: 'Could not find the function public.set_ad_report_rule' }), /116 적용 전/);
    assert.match(E.saveErrorText({ message: '증액선은 0보다 크고 유지선보다 작아야 합니다 (증액 1, 유지 1)' }), /^증액선/);
    assert.match(E.saveErrorText(new Error('fetch failed')), /다시 시도/);
});

test('화면 계약 — 설정 표가 RPC 로 저장하고 "관리자에게 문의" 문구가 없다, 광고현황 머리에 현재 선', () => {
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    const i = main.indexOf('    renderSetAdRules() {'), body = main.slice(i, main.indexOf('\n    renderSetMenu()', i));
    assert.ok(i > 0);
    assert.ok(!body.includes('관리자에게 문의'));
    assert.match(body, /adr-in/);
    assert.match(main, /\.rpc\('set_ad_report_rule', \{/);
    assert.ok(!/from\('ad_report_rules'\)\.(update|upsert|insert)/.test(main), '표 직접 쓰기 금지');
    assert.match(main, /ruleLine\(/);
});
