// 메모 [ ] 줄 ↔ 할 일 양방향 — 줄 읽기(_lineTodos)·내용 대조 가드(_locateTodoLine)·체크(toggleNoteTodo) 회귀 테스트.
// main.js 의 함수를 그대로 떼어 와 가짜 메모 위에서 돌린다. 실행: npm run test:note-todo
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
// 클래스 메서드 하나를 떼어 함수로 — '    이름(' 부터 같은 들여쓰기의 '    }' 까지(한 줄짜리는 그 줄만)
const method = (name) => {
    const re = new RegExp(`\\n    (async )?${name}\\(`);
    const m = re.exec(src); assert.ok(m, `${name} 를 main.js 에서 못 찾음`);
    const a = m.index + 1, eol = src.indexOf('\n', a), first = src.slice(a, eol);
    const oneLine = first.trimEnd().endsWith('}') && first.split('{').length === first.split('}').length;
    const b = oneLine ? eol : src.indexOf('\n    }\n', a) + 6;
    const body = src.slice(a, b).trim().replace(new RegExp(`^(async )?${name}\\(`), (_, as) => `${as || ''}function ${name}(`);
    return eval('(' + body + ')');
};
const field = (name) => { const m = new RegExp(`\\n    ${name} = (.+);\\n`).exec(src); assert.ok(m, `${name} 못 찾음`); return eval('(' + m[1] + ')'); };

const mk = (notes = [], more = {}) => {
    const t = {
        NOTE_TODO_RE: field('NOTE_TODO_RE'), DOW_KO: field('DOW_KO'),
        noteList: notes, vendors: [], pItems: [], remList: [], saved: [], toasts: [], ...more,
        _noteText: n => n.body || '', _noteMeta: () => ({}), _joinNote: (_m, txt) => txt, _seasons: () => [],
        requestRender() {}, showToast(s) { this.toasts.push(s); },
        supabase: { from: (table) => ({ update: (row) => ({ eq: async (_c, id) => { t.saved.push({ table, id, ...row }); return { error: null }; } }) }) },
    };
    for (const f of ['_mentionTargets', '_lineTodos', '_noteTodos', '_vendorTodos', '_allNoteTodos', '_locateTodoLine',
                     '_todoSource', 'toggleSourceTodo', 'toggleNoteTodo',
                     '_splitDue', '_findWhen', '_ymd', '_plusDays', '_nextDow']) t[f] = method(f);
    return t;
};
const snapOf = (t, id) => t._todoSnap.get(String(id));

test('[ ] 원단 발주 10/20 → 할 일 1개, 날짜 10-20, 제목에서 날짜 빠짐', () => {
    const t = mk([{ id: 'n1', title: '회의록', body: '회의\n[ ] 원단 발주 10/20\n끝' }]);
    const all = t._allNoteTodos();
    assert.equal(all.length, 1);
    assert.equal(all[0].id, 'n1#1');
    assert.equal(all[0].title, '원단 발주');
    assert.match(all[0].due, /^\d{4}-10-20$/);
    assert.equal(all[0].from, '회의록');
    assert.equal(all[0].done, false);
});
test('빈 [ ] 줄은 할 일이 아니다', () => {
    assert.equal(mk()._lineTodos('[ ]\n[ ]   \n[x] 끝', { kind: 'note', id: 'n' }).length, 1);
});

test('읽기 함수는 출처를 받는다 — 제품·거래처 칸도 같은 함수(3단계 대비)', () => {
    const r = mk()._lineTodos('[ ] 샘플 확인', { kind: 'vendor', id: 'v9', from: '영진사' });
    assert.equal(r[0].src, 'vendor'); assert.equal(r[0].srcId, 'v9'); assert.equal(r[0].from, '영진사'); assert.equal(r[0].id, 'v9#0');
});

test('가드: 같은 문구 줄이 둘이면 n번째로 구분한다', () => {
    const t = mk([{ id: 'n1', body: '[ ] 샘플 확인\n중간\n[ ] 샘플 확인' }]);
    const all = t._allNoteTodos();
    assert.deepEqual(all.map(x => x.occ), [1, 2]);
    const lines = t.noteList[0].body.split('\n');
    assert.equal(t._locateTodoLine(lines, 0, snapOf(t, 'n1#0')), 0);
    assert.equal(t._locateTodoLine(lines, 2, snapOf(t, 'n1#2')), 2);
});

