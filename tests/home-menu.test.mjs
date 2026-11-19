import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const style = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

test('홈 중분류는 활성 항목을 바꾸고 그 구역으로 스크롤한다', () => {
    assert.match(main, /const homeMode = \['todos', 'sales', 'orders', 'alerts', 'paper'\]/);
    assert.match(main, /data-home-mode="\$\{homeMode\}"/);
    for (const mode of ['todos', 'sales', 'orders', 'alerts', 'paper']) {
        assert.ok(main.includes(`data-pane="${mode}"`), mode);
    }
    assert.match(main, /view === 'home'[\s\S]*?this\.homeMode = mode/);
    assert.match(main, /view === 'home'\) return desktopHome[\s\S]*?this\.homeMode \|\| 'sales'/);
    assert.match(main, /if \(view === 'home' && mode\) this\._scrollHomePane\(mode\)/);
});

test('홈은 펼친 사이드바 뒤에서 시작하고 12px 미만 글씨를 보정한다', () => {
    assert.match(style, /\.mac-deskboard\{position:absolute;left:var\(--mac-side-w\)/);
    assert.match(style, /\.home-view \[style\*="font-size:0\.58rem"\][\s\S]*?font-size:12px!important/);
    assert.match(style, /\.desk-find kbd\{font-family:inherit;font-size:12px/);
});

//  11-18 사고: 홈이 homeMode 한 칸만 보여 매출·미처리 주문이 사라졌다(7a36747~). 다시는 숨기지 않는다.
test('홈은 한 화면 대시보드 — 매출·주문 구역이 hidden 아님, 순서 주문·CS→매출→할 일→알림→조간', () => {
    const home = main.slice(main.indexOf('class="fade-in home-view"'), main.indexOf('    async logout()'));
    assert.doesNotMatch(home, /home-mode-pane[^>]*hidden/);
    assert.doesNotMatch(home, /\? '' : ' hidden'/);
    const at = m => home.indexOf(`data-pane="${m}"`);
    const order = ['orders', 'sales', 'todos', 'alerts', 'paper'].map(at);
    assert.ok(order.every(i => i > 0), order.join(','));
    assert.deepEqual([...order].sort((a, b) => a - b), order);
    //  같은 정보 두 번 그리기 금지
    assert.equal(home.split('${statBlocks}').length - 1, 1, 'statBlocks 1회');
    assert.equal((home.match(/\b_warn\b/g) || []).length, 1, '알림 1회');
    assert.equal((home.match(/panel\('최근 주문', recentList/g) || []).length, 1, '최근 주문은 매출 개요 오른쪽 1회');
    assert.match(home, /class="home-sales-board"[\s\S]*?class="home-sales-column home-sales-left"[\s\S]*?매출 개요[\s\S]*?class="home-sales-column home-sales-right"[\s\S]*?최근 주문/);
    assert.match(style, /\.home-sales-board\{display:grid;grid-template-columns:minmax\(0,2fr\) minmax\(320px,1fr\)/);
    assert.match(style, /@media screen and \(max-width:1080px\)\{[\s\S]*?\.home-sales-board\{grid-template-columns:1fr\}/);
});

test('홈 매출은 왼쪽 KPI→채널, 오른쪽 최근 주문→브랜드 비율이고 1440 5칸·1024 3+2·390 2열', () => {
    const i = main.indexOf('<div class="home-sales-board">'); assert.ok(i > 0, '매출 보드');
    const row = main.slice(i, main.indexOf('</section>', i));
    assert.ok(row.indexOf('${chanStacked}') < row.indexOf('${donut(brandArr, palette)}'), '막대 → 도넛 순');
    assert.ok(row.indexOf('home-sales-kpis') < row.indexOf('home-channel-panel'), '왼쪽 KPI → 채널');
    assert.ok(row.indexOf('home-recent-orders') < row.indexOf('home-brand-ratio'), '오른쪽 최근 주문 → 비율');
    assert.match(row, /class="home-chan-bars">\$\{chanStacked\}[\s\S]*?\$\{brandChips\}/);
    assert.match(row, /class="home-chan-donut">[\s\S]*?\$\{donut\(brandArr, palette\)\}[\s\S]*?\$\{brandTotals\}/);
    assert.doesNotMatch(row, /하이헤이호|로하이|토비/, '브랜드 하드코딩 금지');
    assert.match(style, /\.hk-grid5\.home-sales-kpis\{grid-template-columns:repeat\(5,minmax\(0,1fr\)\)\}/);
    assert.match(style, /@media screen and \(max-width:1080px\)\{[\s\S]*?\.hk-grid5\.home-sales-kpis\{grid-template-columns:repeat\(6,minmax\(0,1fr\)\)\}[\s\S]*?:nth-child\(n\+4\)\{grid-column:span 3\}/);
    assert.match(style, /@media screen and \(max-width:768px\)\{[\s\S]*?\.hk-grid5\.home-sales-kpis\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
    assert.match(main, /home-zero-channels">매출 없음: \$\{chanWithoutSales\.join\(' · '\)\}/);
});
