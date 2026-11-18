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

test('맥 창 왼쪽은 그 화면 자신의 거르기만, 없으면 2단', () => {
    const bar = between('    _appTabBar(', '    // SNS 3단');
    const mac = bar.slice(bar.indexOf('if (this.macMode)'), bar.indexOf('        return `<aside class="appside">'));
    assert.doesNotMatch(mac, /switchAppTab|g\.tabs/);
    assert.match(mac, /const nav = this\._viewNav\(view\);\s*return nav \? `<aside class="appside appside-filter">\$\{nav\}<\/aside>` : '';/);
    assert.match(css, /\.appwrap\.no-appside\{grid-template-columns:1fr\}/);
    assert.match(between('    _snsShell(', '    setSnsMode('), /sns3-layout no-side/);
});

test('협업 창은 자기 목록을 왼쪽에 둔다 — 메모 폴더·할 일 목록·캘린더·연락처 구분·자료실 즐겨찾기', () => {
    const notes = between('            <aside class="nt-side">', '</aside>');
    assert.doesNotMatch(notes, /switchAppTab/);
    assert.match(main, /<aside class="rm-side">/);
    assert.match(main, /<aside class="cal-side">/);
    assert.match(main, /<aside class="fd-side">\s*<button class="fd-sclose"[^\n]*\n\s*\$\{side\('전체', '최근 항목'/);
    for (const section of ['즐겨찾기', '위치', '태그']) assert.ok(main.includes(`sec('${section}'`), section);
    assert.match(main, /구분을 우클릭해 관리/);
    //  메모: 가운데 브랜드 태그 줄·오른쪽 요약 카드 없음(d1c14cc 이전 구조)
    assert.ok(!main.includes('nt-btags'), 'nt-btags');
    assert.match(main, /메모를 선택하세요/);
});

test('팀장 반려 11-18 — 왼쪽과 같은 가운데 탭은 넓은 화면에서 숨김 · 자료실 좁은 화면 위치 버튼 · 연락처 요약 카드 없음', () => {
    assert.match(css, /@media \(min-width:901px\)\{\.appwrap:not\(\.no-appside\) \.nav-dup\{display:none!important\}\}/);
    assert.match(main, /class="mp-seg oms-tabrow nav-dup"/, '주문 상태 탭줄');
    assert.match(main, /it-pill\$\{k === '날짜확인' \? '' : ' nav-dup'\}/, 'CS 알약');
    assert.match(main, /class="it-pill nav-dup\$\{/, '재고 브랜드 알약');
    assert.match(main, /it-pills prod-pills nav-dup/, '생산처 분류 탭');
    assert.match(main, /class="fd-loc" onclick="app\.toggleDocSide\(true\)"/);
    assert.match(main, /this\.docSideSheet = false/, '폴더 고르면 닫힘');
    assert.match(css, /\.fd\.side-on \.fd-side\{display:block!important/);
    assert.ok(!main.includes('_contactSummaryHTML'), '연락처 요약 카드');
    assert.match(main, /'연락처'\}를 선택하세요/);
});

test('할 일 좁은 화면 — 목록 버튼으로 타일·목록 칸을 연다, 고르면 닫힌다', () => {
    assert.match(main, /class="rm-loc" onclick="app\.toggleRemSide\(true\)"/);
    assert.match(main, /setRemList\(l\) \{[^}]*this\.remSideSheet = false;/);
    assert.match(css, /\.rm\.side-on \.rm-side\{display:block!important/);
});

test('메모 좁은 화면 — 본문 목록 버튼으로 메모 목록, 메모 고르면 닫힘(넓은 화면 구조는 그대로)', () => {
    assert.match(main, /class="nt-loc" onclick="app\.toggleNoteList\(true\)"/);
    assert.match(main, /selectNote\(id\) \{[^}]*this\.noteListSheet = false;/);
    assert.match(css, /\.nt\.list-on \.nt-list\{display:flex!important/);
    assert.match(css, /\.nt-loc,\.nt-lclose\{display:none\}/, '넓은 화면엔 안 보임');
});