test('가드: 위에 줄이 끼어들어 밀려도 같은 줄을 찾는다', () => {
    const t = mk([{ id: 'n1', body: '[ ] A\n[ ] 샘플 확인\n[ ] 샘플 확인' }]);
    t._allNoteTodos();
    const snap = snapOf(t, 'n1#2');                  // 두 번째 '샘플 확인'
    const lines = '새 줄\n[ ] A\n[ ] 샘플 확인\n[ ] 샘플 확인'.split('\n');
    assert.equal(t._locateTodoLine(lines, 2, snap), 3);
});

test('가드: 그 줄이 지워졌으면 -1 (엉뚱한 줄을 건드리지 않는다)', () => {
    const t = mk([{ id: 'n1', body: '[ ] A\n[ ] B' }]);
    t._allNoteTodos();
    assert.equal(t._locateTodoLine(['[ ] A', '[ ] C'], 1, snapOf(t, 'n1#1')), -1);
    assert.equal(t._locateTodoLine(['[ ] B'], 1, snapOf(t, 'n1#1')), 0);   // 다른 자리에 남아 있으면 그 줄
});

test('가드: 체크 상태가 바뀌어도 같은 줄로 본다', () => {
    const t = mk([{ id: 'n1', body: '[ ] 원단 발주 10/20' }]);
    t._allNoteTodos();
    assert.equal(t._locateTodoLine(['[x] 원단 발주 10/20'], 0, snapOf(t, 'n1#0')), 0);
    assert.equal(t._locateTodoLine(['[X]  원단  발주 10/20'], 0, snapOf(t, 'n1#0')), 0);  // 띄어쓰기 차이 무시
});

test('할 일에서 체크 → 메모 줄 [x] → 다시 → [ ] (저장까지)', async () => {
    const t = mk([{ id: 'n1', body: '회의\n[ ] 원단 발주 10/20' }]);
    t._allNoteTodos();
    await t.toggleNoteTodo('n1', 1, snapOf(t, 'n1#1'));
    assert.equal(t.noteList[0].body, '회의\n[x] 원단 발주 10/20');
    assert.equal(t.saved.at(-1).body, '회의\n[x] 원단 발주 10/20');
    assert.equal(t._allNoteTodos()[0].done, true);
    await t.toggleNoteTodo('n1', 1, snapOf(t, 'n1#1'));
    assert.equal(t.noteList[0].body, '회의\n[ ] 원단 발주 10/20');
});

test('메모가 그사이 바뀌었으면 밀린 줄을 체크하고, 없으면 안내만 하고 안 바꾼다', async () => {
    const t = mk([{ id: 'n1', body: '[ ] A\n[ ] B' }]);
    t._allNoteTodos();
    const sB = snapOf(t, 'n1#1');
    t.noteList[0].body = '[ ] 새것\n[ ] A\n[ ] B';
    await t.toggleNoteTodo('n1', 1, sB);
    assert.equal(t.noteList[0].body, '[ ] 새것\n[ ] A\n[x] B');
    t.noteList[0].body = '[ ] A';
    const n0 = t.saved.length;
    await t.toggleNoteTodo('n1', 1, sB);
    assert.equal(t.noteList[0].body, '[ ] A');
    assert.equal(t.saved.length, n0);
    assert.match(t.toasts.at(-1), /못 찾았습니다/);
});

test('편집 중인 줄 배열도 같이 바뀐다(저장 때 [x] 가 덮이지 않게)', async () => {
    const t = mk([{ id: 'n1', body: '[ ] A' }]);
    t._nbFor = 'n1'; t._nbLines = ['[ ] A'];
    t._allNoteTodos();
    await t.toggleNoteTodo('n1', 0, snapOf(t, 'n1#0'));
    assert.deepEqual(t._nbLines, ['[x] A']);
});
