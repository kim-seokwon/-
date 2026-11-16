//  광고 판정판 — 세트별 팔로우당 비용 · 증액/유지/중단 (지시 2026-11-16)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { panelVerdict, buildPanel, panelHtml, brandOfLink } from '../adPanel.js';

const HHH = { up_max: 800, stop_over: 1300 }, LOHI = { up_max: 1000, stop_over: 1600 };
const BRANDS = [{ id: 'b-hhh', name: '하이헤이호' }, { id: 'b-lohi', name: '로하이스튜디오' }, { id: 'b-tovee', name: '토비' }];
const RULES = { 'b-hhh': HHH, 'b-lohi': LOHI, 'b-tovee': LOHI };
const NOW = Date.parse('2026-11-16T03:00:00Z');                     // KST 11-16 12:00 → 어제 = 11-15
const FX = JSON.parse(readFileSync(new URL('./fixtures/ad-panel-1116.json', import.meta.url)));

test('경계값 — 하이헤이호 800/801/1300/1301', () => {
    assert.deepEqual([800, 801, 1300, 1301].map(c => panelVerdict(c * 10, 10, HHH)), ['up', 'keep', 'keep', 'stop']);
});
test('경계값 — 로하이·토비 1000/1001/1600/1601', () => {
    assert.deepEqual([1000, 1001, 1600, 1601].map(c => panelVerdict(c * 10, 10, LOHI)), ['up', 'keep', 'keep', 'stop']);
    assert.equal(panelVerdict(1000.5 * 2, 2, LOHI), 'keep');        // 반올림 전 값으로 판정
});
test('팔로우 0 = 무한대 → 중단 · 지출 0 = 집행 없음 · 판정선 없음', () => {
    assert.equal(panelVerdict(9866, 0, HHH), 'stop');
    assert.equal(panelVerdict(1, 0, LOHI), 'stop');
    assert.equal(panelVerdict(0, 0, HHH), 'idle');
    assert.equal(panelVerdict(5000, 10, null), 'none');
    const g = buildPanel({ links: [{ ad_id: 'a', adset_id: 's', adset_name: 'hhh_x', adset_status: 'ACTIVE' }], daily: [{ ad_id: 'a', day: '2026-11-15', spend: 20000, follows: 0 }],
        rulesBy: RULES, brands: BRANDS, now: NOW });
    assert.equal(g[0].sets[0].kind, 'stop'); assert.equal(g[0].sets[0].cpf, null);
    assert.match(panelHtml({ groups: g, now: NOW }), /<td class="ap-c">∞<\/td>/);
});
test('판정선은 규칙 행에서 — 값을 바꾸면 판정이 바뀐다', () => {
    assert.equal(panelVerdict(15000, 10, HHH), 'stop');
    assert.equal(panelVerdict(15000, 10, { up_max: 1500, stop_over: 2000 }), 'up');
});

