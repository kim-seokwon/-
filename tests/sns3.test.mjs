//  SNS 운영현황 3단 — 분류 | 광고세트·게시물 목록 | 상세. 수치는 buildPanel 그대로인지
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPanel, sns3Rows, snsSetDetailHtml } from '../adPanel.js';
const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
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
    assert.match(h, /hhh_a/); assert.match(h, /1,000원/); assert.match(h, /최근 3일 1,000원 · 판정선 없음/);
    assert.match(h, /판정선 없음/);
});

test('최근 3일 합산은 어제까지 3일만 쓰고 누적을 함께 보존한다', () => {
    const rules = { 'b-hhh': { up_max: 700, stop_over: 900 } };
    const g = buildPanel({ links: [{ ad_id: 'a', adset_id: 's', adset_name: 'hhh_three', adset_status: 'ACTIVE', brand_id: 'b-hhh', adset_start: '2026-11-10' }],
        daily: [{ ad_id: 'a', day: '2026-11-12', spend: 9999, follows: 9 }, { ad_id: 'a', day: '2026-11-13', spend: 7000, follows: 10 },
            { ad_id: 'a', day: '2026-11-14', spend: 7000, follows: 10 }, { ad_id: 'a', day: '2026-11-15', spend: 7000, follows: 10 },
            { ad_id: 'a', day: '2026-11-16', spend: 99999, follows: 0 }], rulesBy: rules, brands: BRANDS, period: 'three', now: NOW });
    const s = g[0].sets[0];
    assert.deepEqual([s.spend, s.follows, s.cpf, s.kind], [21000, 30, 700, 'up']);
    assert.deepEqual([s.spendCum, s.followsCum], [30999, 39]);
});

test('SNS 표는 필요한 열·행 작업·새 판정선을 연결하고 실행 요청은 메모리 큐에만 쌓는다', () => {
    for (const token of ['상태</th><th>세트명</th><th>소재</th><th>타겟</th><th>기간</th><th>일예산</th><th>지출 3일/누적</th><th>결과</th><th>판정</th><th>작업',
        "'extend'", "'raise'", "'budget'", "'toggle'", 'requestAdAction({ set_id, action, before, after, daily_delta = null']) assert.ok(main.includes(token), token);
    assert.match(main, /name\.includes\('하이헤이호'\)[\s\S]*?up_max: 700, stop_over: 900/);
    assert.match(main, /name\.includes\('로하이'\)[\s\S]*?up_max: 800, stop_over: 1000/);
    const fn = main.slice(main.indexOf('requestAdAction({'), main.indexOf('// 생산현황 지도', main.indexOf('requestAdAction({')));
    assert.doesNotMatch(fn, /supabase|\.from\(|functions\.invoke/);
});

test('반려2: 기간 한 줄·핵심 결과열 보존·브랜드별 5개 가동·토비 0칩', () => {
    assert.match(main, /`\$\{md\(s\.start\)\}~\$\{md\(s\.end\)\} · \$\{left\(s\.end\)\}`/);
    assert.match(main, /\{ key: 'tovee', name: '토비'/);
    assert.match(main, /missing:\$\{w\.key\}/, '데이터 0건 브랜드도 합성 칩');
    assert.match(main, /coreBrands\.map\(b => `<div class="sns3-brand-kpi">/);
    assert.match(main, /brandActive\(b\)\}\/5/);
    assert.match(main, /sns3-tablepane\$\{pick\?\.type === 'set' \? ' has-detail'/);
});

test('반려3: 부족은 브랜드별 5개 미달만 합하고 뉴스에서도 기존 숫자를 복원한다', () => {
    const at = main.indexOf('    _snsCounts('), end = main.indexOf('\n    }\n', at);
    const Cls = new Function(`return class { ${main.slice(at, end + 7)} }`)();
    const app = new Cls(); app._snsSideCounts = { news: 9 };
    const brands = [{ id: 'h', name: '하이헤이호' }, { id: 'l', name: '로하이스튜디오' }, { id: 't', name: '토비' }];
    const setRows = [
        ...Array.from({ length: 10 }, (_, i) => ({ brand_id: 'h', kind: i ? 'keep' : 'stop', set: { status: 'ACTIVE' } })),
        ...Array.from({ length: 6 }, () => ({ brand_id: 'l', kind: 'up', set: { status: 'ACTIVE' } })),
        { brand_id: 't', kind: 'keep', set: { status: 'ACTIVE' } },
    ];
    assert.deepEqual(app._snsCounts({ allBrands: brands }, { setRows, postRows: [{}, {}] }),
        { active: 17, need: 4, posts: 2, news: 9, stop: 1, keep: 10, up: 6 });
    assert.match(main, /renderSnsNews\(\)[\s\S]*?_snsCounts\(ads, sns3Rows/);
});

test('뉴스는 SNS 네 번째 축이고 옛 news 진입도 SNS 창으로 합친다', () => {
    assert.match(main, /\['decision', 'active', 'posts', 'news'\]/);
    assert.match(main, /if \(view === 'news'\) \{ this\.snsMode = 'news'; view = 'sns'; \}/);
    for (const token of ['renderSnsNews()', 'sns-news-chips', '오늘 요약', '기사 상세', '원문 안전하게 열기']) assert.ok(main.includes(token), token);
});
