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
    assert.match(css, /\.appwrap\.sales3\{--c3:300px\}/);
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

test('반려1: 주문일·채널은 목록과 상세가 같은 표시 도우미를 쓴다', () => {
    const m = /_orderDateText\(value\) \{([\s\S]*?)\n    \}/.exec(main);
    assert.ok(m, '주문일 표시 도우미 없음');
    const format = Function('value', m[1]);
    assert.equal(format('2026-11-16T09:30:00+09:00'), '2026. 11. 16. 09:30');
    assert.match(main, /f\('주문일', this\._orderDateText\(o\.order_date\)\)/);
    assert.match(main, /\$\{this\._orderDateText\(o\.order_date\) \|\| '-'\}<\/td>/);
    assert.match(main, /f\('채널', this\._mallLabel\(o\.mall_key \|\| o\.channel\)\)/);
});

test('반려1: 몰별은 실제 이름·건수만 그리고 이름 없는 행은 숨긴다', () => {
    assert.match(main, /malls: \[\{ mall_key: 'hiheiho', cnt: 1 \}, \{ mall_key: 'lohi', cnt: 1 \}\]/);
    assert.match(main, /const namedMalls = malls\.map\(k => \(\{ k, name: mallName\(k\), cnt: mallCnt\(k\) \}\)\)[\s\S]*?\.filter\(x => x\.k && x\.name\)/);
    assert.match(main, /namedMalls\.map\(x => R\(String\(m\) === String\(x\.k\), x\.name,/);
});

test('반려1: 주문 검색 입력은 돋보기 오른쪽에서 시작한다', () => {
    assert.match(css, /\.macwin #oms-q\{padding-left:34px !important\}/);
});
