import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const style = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

test('전역 사이드바는 업무·협업·기타와 지정된 창/탭을 그린다', () => {
    for (const token of ['MAC_SIDE_GROUPS', "id: 'work', label: '업무'", "id: 'collab', label: '협업'", "id: 'other', label: '기타'",
        "label: '홈'", "['home', '오늘 할 일'", "['home', '오늘 매출'", "['home', '오늘 조간'",
        "['orders', '주문'", "['cs', 'CS'", "['inventory', '재고'", "['analysis', '고객'", "['sales', '정산'",
        "['items', '제품리스트'", "['vendors', '생산현황'", "['tech_packs', '작업지시서'", "['sample_maker', '샘플'", "['quotes', '견적'",
        "['sns', '대시보드'", "['sns', '광고현황'", "['sns', '게시물기록'", "['sns', '팔로워'", "['sns', '동종업계'", "['sns', '뉴스'",
        "['reminders', '할 일'", "['settings', '설정'"])
        assert.ok(main.includes(token), token);
});

test('권한·현재 탭·이동은 기존 창 라우팅을 재사용한다', () => {
    assert.match(main, /if \(!this\._viewAllowed\(view\)\) return ''/);
    assert.match(main, /sideOpen\(view, mode = ''\)[\s\S]*?this\.setSnsMode\(mode\)[\s\S]*?this\.macOpen\(view\)/);
    assert.match(main, /activeView === 'sns'[\s\S]*?activeMode === mode/);
    assert.match(main, /data-view="\$\{esc\(view\)\}"/);
});

test('전체·그룹 접힘 상태는 try-catch localStorage에 남는다', () => {
    for (const token of ['bhas_side_collapsed', 'bhas_side_groups', 'toggleMacSide()', 'toggleMacSideGroup(id)', 'JSON.stringify(this.sideGroups || {})'])
        assert.ok(main.includes(token), token);
    assert.match(main, /try \{[\s\S]*?localStorage\.setItem\('bhas_side_collapsed'[\s\S]*?\} catch \(_e\)/);
});

test('1440 창 영역은 사이드바 밖에, 390은 서랍으로 떠서 열린다', () => {
    assert.match(main, /_macSideWidth\(\)/);
    assert.match(main, /left:`?\$\{side \+ 8\}/);
    assert.match(style, /--mac-side-w:236px/);
    assert.match(style, /side-collapsed\{--mac-side-w:64px\}/);
    assert.match(style, /@media\(max-width:900px\)[\s\S]*?--mac-side-w:0px/);
    assert.match(style, /side-drawer-open \.global-side\{transform:translateX\(0\)\}/);
});

test('사이드바 글자는 13px 이상, 항목은 36px 이상이다', () => {
    assert.match(style, /\.mac-side-app,.mac-side-item\{[^}]*min-height:36px[^}]*font-size:13px/);
    assert.match(style, /\.mac-side-item\{height:36px/);
    assert.doesNotMatch(style.slice(style.indexOf('/* 전역 사이드바'), style.indexOf('/* 바탕화면 =', style.indexOf('/* 전역 사이드바'))), /font-size:(?:1[0-2]|\d)px/);
});

test('맥 창 안 판매·SNS는 대분류 메뉴, 그 밖의 창은 보기 필터를 둔다', () => {
    assert.match(main, /if \(this\.macMode\) \{[\s\S]*?const nav = this\._viewNav\(view\)[\s\S]*?appside appside-filter/);
    assert.match(main, /appwrap\$\{side \? '' : ' no-appside'\}/);
    assert.match(main, /appside appside-sales-menu/);
    assert.match(main, /sns3-menu-side/);
});

test('중분류는 현재 창만 펼치고 레일에서는 플라이아웃으로 상세에 간다', () => {
    assert.match(main, /toggleMacSideApp\(view\)/);
    assert.match(main, /mac-side-appwrap\$\{appOn \? ' on' : ''\}\$\{expanded \? ' expanded' : ''\}/);
    assert.match(main, /ph-caret-\$\{expanded \? 'up' : 'down'\}/);
    const appBlock = main.slice(main.indexOf('        const app = a =>'), main.indexOf('        const group = g =>'));
    assert.match(appBlock, /toggleMacSideApp/); assert.doesNotMatch(appBlock, /sideOpen/);
    assert.match(style, /mac-side-appwrap:not\(\.expanded\) \.mac-side-sub\{display:none\}/);
    assert.match(style, /side-collapsed \.mac-side-appwrap:hover>\.mac-side-sub/);
});

test('모바일 서랍은 독보다 위에 있고 열린 동안 독을 숨긴다', () => {
    assert.match(style, /side-drawer-open \.mac-dock\{visibility:hidden\}/);
    assert.match(style, /\.global-side\{z-index:6100\}/);
    assert.match(style, /\.mac-menubar>b,\.mac-menubar>span\{white-space:nowrap\}/);
});

test('맥 창 제목줄은 메뉴바 아래에 있고 모바일 독은 화면 안에서 스크롤한다', () => {
    assert.match(main, /if \(w\.max\) return `left:\$\{side \+ 8\}px;top:36px/);
    assert.match(main, /const y = Math\.max\(36,/);
    assert.match(style, /\.mac-dock\{left:12px;right:12px;[^}]*overflow-x:auto/);
});
