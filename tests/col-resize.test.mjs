import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clampW, tableKey, readWidths, writeWidths, dragWidths, applyWidths, attachTable, installColResize, COLW_MIN, COLW_MAX } from '../colResize.js';

//  아주 작은 가짜 DOM — 칸 너비 조절이 쓰는 것만
const mem = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }; };
class El {
    constructor(tag, doc) { this.tag = tag; this.ownerDocument = doc; this.children = []; this.parentElement = null; this.dataset = {}; this.style = {}; this.className = ''; this.title = ''; this._text = '';
        const cls = new Set(); this.classList = { add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c) }; this.w = 100; }
    get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
    appendChild(c) { c.parentElement = this; this.children.push(c); return c; }
    matches(sel) { return sel === '.th-rz' ? this.className === 'th-rz' : sel === 'table' ? this.tag === 'table' : false; }
    closest(sel) { let e = this; while (e) { if (e.matches(sel)) return e; e = e.parentElement; } return null; }
    querySelector(sel) { return sel === ':scope > .th-rz' ? this.children.find(c => c.className === 'th-rz') || null : null; }
    getBoundingClientRect() { return { width: this.style.width ? parseFloat(this.style.width) : this.w }; }
    setPointerCapture() {}
}
function makeDoc() {
    const L = {};
    const doc = { addEventListener: (t, f) => { L[t] = f; }, defaultView: {}, documentElement: new El('html'), tables: [] };
    doc.createElement = t => new El(t, doc);
    doc.body = { querySelectorAll: sel => doc.tables.filter(t => sel.includes(':not([data-rz])') ? !t.dataset.rz : !!t.dataset.rz) };
    doc.fire = (type, target, extra = {}) => { const e = { type, target, button: 0, pointerId: 1, stopped: false, prevented: false,
        stopPropagation() { this.stopped = true; }, preventDefault() { this.prevented = true; }, ...extra }; L[type](e); return e; };
    return doc;
}
function makeTable(doc, labels) {
    const t = new El('table', doc); const row = { cells: [] };
    labels.forEach(l => { const th = new El('th', doc); th._text = l; th.parentElement = t; row.cells.push(th); });
    t.tHead = { rows: [row] }; doc.tables.push(t); return t;
}
const CS = ['접수일', '유형', '고객', '브랜드', '구매처', '주문번호', '상품', '상태', '메모'];

test('도우미: 너비는 최소·최대 안으로, 열쇠는 머리글 글자 줄', () => {
    assert.equal(clampW(5), COLW_MIN); assert.equal(clampW(99999), COLW_MAX); assert.equal(clampW('120.6'), 121);
    assert.equal(tableKey([' 접수일 ', '유형\n']), 'colw:접수일|유형');
    assert.deepEqual(dragWidths([100, 80, 60], 1, 40), [100, 120, 60]);
    assert.deepEqual(dragWidths([100, 80, 60], 2, -500), [100, 80, COLW_MIN]);
});
test('남긴 너비: 칸 수 다르거나 깨진 값이면 버린다', () => {
    const s = mem();
    writeWidths(s, 'k', [100, 50]); assert.deepEqual(readWidths(s, 'k', 2), [100, 50]);
    assert.equal(readWidths(s, 'k', 3), null);
    s.setItem('k', '{broken'); assert.equal(readWidths(s, 'k', 2), null);
    s.setItem('k', '[100,-1]'); assert.equal(readWidths(s, 'k', 2), null);
    assert.equal(readWidths({ getItem() { throw new Error('막힘'); } }, 'k', 2), null);
});
test('표에 입히기: 칸 고정 + 표 너비 = 칸 합, 손잡이는 칸마다 한 번만', () => {
    const doc = makeDoc(), s = mem(), t = makeTable(doc, ['가', '나']);
    s.setItem(tableKey(['가', '나']), '[150,90]');
    assert.equal(attachTable(t, s), true); assert.equal(attachTable(t, s), false);
    assert.equal(t.tHead.rows[0].cells.every(th => th.children.filter(c => c.className === 'th-rz').length === 1), true);
    assert.equal(t.style.tableLayout, 'fixed'); assert.equal(t.style.width, '240px'); assert.equal(t.classList.contains('rz-on'), true);
    assert.equal(t.dataset.rz, 'colw:가|나');                     // 손잡이 글자(빈칸)는 열쇠에 안 섞인다
    assert.equal(applyWidths(t, [1]), false);
});
test('끌기: 손잡이 누르고 움직이면 그 칸만 바뀌고 남는다 · 정렬 클릭은 안 간다 · 두 번 누르면 원래대로', () => {
    const doc = makeDoc(), s = mem(), t = makeTable(doc, CS);
    installColResize({ doc, storage: s, root: doc.body });
    const th = t.tHead.rows[0].cells[6], h = th.children[0];
    const d = doc.fire('pointerdown', h, { clientX: 500 });
    assert.equal(d.stopped, true); assert.equal(doc.documentElement.classList.contains('rz-drag'), true);
    doc.fire('pointermove', h, { clientX: 501 });                 // 2px 안 — 그대로
    assert.equal(t.style.width, undefined);
    doc.fire('pointermove', h, { clientX: 580 });
    doc.fire('pointerup', h);
    const saved = JSON.parse(s.getItem(tableKey(CS)));
    assert.equal(saved[6], 180); assert.equal(saved.filter((w, j) => j !== 6).every(w => w === 100), true);
    assert.equal(th.style.width, '180px'); assert.equal(doc.documentElement.classList.contains('rz-drag'), false);
    assert.equal(doc.fire('click', h).stopped, true);              // 손잡이 클릭 → 머리글 정렬까지 안 감
    assert.equal(doc.fire('click', th).stopped, false);            // 머리글 클릭(정렬·깔때기)은 그대로
    //  다시 그려진 같은 표(새 innerHTML) 는 남긴 너비를 받는다
    const t2 = makeTable(doc, CS); doc.__colResize.scan();
    assert.equal(t2.tHead.rows[0].cells[6].style.width, '180px');
    doc.fire('dblclick', h);
    assert.equal(s.getItem(tableKey(CS)), null);
    assert.equal(t.style.width, ''); assert.equal(t2.style.width, ''); assert.equal(t.classList.contains('rz-on'), false);
});
test('누르기만 하고 안 움직이면 저장 안 함 · 오른쪽 버튼 무시 · 두 번 설치해도 하나', () => {
    const doc = makeDoc(), s = mem(), t = makeTable(doc, ['가', '나']);
    const a = installColResize({ doc, storage: s, root: doc.body });
    assert.equal(installColResize({ doc, storage: s, root: doc.body }), a);
    const h = t.tHead.rows[0].cells[0].children[0];
    doc.fire('pointerdown', h, { clientX: 10 }); doc.fire('pointerup', h);
    assert.equal(s.m.size, 0);
    assert.equal(doc.fire('pointerdown', h, { clientX: 10, button: 2 }).stopped, false);
});
test('연결: main.js 가 시작할 때 설치하고, CSS 에 손잡이·깔때기 비킴이 있다', () => {
    const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    assert.match(main, /import \{ installColResize \} from '\.\/colResize\.js'/);
    assert.match(main, /try \{ installColResize\(\); \}/);
    assert.match(css, /\.it-tbl th \.th-rz\{[^}]*cursor:col-resize/);
    assert.match(css, /\.it-tbl th \.th-f\{right:9px\}/);
    assert.match(css, /\.it-scroll\{[^}]*overflow:auto/);          // 넓어지면 목록 칸이 가로 스크롤
});
