// 메모 여러 개 고르기 — 시즌 묶음 머리줄(.nt-row.nt-seag, data-id 없음)이 선택에 끼면 안 된다.
// nbBandStart · noteClick · _picked · bulkDeleteNotes · bulkMoveNotes 를 main.js 에서 그대로 떼어 와 가짜 DOM 으로 돌린다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const method = (name) => {
    const re = new RegExp(`\\n    (async )?${name}\\(`);
    const m = re.exec(src); assert.ok(m, `${name} 를 main.js 에서 못 찾음`);
    const a = m.index + 1, eol = src.indexOf('\n', a), first = src.slice(a, eol);
    const oneLine = first.trimEnd().endsWith('}') && first.split('{').length === first.split('}').length;
    const b = oneLine ? eol : src.indexOf('\n    }\n', a) + 6;
    const body = src.slice(a, b).trim().replace(new RegExp(`^(async )?${name}\\(`), (_, as) => `${as || ''}function ${name}(`);
    return eval('(' + body + ')');
};

//  목록 모양: 일반 메모 g1 · 시즌 머리줄 · 펼친 단계 메모 k1 k2 · 일반 메모 g2  (줄마다 30px)
function fakeList() {
    const spec = [{ id: 'g1' }, { sea: 's1' }, { id: 'k1' }, { id: 'k2' }, { id: 'g2' }];
    const rows = spec.map((s, i) => {
        const dataset = s.id ? { id: s.id } : { sea: s.sea };
        const cls = new Set(['nt-row', ...(s.sea ? ['nt-seag'] : [])]);
        return {
            dataset, draggable: true, top: i * 30,
            classList: { toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)), has: c => cls.has(c) },
            getBoundingClientRect() { return { top: this.top, bottom: this.top + 30 }; },
            matches(sel) {
                if (sel === '.nt-row') return true;
                if (sel === '.nt-row[data-id]') return 'id' in this.dataset;
                throw new Error('모르는 선택자 ' + sel);
            },
            closest(sel) { return this.matches(sel) ? this : null; },
        };
    });
    const all = sel => rows.filter(r => r.matches(sel));
    const box = { querySelectorAll: all };
    const listeners = {};
    globalThis.document = {
        querySelectorAll: all, querySelector: () => null,
        createElement: () => ({ style: {}, remove() {} }), body: { appendChild() {} },
        addEventListener: (t, f) => { listeners[t] = f; }, removeEventListener: (t) => { delete listeners[t]; },
    };
    return { rows, box, fire: (t, e) => listeners[t] && listeners[t](e) };
}

function mkApp() {
    const t = {
        noteMulti: new Set(), noteSel: null, calls: [], moved: [],
        requestRender() {}, showToast() {}, showConfirm: async () => true,
        selectNote(id) { this.noteSel = id; }, _nbDrop() {}, _me: () => 'me',
        noteList: ['g1', 'k1', 'k2', 'g2'].map(id => ({ id, scope: 'shared', folder: '공용' })),
        async moveNoteTo(id, k) { this.moved.push([id, k]); },
        ctxMenu(_ev, items) { this.menu = items; },
        supabase: { from: (table) => ({ delete: () => ({ in: (col, ids) => ({ select: async () => { t.calls.push({ table, col, ids }); return { data: ids.map(id => ({ id })), error: null }; } }) }) }) },
    };
    for (const f of ['_picked', 'nbBandStart', 'noteClick', 'bulkDeleteNotes', 'bulkMoveNotes']) t[f] = method(f);
    return t;
}
const press = (row, box, y, extra = {}) => ({ button: 0, currentTarget: box, target: row, clientX: 10, clientY: y, ...extra });
const clean = ids => ids.every(id => id != null && id !== '' && id !== 'undefined');

test('시즌 머리줄만 끌어 훑으면 0건', () => {
    const app = mkApp(), { rows, box, fire } = fakeList();
    app.nbBandStart(press(rows[1], box, 35));
    fire('mousemove', { clientX: 12, clientY: 50 });        // 머리줄(30~60) 안에서만
    fire('mouseup', {});
    assert.equal(app.noteMulti.size, 0);
    assert.ok(!rows[1].classList.has('pick'));
});

test('머리줄을 가로질러 훑어도 실제 메모 ID 만', () => {
    const app = mkApp(), { rows, box, fire } = fakeList();
    app.nbBandStart(press(rows[0], box, 5));
    fire('mousemove', { clientX: 12, clientY: 100 });       // g1 · 머리줄 · k1 · k2
    fire('mouseup', {});
    assert.deepEqual([...app.noteMulti].sort(), ['g1', 'k1', 'k2']);
});

test('Shift 범위가 머리줄을 지나도 실제 메모 ID 만', () => {
    const app = mkApp(); fakeList();
    app.noteSel = 'g1';
    app.noteClick({ shiftKey: true }, 'k2');
    assert.deepEqual([...app.noteMulti], ['g1', 'k1', 'k2']);
});

test('일괄 삭제·이동 payload 에 null/undefined 없음 — 이미 섞여 들어온 가짜 ID 도 걸러진다', async () => {
    const app = mkApp(); fakeList();
    app.noteMulti = new Set(['g1', undefined, 'undefined', null, '', 'k1']);
    await app.bulkDeleteNotes();
    assert.equal(app.calls.length, 1);
    assert.deepEqual(app.calls[0].ids, ['g1', 'k1']);
    assert.ok(clean(app.calls[0].ids));

    const b = mkApp(); fakeList();
    b.noteMulti = new Set(['k2', undefined, 'g2']);
    globalThis.window = {};
    await b.bulkMoveNotes();
    await b.menu[0].run();
    assert.deepEqual(b.moved.map(m => m[0]), ['k2', 'g2']);
    assert.ok(clean(b.moved.map(m => m[0])));
});

test('끌어 훑고 놓은 클릭은 시즌 줄을 접거나 펴지 않는다 — 그냥 누르면 펼친다', () => {
    const app = mkApp(); app.toggleNoteSeaRow = method('toggleNoteSeaRow');
    const { rows, box, fire } = fakeList();
    app.nbBandStart(press(rows[1], box, 35));
    fire('mousemove', { clientX: 12, clientY: 50 }); fire('mouseup', {});
    app.toggleNoteSeaRow('s1', false);                       // 브라우저가 이어서 보내는 click
    assert.equal(app.noteSeaRows, undefined);
    app._bandJust = 0;
    app.toggleNoteSeaRow('s1', false);
    assert.deepEqual(app.noteSeaRows, { s1: true });
});
