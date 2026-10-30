//  목록 칸 너비 조절 — 모든 it-tbl 목록 공통 (10-30 사장님 "칸칸이 가로스크롤해서 크기조정하면 편하겠다", .work/개발/열너비-조절.md)
//
//  머리글 칸 오른쪽 경계(.th-rz)를 끌면 그 칸 너비가 바뀐다. 표가 창보다 넓어지면 목록 칸(.it-scroll)이 가로로 스크롤된다.
//  바꾼 너비는 이 브라우저에 남는다(localStorage — 사람·브라우저별 편의라 DB 안 씀). 경계를 두 번 누르면 그 표를 원래대로.
//  표마다 따로 고치지 않는다: 그려진 it-tbl 을 지켜보다가(MutationObserver) 머리글에 손잡이를 단다. 열쇠는 머리글 글자 줄.
//  머리글 정렬·깔때기 클릭과 겹치지 않게, 손잡이에서 시작한 클릭은 문서 맨 앞(캡처)에서 멈춘다.

export const COLW_PREFIX = 'colw:';
export const COLW_MIN = 36;
export const COLW_MAX = 1200;

export const clampW = w => Math.max(COLW_MIN, Math.min(COLW_MAX, Math.round(Number(w) || 0)));

//  머리글 글자 → 표 열쇠. 같은 머리글이면 같은 표(어느 창에서 열어도 같은 너비).
export function tableKey(labels) {
    return COLW_PREFIX + labels.map(s => String(s || '').replace(/\s+/g, ' ').trim()).join('|');
}

//  남긴 너비 읽기 — 칸 수가 다르거나 값이 깨졌으면 없는 것으로(머리글이 바뀐 옛 기록은 버린다)
export function readWidths(storage, key, n) {
    try {
        const v = JSON.parse(storage.getItem(key) || 'null');
        if (!Array.isArray(v) || v.length !== n || !v.every(x => Number.isFinite(x) && x > 0)) return null;
        return v.map(clampW);
    } catch (_e) { return null; }
}
export function writeWidths(storage, key, widths) {
    try { storage.setItem(key, JSON.stringify(widths.map(clampW))); return true; } catch (_e) { return false; }
}
export function clearWidths(storage, key) {
    try { storage.removeItem(key); } catch (_e) { /* 저장소 막힘 — 화면만 되돌린다 */ }
}

//  끌기 한 번: 시작 너비들 + 몇 번째 칸 + 움직인 거리 → 새 너비들(다른 칸은 그대로)
export function dragWidths(start, i, dx) {
    return start.map((w, j) => (j === i ? clampW(w + dx) : clampW(w)));
}

const ths = table => [...(table.tHead?.rows[0]?.cells || [])];
const labelsOf = table => ths(table).map(th => th.textContent);

//  너비를 표에 입힌다 — 칸 너비를 고정(table-layout: fixed)하고 표 너비 = 칸 합
export function applyWidths(table, widths) {
    const cells = ths(table);
    if (!widths || widths.length !== cells.length) return false;
    cells.forEach((th, j) => { th.style.width = widths[j] + 'px'; });
    table.style.tableLayout = 'fixed';
    table.style.width = widths.reduce((a, b) => a + b, 0) + 'px';
    table.classList.add('rz-on');
    return true;
}
export function resetWidths(table) {
    ths(table).forEach(th => { th.style.width = ''; });
    table.style.tableLayout = ''; table.style.width = '';
    table.classList.remove('rz-on');
}

//  표 하나에 손잡이 달기 + 남긴 너비 입히기. 이미 달았으면 그대로.
export function attachTable(table, storage) {
    if (table.dataset.rz) return false;
    const cells = ths(table);
    if (!cells.length) return false;
    table.dataset.rz = tableKey(labelsOf(table));
    cells.forEach(th => {
        if (th.querySelector(':scope > .th-rz')) return;
        const h = table.ownerDocument.createElement('span');
        h.className = 'th-rz';
        h.title = '끌어서 칸 너비 조절 · 두 번 누르면 원래대로';
        th.appendChild(h);
    });
    applyWidths(table, readWidths(storage, table.dataset.rz, cells.length));
    return true;
}

export function installColResize({ doc = document, storage = window.localStorage, root = doc.body } = {}) {
    if (doc.__colResize) return doc.__colResize;
    const scan = () => root.querySelectorAll('table.it-tbl:not([data-rz])').forEach(t => attachTable(t, storage));
    let drag = null, queued = false;
    const sameKey = key => [...root.querySelectorAll('table.it-tbl[data-rz]')].filter(t => t.dataset.rz === key);

    const down = e => {
        const h = e.target.closest?.('.th-rz');
        if (!h || (e.button != null && e.button !== 0)) return;
        const th = h.parentElement, table = th.closest('table');
        if (!table) return;
        e.preventDefault(); e.stopPropagation();
        const cells = ths(table);
        drag = { table, h, i: cells.indexOf(th), x: e.clientX, start: cells.map(c => c.getBoundingClientRect().width), moved: false };
        try { h.setPointerCapture(e.pointerId); } catch (_e) { /* 가짜 이벤트 */ }
        doc.documentElement.classList.add('rz-drag'); h.classList.add('on');
    };
    const move = e => {
        if (!drag) return;
        const dx = e.clientX - drag.x;
        if (!drag.moved && Math.abs(dx) < 2) return;
        drag.moved = true;
        applyWidths(drag.table, dragWidths(drag.start, drag.i, dx));
    };
    const up = () => {
        if (!drag) return;
        const { table, h, moved } = drag;
        drag = null;
        doc.documentElement.classList.remove('rz-drag'); h.classList.remove('on');
        if (!moved) return;
        const key = table.dataset.rz, w = ths(table).map(c => parseFloat(c.style.width) || c.getBoundingClientRect().width);
        writeWidths(storage, key, w);
        sameKey(key).forEach(t => t !== table && applyWidths(t, w.map(clampW)));   // 끄는 동안 다시 그려졌어도 새 표에 입힌다
    };
    //  손잡이에서 난 클릭·두 번 누름은 머리글(정렬)까지 안 간다 — 캡처 단계에서 멈춤
    const click = e => { if (e.target.closest?.('.th-rz')) { e.stopPropagation(); e.preventDefault(); } };
    const dbl = e => {
        const h = e.target.closest?.('.th-rz');
        if (!h) return;
        e.stopPropagation(); e.preventDefault();
        const key = h.closest('table')?.dataset.rz;
        if (!key) return;
        clearWidths(storage, key);
        sameKey(key).forEach(resetWidths);
    };
    doc.addEventListener('pointerdown', down, true);
    doc.addEventListener('pointermove', move, true);
    doc.addEventListener('pointerup', up, true);
    doc.addEventListener('pointercancel', up, true);
    doc.addEventListener('click', click, true);
    doc.addEventListener('dblclick', dbl, true);
    const Obs = doc.defaultView?.MutationObserver;
    const obs = Obs ? new Obs(() => { if (queued) return; queued = true; Promise.resolve().then(() => { queued = false; scan(); }); }) : null;
    obs?.observe(root, { childList: true, subtree: true });
    scan();
    doc.__colResize = { scan, stop: () => obs?.disconnect() };
    return doc.__colResize;
}
