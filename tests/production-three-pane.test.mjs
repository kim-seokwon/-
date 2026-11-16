import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');

test('생산 묶음은 선택 전에도 분류·목록·상세 3단을 유지한다', () => {
    assert.match(main, /const production3 = this\._groupOf\(view\)\?\.head === 'items'/);
    assert.match(main, /production3 \? ' production3' : ''/);
    assert.match(main, /items: '생산 물품', vendors: '생산처', tech_packs: '작업지시서'/);
    assert.match(main, /if \(production3\) return empty\(\)/);
    assert.match(css, /\.appwrap\.production3\{--c1:190px;--c3:320px\}/);
});

test('왼쪽 분류는 기존 생산 메뉴·생산처·상태 데이터를 그대로 쓴다', () => {
    assert.match(main, /g\.head === 'items' \? '카테고리'/);
    assert.match(main, /items: 'ph-t-shirt'.*vendors: 'ph-factory'.*tech_packs: 'ph-clipboard-text'/);
    assert.match(main, /sec\('생산처', 'ven'/);
    assert.match(main, /sec\('상태', 'st'/);
    assert.match(main, /if \(vKey !== 'ALL'\) rows = rows\.filter/);
});

test('900px 이하는 목록→상세→목록으로 전환한다', () => {
    assert.match(main, /const changed = this\._itemPick\(id\), closed = !this\.productionMobileDetail/);
    assert.match(main, /if \(this\._groupOf\(view\)\?\.head === 'items'\) this\.productionMobileDetail = false/);
    assert.match(css, /@media \(max-width:900px\)[\s\S]*?\.appwrap\.production3\.detail \.appmain\{display:none\}[\s\S]*?\.appwrap\.production3\.detail \.appdet\{display:flex\}/);
});

test('기존 등록·수정·공정·일정·권한 경로는 그대로 쓴다', () => {
    for (const token of [
        "this.supabase.from('product_items').insert([row])",
        "this.supabase.from('product_items').update",
        "this.supabase.from('vendor_jobs').insert([row])",
        "this.supabase.from('vendor_jobs').update",
        "this._canSeeProject(p)",
        "this.ITEM_DATE_LABEL.ship_date",
        "app.itemToVendor('",
    ]) assert.ok(main.includes(token), token);
});

test('헤드리스 미리보기는 가짜 생산 데이터만 쓰고 DB 로드를 막는다', () => {
    assert.match(main, /if \(devPreview === 'production3'\)/);
    assert.match(main, /this\._itemsLoaded = this\._vendorsLoaded = this\._techPacksLoaded = this\._quotesLoaded = true/);
    assert.match(main, /this\._devPreviewProduction3/);
    const start = main.indexOf("if (devPreview === 'production3')");
    const end = main.indexOf('//  CS 원송장 화면 검수', start);
    assert.ok(start > 0 && end > start);
    assert.match(main.slice(start, end), /this\.supabase = \{ from: table =>/);
    assert.doesNotMatch(main.slice(start, end), /https?:\/\/|createClient\(/);
});

test('반려1: 가운데는 두 줄 압축 목록이고 제품명은 한 줄 말줄임한다', () => {
    assert.match(main, /_productionItemList\(rows, more, empty\)/);
    assert.match(main, /class="prod-name"[\s\S]*?class="prod-meta"/);
    assert.match(main, /부자재 미준비/);
    assert.match(main, /this\._productionItemList\(shown, more,/);
    assert.match(css, /\.prod-name\{[^}]*overflow:hidden;[^}]*text-overflow:ellipsis;[^}]*white-space:nowrap/);
});

test('반려1: 상태·출고일·부자재·확인은 상세에서 기존 setItem 저장 경로를 쓴다', () => {
    assert.match(main, /class="prod-detail-status"[\s\S]*?setItem\('\$\{it\.id\}','status',this\.value,1\)/);
    assert.match(main, /class="prod-detail-ship"[\s\S]*?setItem\('\$\{it\.id\}','ship_date',this\.value,1\)/);
    assert.match(main, /setItem\('\$\{it\.id\}','trims',this\.checked,1\)/);
    assert.match(main, /setItem\('\$\{it\.id\}','checked',this\.checked,1\)/);
});

test('반려1: 목록·상세·공정 날짜는 공용 formatDateToUI를 재사용한다', () => {
    assert.match(main, /const date = v => v \? this\.formatDateToUI/);
    assert.match(main, /const shownDate = value => value \? this\.formatDateToUI/);
    assert.match(main, /출고 \$\{date\(it\.ship_date\)\}/);
    assert.match(main, /shownDate\(it\.ship_date\)/);
    assert.match(main, /shownDate\(j\.due_date\)/);
});
