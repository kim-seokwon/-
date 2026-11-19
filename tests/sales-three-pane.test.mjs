import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');

test('주문 시범은 창 왼쪽 판매 업무·가운데 표·선택형 상세를 쓴다', () => {
    assert.match(main, /const sales3 = this\._groupOf\(view\)\?\.head === 'orders'/);
    assert.match(main, /sales3 \? ' sales3' : ''/);
    for (const label of ['주문·배송','교환·반품·CS','고객 분석']) assert.ok(main.includes(label), label);
    assert.match(main, /if \(view === 'orders'\) return '';/);
    assert.match(css, /\.appwrap\.sales3\{--c1:168px;--c3:300px\}/);
    assert.match(css, /\.sales3 \.table-container\{overflow-x:hidden!important\}/);
    assert.match(css, /\.sns-section-nav,\.sales-section-nav\{width:100%;min-height:40px/);
    for (const title of ['정산 요약', '고객 분석 요약', 'CRM 요약']) assert.ok(main.includes(title), title);
});

test('900px 이하는 목록→상세·목록 돌아가기로 전환한다', () => {
    assert.match(main, /selectOrder\(id\) \{[\s\S]*?this\.orderSel = id; this\.salesMobileDetail = true;/);
    assert.match(main, /selectCS\(id\)[\s\S]*?if \(changed \|\| !this\.salesMobileDetail\) \{ this\.salesMobileDetail = true;/);
    assert.match(main, /selectInv\(id\)[^\n]*if \(closed\) this\.salesMobileDetail = true/);
    assert.match(main, /if \(this\._groupOf\(view\)\?\.head === 'orders'\) this\.salesMobileDetail = false/);
    assert.match(css, /@media \(max-width:900px\)[\s\S]*?\.appwrap\.sales3\.detail \.appmain\{display:none\}[\s\S]*?\.appwrap\.sales3\.detail \.appdet\{display:flex\}/);
});

test('주문·CS·재고의 기존 상세·쓰기·권한 경로는 그대로 쓴다', () => {
    for (const token of [
        "this._findOrderBySel(this.orderSel)",
        "app.csFromOrder('",
        "this._csItemsHtml(t)",
        "app.setCSStatus('",
        "canTrash(t, this.currentUser)",
        'class="mbtn pri inv-adjust"',
        'class="mbtn inv-map"',
    ]) assert.ok(main.includes(token), token);
    assert.match(main, /_ordKey\(o\) \{ return `\$\{o\?\.mall_key \|\| ''\}\|\$\{o\?\.order_id\}`; \}/);
});

test('헤드리스 미리보기는 가짜 데이터만 쓰고 DB 로드를 막는다', () => {
    assert.match(main, /if \(devPreview === 'sales3'\)/);
    assert.match(main, /this\._ordersLoaded = this\._mallsLoaded = this\._csLoaded = this\._invLoaded = true/);
    assert.match(main, /this\._devPreviewSales3/);
    const start = main.indexOf("if (devPreview === 'sales3')");
    const end = main.indexOf('//  CS 원송장 화면 검수', start);
    assert.ok(start > 0 && end > start);
    assert.doesNotMatch(main.slice(start, end), /supabase\.from|supabase\.rpc|\.insert\(|\.update\(|\.delete\(/);
});

test('반려2: 상세 주문일은 전체, 목록은 폭을 아끼는 월-일 시각 표시를 쓴다', () => {
    const m = /_orderDateText\(value\) \{([\s\S]*?)\n    \}/.exec(main);
    assert.ok(m, '주문일 표시 도우미 없음');
    const format = Function('value', m[1]);
    assert.equal(format('2026-11-16T09:30:00+09:00'), '2026. 11. 16. 09:30');
    assert.match(main, /f\('주문일', this\._orderDateText\(o\.order_date\)\)/);
    assert.match(main, /_orderListDateText\(value\)/);
    assert.match(main, /\$\{this\._orderListDateText\(o\.order_date\) \|\| '-'\}<\/td>/);
    assert.match(main, /f\('채널', this\._orderChannelLabel\(o\)\)/);
    assert.match(main, /cafe24: '카페24'/);
});

test('반려2: 주문 식별값은 자르지 않고 상품만 툴팁 말줄임, CS는 8열·2줄 메모다', () => {
    assert.match(main, /class="ord-no"/); assert.match(main, /class="ord-mall"/); assert.match(main, /class="ord-invoice"/);
    assert.match(main, /class="ord-product" title=/);
    assert.match(main, /\['brand', '브랜드·구매처'\][\s\S]*?\['order_no', '주문번호'\]/);
    assert.doesNotMatch(main, /\['purchase_from', '구매처'\]/);
    assert.match(main, /<textarea class="it-in cs-memo" rows="2"/);
    assert.match(css, /\.appwrap\.sales3\.empty-detail\{--c3:0px\}/);
    assert.match(css, /\.sales3 \.ord-no,\.sales3 \.ord-mall,\.sales3 \.ord-invoice\{overflow:visible!important/);
});

//  9e20277 반려: 위 단언은 앞쪽 규칙만 봐서, 뒤에서 .ord-invoice 를 overflow:hidden 으로 덮은 걸 못 잡았다(거짓 통과).
//  → 주문 표의 어떤 규칙도 식별값 칸(주문번호·브랜드·채널·송장)을 자르지 못하게, 표는 내용 폭(auto)·상품 칸만 말줄임.
//  실제 렌더(scrollWidth<=clientWidth, 상세 닫힘/열림·1440/390)는 .work/개발자/팀장반려-1117/fit.mjs 가 본다(exit 1 = 잘림).
test('주문 표: 식별값 칸은 어떤 뒤쪽 규칙으로도 잘리지 않고, 상품 칸만 말줄임', () => {
    const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ sel: m[1].trim(), body: m[2] }));
    const idCell = /\.ord-(no|brand|mall|invoice)\b/;
    const clip = rules.filter(r => idCell.test(r.sel) && /overflow(-x)?:\s*hidden|text-overflow:\s*ellipsis|max-width/.test(r.body));
    assert.deepEqual(clip.map(r => r.sel), [], '식별값 칸을 자르는 규칙');
    const tblRules = rules.filter(r => /\.ord-tbl/.test(r.sel));
    const last = (re) => tblRules.filter(r => re.test(r.body)).pop();
    assert.match(last(/table-layout/).body, /table-layout:auto!important/, '마지막 table-layout 은 auto');
    const cellRule = tblRules.find(r => r.sel === '.sales3 .ord-tbl th,.sales3 .ord-tbl td');
    assert.ok(cellRule && /white-space:nowrap!important/.test(cellRule.body) && /overflow:visible!important/.test(cellRule.body), '칸 기본: 줄바꿈·자름 없음');
    const after = tblRules.slice(tblRules.indexOf(cellRule) + 1).filter(r => /overflow:\s*hidden|text-overflow:\s*ellipsis/.test(r.body));
    assert.ok(after.every(r => /nth-child\(7\)|ord-product/.test(r.sel)), '칸 기본 뒤에 자르는 규칙은 상품(7번째) 칸뿐: ' + after.map(r => r.sel).join(' / '));
    assert.match(css, /\.sales3 \.table-container:has\(>\.ord-tbl\)\{overflow-x:auto!important\}/, '좁으면 표만 가로 스크롤');
});

test('반려1: 몰별은 실제 이름·건수만 그리고 이름 없는 행은 숨긴다', () => {
    assert.match(main, /malls: \[\{ mall_key: 'hiheiho', cnt: 1 \}, \{ mall_key: 'lohi', cnt: 1 \}\]/);
    assert.match(main, /const namedMalls = malls\.map\(k => \(\{ k, name: mallName\(k\), cnt: mallCnt\(k\) \}\)\)[\s\S]*?\.filter\(x => x\.k && x\.name\)/);
    assert.match(main, /namedMalls\.map\(x => this\._mallNavRow\(String\(m\) === String\(x\.k\), x,/);
});

test('주문 알림: 몰별 줄에 마지막 수집 시각과 끊김 빨간 점(orderAlerts.js syncHealth 와 같은 규칙)', () => {
    assert.match(main, /import \{ syncHealth as orderSyncHealth \} from '\.\/orderAlerts\.js'/);
    assert.match(main, /_mallNavRow\(on, x, click\)[\s\S]*?\{ down: '#ef4444', warn: '#f59e0b', ok: '#22c55e' \}/);
    assert.match(main, /\[this\.cm29Sync, this\.pullSync\] = await Promise\.all/);
});

test('주문 알림 반려1⑤: 몰별 보조줄은 짧게(오늘 시:분 · 아니면 월/일, 끊김엔 "마지막" 없음) — 1440 에서 안 잘림', () => {
    const row = main.slice(main.indexOf('_mallNavRow(on, x, click)'), main.indexOf('_navSec(name, key, inner)'));
    assert.match(row, /short = md === String\(kstShort\(new Date\(\)\.toISOString\(\)\)\)\.split\(' '\)\[0\] \? hm : md/);
    assert.match(row, /`끊김 \$\{short \|\| ''\}`/);
    assert.doesNotMatch(row, /마지막 /);
});

test('반려1: 주문 검색 입력은 돋보기 오른쪽에서 시작한다', () => {
    assert.match(css, /\.macwin #oms-q\{padding-left:34px !important\}/);
});

test('개편 1단계: 전역 판매는 대분류만, 배송상태는 가운데 보기 탭이다', () => {
    assert.match(main, /label: '판매'[\s\S]*?view: 'orders'[\s\S]*?items:/);
    assert.doesNotMatch(main, /label: '판매'[^\n]*direct: true/);
    assert.match(main, /if \(a\.direct\)[\s\S]*?app\.sideOpen/);
    assert.match(main, /class="mp-seg oms-tabrow order-view-tabs"/);
    assert.doesNotMatch(main, /order-view-tabs[^\n]*취소·반품·교환/);
    assert.match(main, /class="sales-mobile-work"/);
    assert.match(main, /const tabRows = \(pg\.rows \|\| \[\]\)\.filter\(o => filter === 'all'/);
    assert.match(main, /const locallyNarrowed = tabRows\.length !== \(pg\.rows \|\| \[\]\)\.length \|\| rows\.length !== tabRows\.length/);
    assert.match(main, /const pageTotal = locallyNarrowed \? rows\.length : pg\.total/);
    assert.match(css, /\.sales3 \.ord-tbl \.ordrow\{display:grid;grid-template-columns:minmax\(0,1fr\) auto/);
    assert.match(css, /\.sales3 \.table-container:has\(>\.ord-tbl\)\{overflow-x:hidden!important\}/);
});

test('개편 1단계: 상세은 상품·옵션·배송·CS·변경이력과 이전·다음 주문을 제공한다', () => {
    for (const token of ['상품·옵션', '<div class="dt-sec">배송</div>', '<div class="dt-sec">변경 이력</div>', 'moveOrderDetail(-1)', 'moveOrderDetail(1)', 'CS 접수']) assert.ok(main.includes(token), token);
    assert.match(main, /this\._orderScroll = \{ top:/);
    assert.match(main, /this\._orderShownRows = rows/);
    assert.match(css, /@media \(min-width:901px\) and \(max-width:1080px\)[\s\S]*?\.appwrap\.sales3\.detail \.appdet\{display:flex;position:absolute/);
    assert.match(main, /CS 없음/);
    assert.match(main, /openOrderCS\(winId, id\)/);
    assert.match(main, /tipHTML\('ship_ready', TIPS\)/);
    assert.doesNotMatch(main, /송장 처리 흐름<\/b>/);
    assert.match(css, /\.sales3 \.mp-sp\{width:100%;margin-left:0;display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});
