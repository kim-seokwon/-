import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');

test('판매 묶음은 선택 전에도 분류·목록·상세 3단을 유지한다', () => {
    assert.match(main, /const sales3 = this\._groupOf\(view\)\?\.head === 'orders'/);
    assert.match(main, /sales3 \? ' sales3' : ''/);
    assert.match(main, /orders: '주문', cs: 'CS 건', inventory: '재고 품목'/);
    assert.match(main, /선택하세요<\/div>/);
    assert.match(main, /<button class="mbtn inv-map"[\s\S]*?return sales3 \? empty\(\) : '';/);
    assert.match(css, /\.appwrap\.sales3\{--c1:156px;--c3:260px\}/);
    assert.match(css, /\.sales3 \.table-container\{overflow-x:hidden!important\}/);
});

test('900px 이하는 목록→상세·목록 돌아가기로 전환한다', () => {
    assert.match(main, /selectOrder\(id\) \{ this\.orderSel = id; this\.salesMobileDetail = true;/);
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
    assert.match(main, /f\('채널', this\._mallLabel\(o\.mall_key \|\| o\.channel\)\)/);
});

test('반려2: 주문 식별값은 자르지 않고 상품만 툴팁 말줄임, CS는 8열·2줄 메모다', () => {
    assert.match(main, /class="ord-no"/); assert.match(main, /class="ord-mall"/); assert.match(main, /class="ord-invoice"/);
    assert.match(main, /class="ord-product" title=/);
    assert.match(main, /\['brand', '브랜드·구매처'\][\s\S]*?\['order_no', '주문번호'\]/);
    assert.doesNotMatch(main, /\['purchase_from', '구매처'\]/);
    assert.match(main, /<textarea class="it-in cs-memo" rows="2"/);
    assert.match(css, /\.appwrap\.sales3\.empty-detail\{--c3:132px\}/);
    assert.match(css, /\.sales3 \.ord-no,\.sales3 \.ord-mall,\.sales3 \.ord-invoice\{overflow:visible!important/);
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

test('반려1: 주문 검색 입력은 돋보기 오른쪽에서 시작한다', () => {
    assert.match(css, /\.macwin #oms-q\{padding-left:34px !important\}/);
});
