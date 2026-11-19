//  사장님 11-18: 전역 사이드바 = 대분류 > 중분류, 창 = 페이지.
//  창 안에서 대분류·중분류(형제 화면) 목록을 다시 그리지 않는다 — 'OO 메뉴' 제목·형제 화면 버튼 금지.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const between = (a, b) => { const i = main.indexOf(a); assert.ok(i >= 0, a); return main.slice(i, main.indexOf(b, i + a.length)); };

test("창 안에 'OO 메뉴' 제목(.m3-h)이 없다", () => {
    assert.doesNotMatch(main, /class="m3-h"[^>]*>[^<]*메뉴<\/div>/);
    assert.doesNotMatch(main, /class="m3-h">\$\{[^}]*\}\s*메뉴/);
    for (const t of ['협업 메뉴', '생산 메뉴', '설정 메뉴', 'SNS 메뉴']) assert.ok(!main.includes(`>${t}<`), t);
});

test('형제 화면 버튼 목록(협업·생산·판매·설정·SNS 메뉴) 함수와 마크업이 없다', () => {
    for (const t of ['_collabMenu(', '_prodMenu(', 'sales-section-nav', 'sns-section-nav', 'sns3-menu-side', 'appside-sales-menu', 'c3-menu'])
        assert.ok(!main.includes(t), t);
});

test('맥 창 왼쪽은 자기 보기만 두되 판매·재무는 중분류를 둔다', () => {
    const bar = between('    _appTabBar(', '    // SNS 3단');
    const mac = bar.slice(bar.indexOf('if (this.macMode)'), bar.indexOf('        return `<aside class="appside">'));
    assert.match(mac, /g\.head === 'orders' \|\| g\.head === 'sales'[\s\S]*?category-work-nav[\s\S]*?switchAppTab/);
    assert.match(mac, /const tabs = g\.tabs\.filter\(t => !t\.hidden\)/);
    //  11-19 3단 접근: 상품·생산도 왼쪽 맨 위 중분류(_midNav) + 그 아래 거르기
    assert.match(mac, /g\.head === 'items'\) return `<aside class="appside appside-filter production-work-nav">\$\{this\._midNav\(view\)\}\$\{nav \|\| ''\}<\/aside>`/);
    assert.match(mac, /return nav \? `<aside class="appside appside-filter">\$\{nav\}<\/aside>` : '';/);
    assert.match(css, /\.appwrap\.no-appside\{grid-template-columns:1fr\}/);
    const shell = between('    _snsShell(', '    setSnsMode(');
    assert.match(shell, /const raw = this\._snsSideHtml \|\| ''/);
    assert.match(shell, /this\._midNav\(/, '11-19 P3 마케팅 중분류');
    assert.match(shell, /side \? '' : ' no-side'/);
});

