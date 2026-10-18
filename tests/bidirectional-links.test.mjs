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
    return eval('(' + src.slice(a, b).trim().replace(new RegExp(`^(async )?${name}\\(`), (_, as) => `${as || ''}function ${name}(`) + ')');
};
const field = (name) => {
    const m = new RegExp(`\\n    ${name} = (.+);\\n`).exec(src); assert.ok(m, `${name} 못 찾음`); return eval('(' + m[1] + ')');
};
const mk = () => {
    const t = {
        NOTE_TODO_RE: field('NOTE_TODO_RE'), MENTION_RE: field('MENTION_RE'),
        pItems: [{ id: 'i1', name: '토끼 원피스' }],
        vendors: [{ id: 'v1', name: '영진사', memo: '[ ] 샘플 확인' }],
        noteList: [
            { id: 'n1', title: '회의 메모', body: '@[item:i1]\n[ ] 샘플 확인' },
            { id: 'in1', title: '토끼 원피스', item_id: 'i1', body: '[ ] 치수 확인' },
            { id: 'sn1', title: '기본 페이지', product_id: 's1', body: '[ ] 시즌 샘플 확인' },
        ],
        saved: [], toasts: [], _nbFor: null,
        _noteText: n => n.body || '', _noteMeta: () => ({}), _joinNote: (_m, body) => body,
        _seasons: () => [], requestRender() {}, showToast(v) { this.toasts.push(v); },
    };
    t.supabase = { from: table => ({ update: row => ({ eq: async (_k, id) => { t.saved.push({ table, id, row }); return { error: null }; } }) }) };
    t._vesc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    for (const f of ['_mentionTargets', '_mentionInfo', '_noteInlineHTML', '_lineTodos', '_noteTodos', '_vendorTodos', '_allNoteTodos', '_locateTodoLine',
        '_todoSource', 'toggleSourceTodo', 'toggleLinkedTodo', '_linkedThings', '_splitDue', '_findWhen', '_ymd', '_plusDays', '_nextDow']) t[f] = method(f);
    return t;
};

test('@[kind:id] 토큰은 제품·시즌·거래처 대상으로 중복 없이 읽힌다', () => {
    const t = mk();
    assert.deepEqual(t._mentionTargets('@[item:i1] @[vendor:v1] @[item:i1]'), [
        { kind: 'item', id: 'i1', token: '@[item:i1]' },
        { kind: 'vendor', id: 'v1', token: '@[vendor:v1]' },
    ]);
});

test('허용 형식 밖의 멘션 ID는 칩이나 실행 코드가 되지 않는다', () => {
    const t = mk();
    const attack = "@[item:x');alert(1);//]";
    assert.deepEqual(t._mentionTargets(attack), []);
    const html = t._noteInlineHTML(attack);
    assert.doesNotMatch(html, /mention-chip|onclick=/);
    assert.match(html, /@\[item:x'\);alert\(1\);\/\/\]/);
});

test('제품 기록·거래처 메모 [ ]가 원본 종류와 출처명으로 한 목록에 합쳐진다', () => {
    const all = mk()._allNoteTodos();
    assert.ok(all.some(x => x.src === 'item' && x.srcId === 'i1' && x.from === '토끼 원피스' && x.title === '치수 확인'));
    assert.ok(all.some(x => x.src === 'vendor' && x.srcId === 'v1' && x.from === '영진사' && x.title === '샘플 확인'));
});

test('시즌 기본페이지 할 일은 시즌으로 재분류하지 않고 메모 원본과 줄 번호를 유지한다', () => {
    const t = mk();
    const todo = t._allNoteTodos().find(x => x.noteId === 'sn1');
    assert.equal(todo.src, 'note');
    assert.equal(todo.srcId, 'sn1');
    assert.equal(todo.seasonId, 's1');
    assert.equal(todo.line, 0);
    assert.ok(t._linkedThings('season', 's1').todos.some(x => x.id === todo.id));
});

test('메모가 제품을 언급하면 제품 연결 패널에 메모와 그 메모의 할 일이 함께 잡힌다', () => {
    const linked = mk()._linkedThings('item', 'i1');
    assert.deepEqual(linked.notes.map(x => x.id), ['n1']);
    assert.ok(linked.todos.some(x => x.noteId === 'n1' && x.title === '샘플 확인'));
    assert.ok(linked.todos.some(x => x.src === 'item' && x.title === '치수 확인'));
});

test('할 일에서 거래처 출처를 체크하면 vendors.memo 원본이 [x]로 저장된다', async () => {
    const t = mk();
    const todo = t._allNoteTodos().find(x => x.src === 'vendor');
    await t.toggleLinkedTodo(todo.id);
    assert.equal(t.vendors[0].memo, '[x] 샘플 확인');
    assert.deepEqual(t.saved.at(-1), { table: 'vendors', id: 'v1', row: { memo: '[x] 샘플 확인' } });
});

test('할 일에서 제품 출처를 체크하면 item_id 메모 원본이 [x]로 저장된다', async () => {
    const t = mk();
    const todo = t._allNoteTodos().find(x => x.src === 'item');
    await t.toggleLinkedTodo(todo.id);
    assert.equal(t.noteList.find(x => x.id === 'in1').body, '[x] 치수 확인');
    assert.deepEqual(t.saved.at(-1), { table: 'notes', id: 'in1', row: { body: '[x] 치수 확인' } });
});

test('자동완성은 사람뿐 아니라 제품·시즌·거래처 토큰을 만든다', () => {
    const body = src.slice(src.indexOf('    _atPool()'), src.indexOf('\n    noteTyping()', src.indexOf('    _atPool()')));
    assert.match(body, /@\[item:\$\{x\.id\}\]/);
    assert.match(body, /@\[season:\$\{x\.id\}\]/);
    assert.match(body, /@\[vendor:\$\{x\.id\}\]/);
    assert.match(src, /_connectedHTML\('item', it\.id\)/);
    assert.match(src, /_connectedHTML\('vendor', doc\.id\)/);
    assert.match(src, /_connectedHTML\('season', product\.id\)/);
    assert.doesNotMatch(src, /mention-chip[^`]*onclick=/);
});