test('기준값 6개 — 실제 11-14~15 데이터(누적 = 세트 시작 11-14 ~ 어제 11-15)', () => {
    const g = buildPanel({ ...FX, rulesBy: RULES, brands: BRANDS, period: 'cum', now: NOW });
    const by = Object.fromEntries(g.flatMap(b => b.sets.map(s => [s.name, [s.spend, s.follows, b.name]])));
    const want = { 'hhh_멜로우오버롤_PV': [34703, 53, '하이헤이호'], 'hhh_1029핑크코어_PV': [15751, 24, '하이헤이호'], 'hhh_1107메리노베스트_PV': [9866, 1, '하이헤이호'],
        'lohi_1112피그먼트_PV': [19714, 33, '로하이스튜디오'], 'lohi_1110FWBOX금요일_PV': [19683, 10, '로하이스튜디오'], 'tovee_0901가을_PV': [19739, 27, '토비'] };
    for (const [k, v] of Object.entries(want)) assert.deepEqual(by[k], v, k);
    assert.deepEqual(g.map(b => b.name), ['하이헤이호', '로하이스튜디오', '토비']);
    const hhh = g[0].sets;
    assert.equal(hhh.find(s => s.name === 'hhh_멜로우오버롤_PV').kind, 'up');        // 655원
    assert.equal(hhh.find(s => s.name === 'hhh_1107메리노베스트_PV').kind, 'stop');   // 9,866원
    assert.equal(g[1].sets.find(s => s.name === 'lohi_1110FWBOX금요일_PV').kind, 'stop'); // 1,968원
    //  정렬 — 1명당 오름차순(팔로우 0 은 그 아래)
    for (const b of g) { const c = b.sets.filter(s => s.cpf != null).map(s => s.cpf); assert.deepEqual(c, [...c].sort((x, y) => x - y), b.name); }
    //  브랜드 합계 = 지출 합 ÷ 팔로우 합
    for (const b of g) { assert.equal(b.spend, b.sets.reduce((a, s) => a + s.spend, 0)); assert.equal(b.cpf, b.follows ? Math.round(b.spend / b.follows) : null); }
});
test('기간 — 어제는 11-15 하루만, 오늘(11-16)은 안 넣는다', () => {
    const y = buildPanel({ ...FX, rulesBy: RULES, brands: BRANDS, period: 'yesterday', now: NOW });
    const ids = new Set(FX.links.map(l => l.ad_id));
    const sum = FX.daily.filter(d => d.day === '2026-11-15' && ids.has(d.ad_id)).reduce((a, d) => a + d.spend, 0);
    assert.equal(y.reduce((a, b) => a + b.spend, 0), sum);
    const g = buildPanel({ links: [{ ad_id: 'a', adset_id: 's', adset_name: 'lohi_x', adset_status: 'ACTIVE', adset_start: '2026-11-14T00:00:00+0900' }],
        daily: [{ ad_id: 'a', day: '2026-11-13', spend: 999, follows: 9 }, { ad_id: 'a', day: '2026-11-14', spend: 1000, follows: 1 }, { ad_id: 'a', day: '2026-11-16', spend: 5000, follows: 0 }],
        rulesBy: RULES, brands: BRANDS, period: 'cum', now: NOW });
    assert.deepEqual([g[0].spend, g[0].follows], [1000, 1]);              // 시작 전(11-13)·오늘(11-16) 제외
});
test('브랜드 — brand_id 우선, 없으면 세트명 접두사 · 이스케이프', () => {
    assert.equal(brandOfLink({ brand_id: 'x', adset_name: 'lohi_a' }, BRANDS), 'x');
    assert.equal(brandOfLink({ adset_name: 'tovee_0901가을_PV' }, BRANDS), 'b-tovee');
    assert.equal(brandOfLink({ adset_name: '하헤호가디건' }, BRANDS), 'b-hhh');
    assert.equal(brandOfLink({ adset_name: 'zzz' }, BRANDS), null);
    const g = buildPanel({ links: [{ ad_id: 'a', adset_id: 's', adset_name: '<img src=x onerror=1>', adset_status: 'ACTIVE', brand_id: 'b-hhh' }], daily: [], rulesBy: RULES, brands: BRANDS, now: NOW });
    const h = panelHtml({ groups: g, now: NOW });
    assert.ok(!h.includes('<img src=x')); assert.match(h, /집행 없음/);
    assert.doesNotMatch(h, /방문|도달/);
});

test('꺼진 옛 세트 숨김 — 진행 중이거나 최근 7일(11-09~11-15) 지출 있는 세트만(팀장 결정)', () => {
    const L = (id, st) => ({ ad_id: 'a' + id, adset_id: 's' + id, adset_name: 'hhh_' + id, adset_status: st, brand_id: 'b-hhh' });
    const links = [L(1, 'ACTIVE'), L(2, 'PAUSED'), L(3, 'CAMPAIGN_PAUSED'), L(4, 'PAUSED')];
    const daily = [{ ad_id: 'a2', day: '2026-11-09', spend: 5000, follows: 5 },      // 7일 안 → 보임
        { ad_id: 'a3', day: '2026-11-08', spend: 9000, follows: 9 },                  // 8일 전 → 숨김
        { ad_id: 'a4', day: '2026-11-16', spend: 3000, follows: 1 }];                 // 오늘만 → 숨김
    const names = buildPanel({ links, daily, rulesBy: RULES, brands: BRANDS, period: 'cum', now: NOW }).flatMap(g => g.sets.map(s => s.name));
    assert.deepEqual(names.sort(), ['hhh_1', 'hhh_2']);
    //  실데이터: 하헤호가디건·하헤호AI(캠페인 꺼짐, 7일 지출 없음)는 안 나온다
    const all = buildPanel({ ...FX, rulesBy: RULES, brands: BRANDS, period: 'cum', now: NOW }).flatMap(g => g.sets);
    assert.ok(all.every(s => s.status === 'ACTIVE' || s.recent), '숨김 규칙 위반 세트 있음');
});
