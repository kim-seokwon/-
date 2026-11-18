import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');

test('자료실은 폴더·요약 목록·선택 상세 3단을 유지한다', () => {
    assert.match(main, /<div class="fd\$\{this\.docMobileDetail \? ' detail' : ''\}">/);
    assert.match(main, /class="fd3-r/);
    assert.match(main, /class="fd3-copy"><b>[\s\S]*?<em>/);
    assert.match(main, /const d = docs\.find\(x => String\(x\.id\) === String\(this\.docSel\)\);/);
    assert.match(main, /자료를 선택하세요/);
    assert.match(css, /\.fd\{display:grid;[^}]*grid-template-columns:var\(--c1,188px\) 1fr var\(--c3,232px\)/);
});

test('폴더 전환은 선택을 풀고 모바일은 목록→상세→목록이다', () => {
    assert.match(main, /setDocCategory\(c\) \{ this\.selectedDocCategory = c; this\.docSel = null; this\.docMobileDetail = false;/);
    assert.match(main, /selectDoc\(id\) \{ this\.docSel = id; this\.docMobileDetail = true;/);
    assert.match(main, /closeDocDetail\(\) \{ this\.docMobileDetail = false;/);
    assert.match(css, /@media \(max-width:900px\)[\s\S]*?\.fd\.detail \.fd-main\{display:none\}[\s\S]*?\.fd\.detail \.fd-prev\{display:flex\}/);
});

test('기존 업로드·다운로드·수정·권한 데이터 경로를 재사용한다', () => {
    for (const token of [
        'this.showQuickAddDocModal()',
        'async handleFileUpload(product_id, file, docType, customName)',
        "this.supabase.from('documents').update({ name: v.trim() })",
        'folderInfo(pid)',
        'downloadSelectedDoc()',
        'this.ensureTechPacks()',
        'this.loadQuotes()',
        'this.loadItems()',
    ]) assert.ok(main.includes(token), token);
});

test('파일 주소는 허용 프로토콜만 쓰고 행 핸들러에 외부 주소를 직접 넣지 않는다', () => {
    assert.match(main, /_safeFileUrl\(value\)/);
    assert.match(main, /\['http:', 'https:'\]\.includes\(u\.protocol\)/);
    assert.match(main, /<iframe src="\$\{attrUrl\}" sandbox/);
    assert.match(main, /rel="noopener noreferrer"/);
    assert.match(main, /onclick="app\.selectDocAt\(\$\{idx\}\)" ondblclick="app\.openDocAt\(\$\{idx\}\)"/);
    assert.doesNotMatch(main, /class="fd3-r[\s\S]{0,300}showFileModal\('/);
});

test('헤드리스 미리보기는 가짜 자료만 쓰고 로드를 막는다', () => {
    assert.match(main, /if \(devPreview === 'documents3'\)/);
    assert.match(main, /this\._itemsLoaded = this\._techPacksLoaded = this\._quotesLoaded = this\._noteLoaded = true/);
    assert.match(main, /this\._devPreviewDocuments3/);
    const start = main.indexOf("if (devPreview === 'documents3')");
    const end = main.indexOf('//  CS 원송장 화면 검수', start);
    assert.ok(start > 0 && end > start);
    const preview = main.slice(start, end);
    assert.match(preview, /this\.supabase = \{ from: \(\) => q/);
    assert.doesNotMatch(preview, /createClient\(/);
});
