// 제품 목록 출고일자 열(사장님 10-27 "출고일자도 있어야 돼. 제작현황 옆에") — main.js 실제 함수를 떼어 가짜 앱으로 그린다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const grab = (name) => {
    const a = src.search(new RegExp(`\\n    (async )?${name}\\(`)) + 1;
    assert.ok(a > 0, name + ' 없음');
    const b = src.indexOf('\n    }\n', a) + 6;
    const body = src.slice(a, b).trim();
    return eval('(' + (body.startsWith('async ') ? 'async function ' + body.slice(6) : 'function ' + body) + ')');
};

const mkApp = (items) => {
    const t = {
        pItems: items, vendors: [], _techPacks: [], itemSort: { k: '', dir: 1 }, itemColF: {}, saves: [], renders: 0,
        ITEM_SC: {}, ITEM_STATUSES: ['샘플', '생산중', '출고완료'],
        _vesc: s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
        _seasons: () => [], _saleParts: () => null, _itemSold: () => null, _itemPhotos: () => [], _brandNameById: () => '-',
        _itemLabel: i => i.name, _itemIssues: () => [], requestRender() { this.renders++; }, showToast() {},
        supabase: { from: () => ({ update: (patch) => ({ eq: async (_c, id) => { t.saves.push({ id, ...patch }); return { error: null }; } }) }) },
    };
    t.noteList = []; t._noteText = n => String(n.body || '').replace(/^<!--p (.*?)-->\n?/, '');
    t._itemMemoLine = it => String(it.memo || '');
    for (const n of ['renderItemTable', '_itemDateCell', '_sortItemRows', '_itemColVal', 'setItem', '_itemNoteOf', '_itemMemoText', '_itemMemoPlain']) t[n] = grab(n);
    return t;
};
const items = () => [
    { id: 'a', name: '하렘팬츠', status: '생산중', ship_date: '2026-11-03', memo: '메모A' },
    { id: 'b', name: '후드', status: '출고완료', ship_date: null, memo: '' },
    { id: 'c', name: '조끼', status: '샘플', ship_date: '2026-10-20' },
];
const ths = html => [...html.split('<tbody>')[0].matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map(m => m[1].replace(/<[^>]+>/g, '').trim());
const rowCells = (html, id) => {
    const row = html.split(`data-id="${id}"`)[1].split('</tr>')[0];
    return [...row.matchAll(/<td\b([^>]*)>/g)].map(m => m[1]);
};

test('출고일자 열이 제작현황 바로 오른쪽(머리줄·칸 순서 같음)', () => {
    const t = mkApp(items());
    const html = t.renderItemTable(null, {});
    const h = ths(html);
    assert.equal(h[h.indexOf('제작현황') + 1], '출고일자');
    assert.equal(h[h.indexOf('출고일자') + 1], '메모');
    const cells = rowCells(html, 'a');
    assert.equal(cells.length, h.length);                         // 칸 수 = 머리 수(다른 열 안 밀림)
    assert.match(cells[h.indexOf('출고일자')], /it-dt/);
    assert.match(cells[h.indexOf('메모')], /it-memo/);
    const empty = mkApp([]).renderItemTable(null, {});            // 빈 표 안내 줄도 표 너비 그대로
    assert.equal(+empty.match(/colspan="(\d+)"/)[1], h.length);
});

test('값 있으면 날짜, 비면 빈칸 표시(—)와 지우기 버튼 없음', () => {
    const t = mkApp(items());
    const a = t._itemDateCell(items()[0], 'ship_date', '출고일자');
    assert.match(a, /type="date" value="2026-11-03"/);
    assert.match(a, /it-dtx/);
    const b = t._itemDateCell(items()[1], 'ship_date', '출고일자');
    assert.match(b, /class="it-dtw empty"/);
    assert.match(b, /value=""/);
    assert.doesNotMatch(b, /it-dtx/);
    const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    assert.match(css, /\.it-dtw\.empty::before\{content:'—'/);
    //  시각이 붙은 값이 와도 날짜만
    assert.match(t._itemDateCell({ id: 'x', ship_date: '2026-12-01T00:00:00' }, 'ship_date', '출고일자'), /value="2026-12-01"/);
});

test('넣기·고치기·지우기 → product_items.ship_date 저장(지우면 null)', async () => {
    const t = mkApp(items());
    const cell = t._itemDateCell(t.pItems[1], 'ship_date', '출고일자');
    assert.match(cell, /onchange="app\.setItem\('b','ship_date',this\.value,1\)"/);
    await t.setItem('b', 'ship_date', '2026-11-15', 1);
    await t.setItem('a', 'ship_date', '2026-11-10', 1);
    assert.match(t._itemDateCell(t.pItems[0], 'ship_date', '출고일자'), /onclick="app\.setItem\('a','ship_date','',1\)"/);
    await t.setItem('a', 'ship_date', '', 1);
    assert.deepEqual(t.saves, [{ id: 'b', ship_date: '2026-11-15' }, { id: 'a', ship_date: '2026-11-10' }, { id: 'a', ship_date: null }]);
    assert.equal(t.pItems[0].ship_date, null);
    assert.equal(t.pItems[1].ship_date, '2026-11-15');
});

test('출고일자로 정렬 — 날짜순, 빈칸은 오름·내림 모두 맨 아래', () => {
    const t = mkApp(items());
    t.itemSort = { k: 'ship_date', dir: 1 };
    assert.deepEqual(t._sortItemRows(t.pItems).map(i => i.id), ['c', 'a', 'b']);
    t.itemSort = { k: 'ship_date', dir: -1 };
    assert.deepEqual(t._sortItemRows(t.pItems).map(i => i.id), ['a', 'c', 'b']);
    //  다른 열 정렬은 그대로
    t.itemSort = { k: 'status', dir: 1 };
    assert.deepEqual(t._sortItemRows(t.pItems).map(i => i.id), ['c', 'a', 'b']);
});

test('날짜 칸을 눌러도 줄 선택·제품 페이지 열기로 안 번진다', () => {
    const cell = mkApp(items())._itemDateCell(items()[0], 'ship_date', '출고일자');
    assert.match(cell, /onclick="event\.stopPropagation\(\)" ondblclick="event\.stopPropagation\(\)"/);
});
