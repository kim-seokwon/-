import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const style = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const sideBlock = main.slice(main.indexOf('    MAC_SIDE_GROUPS = ['), main.indexOf('\n    ];', main.indexOf('    MAC_SIDE_GROUPS = [')) + 7);

test('전역 사이드바는 7개 대분류와 이관된 중분류를 그린다', () => {
    for (const token of ['MAC_SIDE_GROUPS', "id: 'home', label: '홈'", "id: 'sales', label: '판매'",
        "id: 'product', label: '상품·생산'", "id: 'finance', label: '재무'", "id: 'marketing', label: '마케팅'",
        "id: 'work', label: '업무·자료'", "id: 'settings', label: '설정'", "label: '홈', icon: 'ph-house', view: 'home', direct: true",
        "['orders', '주문·배송'", "['cs', '교환·반품·CS'", "['analysis', '고객 분석'",
        "['items', '상품 관리'", "['vendors', '생산 관리'", "['tech_packs', '작업지시서'", "['inventory', '재고 관리'",
        "['sales', '매출 분석'", "['expenses', '지출 관리'", "['quotes', '견적서'",
        "['sns', '마케팅 현황'", "['sns', '광고 관리'", "['sns', '게시물·리뷰'", "['sns', '팔로워 분석'",
        "['reminders', '할 일'", "['calendar', '통합 캘린더'", "['contacts', '거래처'", "['set_account', '내 계정·버전'"])
        assert.ok(main.includes(token), token);
    assert.match(main, /const apps = groups\.flatMap\(g => g\.apps \|\| \[\]\)/);
    assert.match(main, /global-side global-side-primary/);
    assert.match(style, /\.global-side-primary \.mac-side-sub\{display:none;position:absolute/);
    assert.match(style, /\.global-side-primary \.mac-side-appwrap\.expanded>\.mac-side-sub\{display:block\}/);
});

test('이관표의 표시 view는 전부 열리고 같은 진입점은 두 번 없다', () => {
    const rows = [...sideBlock.matchAll(/\['([^']+)', '([^']+)', '([^']+)'(?:, '([^']+)')?\]/g)]
        .map(m => ({ view: m[1], mode: m[4] || '' }));
    const keys = rows.map(r => `${r.view}:${r.mode}`);
    assert.equal(new Set(keys).size, keys.length, '중복 view/mode');
    for (const view of ['orders','cs','analysis','items','vendors','tech_packs','inventory',
        'sales','expenses','quotes','reminders','calendar','notes','documents','contacts','set_org','brand_management',
        'user_management','set_menu','integrations','set_alerts','set_adrules','settings','set_account','feedback'])
        assert.ok(rows.some(r => r.view === view), view);
    for (const mode of ['dashboard','ads','posts','followers','industry','news'])
        assert.ok(rows.some(r => r.view === 'sns' && r.mode === mode), `sns:${mode}`);
    for (const removed of ['sample_maker', 'makers']) assert.ok(!rows.some(r => r.view === removed), removed);
    assert.match(main, /\{ k: 'sample_maker',[^\n]*hidden: true \}/);
    assert.match(main, /\{ k: 'makers',[^\n]*hidden: true \}/);
    assert.match(main, /if \(view === 'makers'\) \{ this\.contactCat = this\._makerLinkCat\(\); view = 'contacts'; \}/);
});

test('이관된 사용자 노출명에 연락처·샘플 독립 명칭이 남지 않는다', () => {
    assert.match(main, /\{ id: 'contacts', label: '거래처'/);
    assert.match(main, /\{ id: 'sample_maker', label: '작업지시서 작성'/);
    assert.match(main, /\['sample_maker','작업지시서 작성'\]/);
    assert.doesNotMatch(main, /contacts', label: '연락처'|sample_maker', label: '샘플'|sample_maker','샘플'|샘플·디자인/);
});

test('권한·현재 탭·이동은 기존 창 라우팅을 재사용한다', () => {
    assert.match(main, /if \(!this\._viewAllowed\(view\)\) return ''/);
    assert.match(main, /sideOpen\(view, mode = ''\)[\s\S]*?this\.setSnsMode\(mode\)[\s\S]*?this\.macOpen\(view\)/);
    assert.match(main, /activeView === 'sns'[\s\S]*?activeMode === mode/);
    assert.match(main, /data-view="\$\{esc\(view\)\}"/);
    assert.match(main, /this\.sideAppOpen = '__none'/);
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

test('맥 창 안 판매·재무는 중분류 메뉴, 그 밖의 창은 보기 필터를 둔다', () => {
    assert.match(main, /g\.head === 'orders' \|\| g\.head === 'sales'/);
    assert.match(main, /category-work-nav/);
    assert.match(main, /if \(this\.macMode\) \{[\s\S]*?const nav = this\._viewNav\(view\)[\s\S]*?appside appside-filter/);
    assert.match(main, /appwrap\$\{side \? '' : ' no-appside'\}/);
    //  사장님 11-18: 창 안에 'OO 메뉴'(형제 화면 목록)를 다시 그리지 않는다
    assert.doesNotMatch(main, /appside appside-sales-menu/);
    assert.doesNotMatch(main, /sns3-menu-side/);
});

test('홈만 바로 열고 나머지 6개 대분류는 플라이아웃만 연다', () => {
    assert.match(main, /toggleMacSideApp\(view\)/);
    assert.match(main, /this\.sideAppOpen = this\.sideAppOpen === view \? '__none' : view/);
    assert.match(main, /mac-side-appwrap\$\{appOn \? ' on' : ''\}\$\{expanded \? ' expanded' : ''\}/);
    assert.match(main, /const expanded = this\.sideAppOpen === a\.view/);
    const appBlock = main.slice(main.indexOf('        const app = a =>'), main.indexOf('        return `<button class="mac-side-backdrop"'));
    assert.match(appBlock, /if \(a\.direct\)[\s\S]*?onclick="app\.sideOpen/);
    assert.match(appBlock, /onclick="app\.toggleMacSideApp/);
    assert.match(main, /label: '홈', icon: 'ph-house', view: 'home', direct: true/);
    assert.doesNotMatch(main, /label: '판매'[^\n]*direct: true/);
    assert.match(style, /side-collapsed \.mac-side-appwrap:hover>\.mac-side-sub/);
});

test('모바일 서랍은 독보다 위에 있고 열린 동안 독을 숨긴다', () => {
    assert.match(style, /side-drawer-open \.mac-dock\{visibility:hidden\}/);
    assert.match(style, /\.global-side\{z-index:6100\}/);
    assert.match(style, /\.mac-menubar>b,\.mac-menubar>span\{white-space:nowrap\}/);
});

test('맥 창 제목줄은 메뉴바 아래에 있고 모바일 독은 화면 안에서 스크롤한다', () => {
    assert.match(main, /if \(w\.max\) return `left:\$\{side \+ 8\}px;top:36px/);
    assert.match(main, /const y = Math\.min\(Math\.max\(36, window\.innerHeight - height - 120\), y0\)/);
    assert.match(style, /\.mac-dock\{left:12px;right:12px;[^}]*overflow-x:auto/);
});