test('협업 창은 자기 목록을 왼쪽에 둔다 — 메모 폴더·할 일 목록·캘린더·연락처 구분·자료실 즐겨찾기', () => {
    //  11-19 3단 접근: 업무·자료 창 5개는 맨 위에 같은 중분류(_midNav)만 두고, 형제 버튼을 따로 그리지 않는다
    const notes = between('            <aside class="nt-side">', '</aside>');
    //  11-19 Q: 메모 창은 같은 중분류를 한 줄 아이콘 바로(_midNav icons)
    assert.match(notes, /^\s*<aside class="nt-side">\s*\$\{this\._midNav\('notes', \{ icons: true \}\)\}/);
    assert.doesNotMatch(notes, /switchAppTab/);
    assert.match(main, /<aside class="rm-side">/);
    assert.match(main, /<aside class="cal-side">/);
    assert.match(main, /<aside class="fd-side">\s*<button class="fd-sclose"[^\n]*\n\s*\$\{this\._midNav\('documents'\)\}\s*\$\{side\('전체', '최근 항목'/);
    for (const section of ['즐겨찾기', '위치', '태그']) assert.ok(main.includes(`sec('${section}'`), section);
    assert.match(main, /구분을 우클릭해 관리/);
    //  메모: 가운데 브랜드 태그 줄·오른쪽 요약 카드 없음(d1c14cc 이전 구조)
    assert.ok(!main.includes('nt-btags'), 'nt-btags');
    assert.match(main, /const sel = list\.find\(n => n\.id === this\.noteSel\) \|\| list\[0\]/, '메모 첫 항목 자동 선택');
    assert.match(main, /이 폴더에는 메모가 없습니다/);
    const calendar = between('    renderCalendar() {', '    //  캘린더에서 더하기');
    assert.doesNotMatch(calendar, /이번 달 자금|구독 \$\{subscriptions\.length\}/, '캘린더 왼쪽 요약 금지');
    assert.match(main, /<span class="rm-ti" aria-hidden="true">\$\{esc\(t\.glyph\)\}<\/span>/, '미리알림 타일은 외부 아이콘 폰트 없이도 보임');
});

test('팀장 반려 11-18 — 주문 시범의 가운데 배송 보기 탭 · 자료실 좁은 화면 위치 버튼 · 연락처 요약 카드 없음', () => {
    assert.match(css, /@media \(min-width:901px\)\{\.appwrap:not\(\.no-appside\) \.nav-dup\{display:none!important\}\}/);
    assert.match(main, /class="mp-seg oms-tabrow order-view-tabs"/, '주문 배송 보기 탭줄');
    assert.match(main, /it-pill\$\{k === '날짜확인' \? '' : ' nav-dup'\}/, 'CS 알약');
    assert.match(main, /class="it-pill nav-dup\$\{/, '재고 브랜드 알약');
    assert.match(main, /it-pills prod-pills nav-dup/, '생산처 분류 탭');
    assert.match(main, /class="fd-loc" onclick="app\.toggleDocSide\(true\)"/);
    assert.match(main, /this\.docSideSheet = false/, '폴더 고르면 닫힘');
    assert.match(css, /\.fd\.side-on \.fd-side\{display:block!important/);
    assert.match(css, /\.mac-deskboard\{overflow-x:hidden;overflow-y:auto\}/, '1440 바탕화면 가로 스크롤 금지');
    assert.match(css, /\.mac-deskboard>\.home-view\{[^}]*overflow-x:clip/, '바탕 홈 내부가 창 아래에서 가로 크기를 늘리지 않음');
    assert.match(css, /\.rm-lic,\.rm-detail-memo b\{font-size:12px\}/, '할 일 화면 최소 12px');
    assert.ok(!main.includes('_contactSummaryHTML'), '연락처 요약 카드');
    assert.match(main, /\|\| shownList\[0\] \|\| null/, '연락처 첫 항목 자동 선택');
});

test('할 일 좁은 화면 — 목록 버튼으로 타일·목록 칸을 연다, 고르면 닫힌다', () => {
    assert.match(main, /class="rm-loc" onclick="app\.toggleRemSide\(true\)"/);
    assert.match(main, /setRemList\(l\) \{[^}]*this\.remSideSheet = false;/);
    assert.match(css, /\.rm\.side-on \.rm-side\{display:block!important/);
});

test('메모 좁은 화면 — 본문 목록 버튼으로 메모 목록, 메모 고르면 닫힘(넓은 화면 구조는 그대로)', () => {
    assert.match(main, /class="nt-loc" onclick="app\.toggleNoteList\(true\)"/);
    assert.match(main, /selectNote\(id\) \{[^}]*this\.noteListSheet = false;/);
    assert.match(css, /\.nt>\.nt-side,\.nt>\.nt-list\{display:none!important\}/);
    assert.match(css, /\.nt\.list-on \.nt-list\{display:flex!important/);
    assert.match(css, /\.nt-loc,\.nt-lclose\{display:none\}/, '넓은 화면엔 안 보임');
});

test('메모 390 — 범위 칩(개인·시즌·공용)은 도구줄 가로 스크롤 전에 첫 화면에 온전히 보인다(목록 바로 뒤)', () => {
    //  실측(헤드리스 390·360·1440 칩 rect.right ≤ 화면폭): .work/개발자/개편2-B/memo390.mjs
    const m = css.match(/@media \(max-width:820px\)\{\s*\.nt-doc \.nt-tools>\*\{order:2\}\s*\.nt-doc \.nt-tools>\.nt-loc\{order:0\}\s*\.nt-doc \.nt-tools>\.nt-scope\{([^}]*)\}/);
    assert.ok(m, '모바일에서 칩을 목록 뒤로 당기는 규칙');
    assert.match(m[1], /order:1/); assert.match(m[1], /margin-left:0/); assert.match(m[1], /flex:0 0 auto/);
    const bar = between('<div class="nt-tools">', '</div>');
    assert.ok(bar.indexOf('nt-loc') < bar.indexOf('nt-scope'), '칩은 도구줄 안에 그대로(넓은 화면은 오른쪽 끝)');
});
