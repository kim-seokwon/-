//  SNS 운영현황 3단 — 분류 | 광고세트·게시물 목록 | 상세. 수치는 buildPanel 그대로인지
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPanel, sns3Rows, snsSetDetailHtml } from '../adPanel.js';
const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const style = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const BRANDS = [{ id: 'b-hhh', name: '하이헤이호', ad_prefixes: ['hhh', '하헤호'] }, { id: 'b-lohi', name: '로하이스튜디오', ad_prefixes: ['lohi'] }, { id: 'b-tovee', name: '토비', ad_prefixes: ['tovee'] }, { id: 'b-mm', name: '머문' }];
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
    for (const token of ["['media','소재','sns-th-media'],['state','상태','sns-th-state'],['name','세트명','sns-th-name']", "['spend','3일 지출','sns-th-spend'],['result','결과','sns-th-result'],['cpf','1명당','sns-th-cpf']", "this._thead('sns_ads'", "this._fltBadge('sns_ads')",
        "'extend'", "'raise'", "'budget'", "'toggle'", 'requestAdAction({ set_id, action, before, after, daily_delta = null']) assert.ok(main.includes(token), token);
    assert.match(main, /const defaultRule = \{[^}]*up_max: 1000, stop_over: 1600/);
    assert.match(main, /Object\.fromEntries\(allBrands\.map\(b => \[b\.id,[\s\S]*?r\.rules[\s\S]*?brand_id[\s\S]*?b\.id/);
    assert.doesNotMatch(main, /name\.includes\('하이헤이호'\)|name\.includes\('로하이'\)|name\.includes\('토비'\)/);
    const fn = main.slice(main.indexOf('requestAdAction({'), main.indexOf('// 생산현황 지도', main.indexOf('requestAdAction({')));
    assert.doesNotMatch(fn, /supabase|\.from\(|functions\.invoke/);
});

test('광고 정리: 운영 중만 기본, 판정 순서와 공용 필터를 유지한다', () => {
    for (const token of ['const currentSets = allSetRows.filter(isCurrent)', 'archivedSets = allSetRows.filter',
        'isCurrent(r) ? verdict(r.kind)', 'sns3-tablepane', 'toggleSnsArchive()', "_applyTbl('sns_ads'", "this.tblFilt.sns_ads.brand"])
        assert.ok(main.includes(token), token);
    assert.match(main, /setRows\.filter\(current\)\.forEach/);
    assert.match(main, /rank\[a\.kind\][\s\S]*cpfBad\(b\) - cpfBad\(a\)/);
    // 기간·지출은 1440 표에서 두 줄로 꺼지면 다음 열을 덮는다.
    assert.match(style, /\.sns-td-period,\.sns-td-spend\{[^}]*white-space:nowrap/);
    assert.match(style, /\.sns3-tablepane \.sns-td-period,[\s\S]*?\.sns3-tablepane \.sns-td-spend[\s\S]*?\{white-space:nowrap/);
});

test('뉴스 정리: 경쟁사 계정별 묶음, 중복 제거, 날짜 구분과 게시물 격자', () => {
    for (const token of ['const dedupKey', 'selectSnsNewsAccount', 'sns-news-account', 'sns-news-grid', "['오늘','어제','이번 주']", '중복 제외'])
        assert.ok(main.includes(token), token);
});

test('재구성: brands 테이블 순서·이름·색을 그대로 필터와 요약에 쓴다', () => {
    assert.match(main, /<span>\$\{esc\(`\$\{md\(s\.start\)\}~\$\{md\(s\.end\)\}`\)\}<\/span><small>\$\{esc\(left\(s\.end\)\)\}<\/small>/);
    assert.match(main, /const coreBrands = pool\.map\(b => \(\{ \.\.\.b, label: b\.name/);
    assert.doesNotMatch(main, /missing:\$\{w\.key\}/);
    assert.match(main, /coreBrands\.map\(b => `<div class="sns3-brand-kpi">/);
    assert.match(main, /brandActive\(b\)\}개/);
    assert.match(main, /m3-list sns3-tablepane/);
    assert.match(main, /pick\?\.type === 'set' \? setDetail : dashboardOverview/);
    assert.match(main, /this\._snsBrandNav = coreBrands\.map/);
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

test('뉴스는 조간이고 동종업계는 경쟁사 계정으로 분리한다', () => {
    assert.match(main, /\['dashboard', 'ads', 'posts', 'followers', 'industry', 'news'\]/);
    assert.match(main, /if \(view === 'news'\) \{ this\.snsMode = 'news'; view = 'sns'; \}/);
    for (const token of ['renderSnsNews()', 'renderSnsMorning()', '경쟁사 계정', '조간 펼치기', '최근 14회']) assert.ok(main.includes(token), token);
});

test('대분류 > 중분류 > 상세: 왼쪽 SNS 메뉴와 가운데 브랜드 필터를 분리한다', () => {
    const dock = main.slice(main.indexOf('    MAC_DOCK = ['), main.indexOf('    _dockFace(', main.indexOf('    MAC_DOCK = [')));
    const launch = main.slice(main.indexOf('    LAUNCH = ['), main.indexOf('    // ============================================================', main.indexOf('    LAUNCH = [')));
    assert.doesNotMatch(dock, /id: 'news'/); assert.doesNotMatch(launch, /\['news', '뉴스'/);
    for (const token of ['대시보드', '광고현황', '게시물기록', '팔로워', '동종업계', '뉴스', '데이터 준비 중', '경쟁사 계정']) assert.ok(main.includes(token), token);
    const snsSide = main.slice(main.indexOf("{ label: 'SNS'"), main.indexOf("        ] },", main.indexOf("{ label: 'SNS'")));
    assert.doesNotMatch(snsSide, /'게시물'/);
    const shell = main.slice(main.indexOf('    _snsShell('), main.indexOf('    setSnsMode(', main.indexOf('    _snsShell(')));
    assert.match(shell, /sns3-menu-side/); assert.match(shell, /sns-section-nav/);
    assert.doesNotMatch(shell, /sns-brand-nav|_snsBrandNav/);
});

test('판매 5개 중분류는 고객·정산의 하위 탭을 합쳐 유지한다', () => {
    const tabs = main.slice(main.indexOf("{ head: 'orders'"), main.indexOf('] },', main.indexOf("{ head: 'orders'")) + 4);
    for (const token of ["{ k: 'orders', t: '주문' }", "{ k: 'cs', t: 'CS' }", "{ k: 'inventory', t: '재고' }",
        "{ k: 'analysis', t: '고객' }", "{ k: 'crm', t: '고객 CRM', hidden: true }",
        "{ k: 'sales', t: '정산' }", "{ k: 'expenses', t: '지출', hidden: true }"]) assert.ok(tabs.includes(token), token);
    const bar = main.slice(main.indexOf('    _appTabBar('), main.indexOf('    // SNS 3단', main.indexOf('    _appTabBar(')));
    assert.match(bar, /g\.head === 'orders'/); assert.match(bar, /appside-sales-menu/); assert.match(bar, /sales-section-nav/);
    assert.match(main, /appwrap\$\{side[\s\S]*?\$\{detail \|\| ''\}/);
});

test('110 인사이트: 없는 뷰는 안전하게 비우고 피로도·성과는 공용 판정을 재사용한다', () => {
    for (const token of ["from('v_ad_fatigue_latest')", "from('v_ad_creative_3d')", "from('v_ad_daily_metrics')", '데이터 준비 중', '단기·측정 제외', 'insightAttrTable(creatives)', 'insightBrandSentences(allAttr', '일별 1명당 추이']) assert.ok(main.includes(token), token);
    assert.match(main, /r\.is_measurable === true/);
    assert.match(style, /\.sns-performance-tr\.weak/);
    assert.match(style, /\.sns-insight-table th \.th-f\{right:5px;opacity:\.68\}/);
});

test('SNS 대시보드: 할 일은 필터 표, 오른쪽은 중복 없는 근거·선택 상세다', () => {
    assert.match(main, /_applyTbl\('sns_dashboard', todoBase, dashVal, todoBase\)/);
    assert.match(main, /_thead\('sns_dashboard', \[\['verdict','판정'\],\['name','광고명'\],\['brand','브랜드'\],\['cpf','1명당 비용'\],\['spend','3일 지출'\]\]\)/);
    assert.match(main, /class="sns-dash-task[\s\S]*?app\.selectSnsItem/);
    assert.match(main, /pick\?\.type === 'set' \? setDetail : dashboardOverview/);
    assert.match(main, /브랜드별 어제 지출·판정 근거/);
    assert.match(main, /가동 세트 · 기준 5개/);
    assert.doesNotMatch(main, /<b>\$\{brandActive\(b\)\}\/5<\/b>/);
    assert.match(style, /\.sns3-layout\{min-height:0;overflow:hidden;background:var\(--card-bg\)\}/);
});

test('광고현황 첫 화면은 동적 브랜드 요약표이고 행을 누르면 브랜드 광고표로 들어간다', () => {
    assert.match(main, /const brandSummaryBase = coreBrands\.map\(brand =>/);
    assert.match(main, /_applyTbl\('sns_ad_brands', brandSummaryBase, brandSummaryVal, brandSummaryBase\)/);
    assert.match(main, /_thead\('sns_ad_brands', \[\['brand','브랜드'\],\['active','진행 광고'\],\['spendYesterday','어제 지출'\],\['spend3','3일 지출'\],\['stop','중단'\],\['up','증액'\],\['keep','유지'\],\['avgCpf','평균 1명당'\]\]\)/);
    assert.match(main, /onclick="app\.openSnsAdsBrand\('\$\{esc\(r\.brand\.id\)\}'\)"/);
    assert.match(main, /closeSnsAdsBrand\(\)/);
    assert.match(main, /snsAdsBrandOpen/);
    const summaryBlock = main.slice(main.indexOf('const brandSummaryBase'), main.indexOf("if (topMode === 'dashboard')"));
    assert.doesNotMatch(summaryBlock, /하이헤이호|로하이|토비|머문/);
    const adRowBlock = main.slice(main.indexOf('const oneRow = r =>'), main.indexOf('const tableRows =', main.indexOf('const oneRow = r =>')));
    assert.doesNotMatch(adRowBlock, /sns-td-brand/);
    assert.match(style, /\.sns3-tablepane \.sns3-table th \.th-f\{right:5px;opacity:\.68\}/);
    assert.match(style, /\.sns-brand-overview-grid\{display:grid;grid-template-columns:1fr/);
    assert.match(style, /\.sns-dashboard-cards \.sns3-kpis\{padding:0 0 14px;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)\}/);
    assert.match(style, /\.sns-brand-summary-table\{width:100%;border-collapse:collapse;table-layout:fixed;font-size:14px/);
});

test('반려4: 광고표 핵심열은 겹침 없는 너비를 쓰고 뉴스 오늘은 KST 하나로 세다', () => {
    for (const token of ['const todayKey = kstYMD()', 'const isToday = x => dayKey(x) === todayKey', 'raw.filter(x => kindOf(x) === \'brands\' && isToday(x))', 'a.posts.filter(isToday).length'])
        assert.ok(main.includes(token), token);
    assert.match(main, /sns-brand-chip/);
    assert.match(style, /grid-template-columns:164px minmax\(0,1fr\) 380px/);
    assert.match(style, /\.sns3-tablepane \.sns-th-media\{width:50px\}/);
    assert.match(style, /\.sns3-tablepane \.sns-th-name\{width:auto\}/);
    assert.match(style, /\.sns3-tablepane \.sns-th-period\{width:94px\}/);
    assert.match(style, /\.sns3-tablepane \.sns-th-spend\{width:88px\}/);
    assert.match(style, /\.sns3-tablepane \.sns3-table\{width:100%;min-width:0;max-width:100%;table-layout:auto\}/);
    assert.match(style, /\.sns3-tablepane \.sns-td-state[^{]*\{white-space:nowrap;overflow:visible;text-overflow:clip\}/);
    assert.match(style, /\.sns-th-target,[^}]*\.sns-td-actions,[^}]*th:last-child\{display:none!important\}/);
    assert.match(style, /\.sns3-tablepane \.sns-td-name b\{[^}]*word-break:keep-all;overflow-wrap:normal/);
});

test('SNS 재구성 반려1: 팔로워 표·요약·상세와 모바일 브랜드 선택을 모두 제공한다', () => {
    for (const token of ["this._thead('sns_followers'", "['brand','브랜드'],['followers','팔로워'],['delta7','7일 증감'],['delta30','30일 증감'],['recent','최근 게시일'],['posts7','7일 게시물']",
        "this._applyTbl('sns_followers'", '게시 중단 확인', 'sns-follow-chart', 'sns-follow-gallery', 'sns-mobile-brands', "mode === 'followers' ? followerCount(b) : brandCount(b)"])
        assert.ok(main.includes(token), token);
    assert.match(main, /this\.tblFilt\.sns_followers\.brand/);
    assert.match(style, /\.sns-follow-table\{width:100%/);
    assert.match(style, /\.sns-mobile-brands\{display:flex/);
});

test('SNS 재구성 반려2: 브랜드 색 단일화·상시 필터·모바일 한 줄·독 페이드를 고정한다', () => {
    for (const token of ['_snsBrandTone(id, label', 'brand?.brand_color', "cls: 'brand'", 'sns-brand-chip', 'this._snsBrandTone(a.brand_id'])
        assert.ok(main.includes(token), token);
    assert.match(style, /\.sns-follow-table th \.th-f\{right:5px;opacity:\.68\}/);
    assert.match(style, /\.sns-follow-table th\.flt \.th-f\{color:#0a84ff\}/);
    assert.match(style, /\.sns-follow-table \.sns-follow-brand span\{display:flex;align-items:center;gap:7px\}/);
    assert.match(style, /mask-image:linear-gradient\(90deg,#000 0,#000 calc\(100% - 34px\),transparent 100%\)/);
});
