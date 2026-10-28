//  제품 메모 한 곳(사장님 10-28 "메모랑 기록 두번씩쓰고있네") — main.js 실제 함수(가짜 앱) · 100/101 마이그레이션·되돌리기(PGlite)
//  사례(운영 읽기 전용 10-28): 한 줄 메모 46개 · 장 9개 · 나그랑(빈 장 + 한 줄) · 니트 비니(서로 다른 글) · 벤투스(장에 한 줄이 이미 있음)
//   · 헨리넥 셋업 어덜트 = 장 둘(0.015초 차, 13자 + 148자)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const src = read('../main.js');
const grab = (name) => {
    const a = src.search(new RegExp(`\\n    (async )?${name}\\(`)) + 1;
    assert.ok(a > 0, name + ' 없음');
    const b = src.indexOf('\n    }\n', a) + 6;
    const body = src.slice(a, b).trim();
    return eval('(' + (body.startsWith('async ') ? 'async function ' + body.slice(6) : 'function ' + body) + ')');
};
const META = /^<!--p (.*?)-->\n?/;

//  가짜 DB — notes·product_items 두 표. 넣기는 일부러 늦게 끝나 겹침을 만든다.
const fakeDb = (notes, items, failItems) => {
    const log = [];
    let seq = 0;
    const later = v => new Promise(r => setTimeout(() => r(v), 5));
    const from = (tbl) => {
        const rows = tbl === 'notes' ? notes : items;
        const q = { f: [] };
        const run = () => rows.filter(r => q.f.every(fn => fn(r)));
        const chain = {
            select() { return chain; },
            not(c) { q.f.push(r => r[c] != null); return chain; },
            eq(c, v) {
                q.f.push(r => String(r[c]) === String(v));
                if (q.patch && failItems && tbl === 'product_items') return later({ error: { message: '권한 없음' } });
                if (q.patch) { run().forEach(r => Object.assign(r, q.patch)); log.push(['update', tbl, v, q.patch]); return later({ error: null }); }
                return chain;
            },
            order() { return chain; },
            limit(n) { return later({ data: run().sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(0, n), error: null }); },
            then(res, rej) { return later({ data: run(), error: null }).then(res, rej); },
            update(patch) { q.patch = patch; return chain; },
            insert(arr) {
                const made = arr.map(r => ({ id: 'n' + (++seq), created_at: '2026-10-28T00:00:0' + seq, ...r }));
                return { select: () => ({ single: async () => { await later(); rows.push(...made); log.push(['insert', tbl, made[0].item_id]); return { data: made[0], error: null }; } }) };
            },
        };
        return chain;
    };
    return { supabase: { from }, log };
};

const mkApp = ({ items, notes = [], seasons = [], failItems = false }) => {
    const db = fakeDb(notes, items, failItems);
    const t = {
        pItems: items, noteList: [], supabase: db.supabase, toasts: [],
        _seasons: () => seasons, _actor: () => '직원', showToast(m) { this.toasts.push(m); }, requestRender() {},
        _noteText: n => String(n.body || '').replace(META, ''),
        _noteMeta: n => { const m = String(n.body || '').match(META); return m ? JSON.parse(m[1]) : {}; },
        _joinNote: (meta, text) => (meta && Object.keys(meta).length ? `<!--p ${JSON.stringify(meta)}-->\n` : '') + text,
        _itemMemoLine(it) { return (this._itemMemoPlain(it).split('\n').find(l => l.trim()) || '').trim(); },
    };
    for (const n of ['_itemNoteOf', '_memoHas', '_itemMemoText', '_itemMemoPlain', '_loadItemNotes', '_itemNoteRow', '_itemNoteQueue',
        '_dropLegacyMemo', 'saveItemNote', '_saveItemNoteNow', '_itemIssues']) t[n] = grab(n);
    t._ipTa = () => null;
    return { t, db };
};
globalThis.document = { getElementById: () => null };

test('합쳐 보이는 글: 이미 들어 있으면 그대로 · 장이 비면 한 줄 · 아니면 한 줄 + 장 글 · 목록은 사진 뺀 첫 줄', () => {
    const notes = [
        { id: 'x1', item_id: 'nag', body: '', created_at: '1' },                              // 나그랑: 빈 장
        { id: 'x2', item_id: 'kn', body: '실 색 바꿈', created_at: '1' },                      // 니트 비니: 다른 글
        { id: 'x3', item_id: 'ven', body: '<!--p {"pin":1}-->\n원단 입고 10/20\n재단', created_at: '1' },   // 벤투스: 이미 있음
        { id: 'x4', item_id: 'ph', body: '![사진](https://x/a.jpg)\n\n둘째 줄', created_at: '1' },
    ];
    const items = [
        { id: 'nag', memo: '10/26 원부자재 입고' }, { id: 'kn', memo: '샘플 요청' }, { id: 'ven', memo: ' 원단 입고 10/20 ' },
        { id: 'ph', memo: '' }, { id: 'none', memo: null },
    ];
    const { t } = mkApp({ items, notes });
    t.noteList = notes;
    const txt = id => t._itemMemoText(items.find(i => i.id === id));
    assert.equal(txt('nag'), '10/26 원부자재 입고');
    assert.equal(txt('kn'), '샘플 요청\n실 색 바꿈');
    assert.equal(txt('ven'), '원단 입고 10/20\n재단', '메타 줄은 글에서 빠지고 겹친 한 줄은 안 붙인다');
    assert.equal(txt('none'), '');
    assert.equal(t._itemMemoLine(items[3]), '둘째 줄', '사진 줄은 목록 첫 줄이 아니다');
    assert.equal(t._itemMemoLine(items[1]), '샘플 요청');
});

test('반례(검수 10-28): 옛 메모 "입고" + 장 "미입고" → 부분 글자 일치는 들어 있는 게 아님, 둘 다 남는다', () => {
    const notes = [{ id: 'y1', item_id: 'mi', body: '미입고', created_at: '1' }];
    const items = [{ id: 'mi', memo: '입고' }];
    const { t } = mkApp({ items, notes });
    t.noteList = notes;
    assert.equal(t._itemMemoText(items[0]), '입고\n미입고');
    assert.equal(t._memoHas('미입고', '입고'), false);
    assert.equal(t._memoHas('a\n  입고 \nb', '입고'), true, '줄 통째면 있음(앞뒤 공백 무시)');
    assert.equal(t._memoHas('10/27 오리지널 전달 (노스 벤투스)', '10/27 오리지널 전달'), false, '운영 벤투스 — 둘 다 남김');
    assert.equal(t._memoHas('x\n샘플\n요청\ny', '샘플\n요청'), true, '여러 줄도 이어진 줄 통째');
});

test('옛 한 줄 칸을 못 비우면 "저장됨"으로 숨기지 않고 부분 실패로 알린다 · 장은 저장됨', async () => {
    const items = [{ id: 'k', name: 'K', memo: '옛 한 줄' }];
    const { t } = mkApp({ items, failItems: true });
    const n = await t.saveItemNote('k', '옛 한 줄\n새 글');
    assert.ok(n && n.body === '옛 한 줄\n새 글', '장은 저장');
    assert.equal(items[0].memo, '옛 한 줄', '칸은 그대로(지우지 못함)');
    assert.equal(t.toasts.length, 1);
    assert.match(t.toasts[0], /메모는 저장됐지만 옛 한 줄 칸을 못 비움: 권한 없음/);
    assert.equal(t._itemMemoText(items[0]), '옛 한 줄\n새 글', '화면엔 두 번 안 보임');
    const { t: t2 } = mkApp({ items: [{ id: 'k', name: 'K', memo: '옛' }], failItems: true });
    await t2.saveItemNote('k', '');
    assert.match(t2.toasts[0], /못 비움/, '지운 경우도 알림');
    assert.match(src, /if \(error\) throw error;   \/\/ 못 비우면/);
    assert.match(src, /partial = '사진은 올렸지만 옛 한 줄 칸을 못 비움/, '사진 붙이기도 부분 실패 알림');
    assert.match(src, /메모 \$\{memoLeft\}줄은 장에 담았지만 한 줄 칸을 못 비움/, '노션 가져오기도');
});

test('같은 제품 저장이 겹쳐도(입력 멈춤 + 칸 벗어남) 장은 하나 · 옛 한 줄 칸은 비움', async () => {
    const items = [{ id: 'hn', name: '헨리넥 셋업 어덜트', memo: '', product_id: 's1', brand_id: 'b1' }];
    const { t, db } = mkApp({ items, seasons: [{ id: 's1', name: '26FW' }] });
    const a = t.saveItemNote('hn', '상의 기존 맨투맨 수정\n');
    const b = t.saveItemNote('hn', '상의 기존 맨투맨 수정\n\n상의)패턴 솔리드맨투맨');
    await Promise.all([a, b]);
    const mine = db.log.filter(l => l[0] === 'insert');
    assert.equal(mine.length, 1, '넣기는 한 번');
    const n = t.noteList.filter(x => x.item_id === 'hn');
    assert.equal(n.length, 1);
    assert.equal(n[0].body, '상의 기존 맨투맨 수정\n\n상의)패턴 솔리드맨투맨', '나중 글이 남는다(잃지 않음)');
    assert.deepEqual({ folder: n[0].folder, scope: n[0].scope, product_id: n[0].product_id }, { folder: '26FW', scope: 'project', product_id: 's1' });
});

test('메모 앱 목록(200장)에서 밀려난 장도 찾아서 새로 안 만든다 · 옛 한 줄은 장에 들어가고 칸은 빈다', async () => {
    const notes = [{ id: 'old', item_id: 'kn', body: '실 색 바꿈', created_at: '2026-01-01' }];
    const items = [{ id: 'kn', name: '니트 비니', memo: '샘플 요청' }];
    const { t, db } = mkApp({ items, notes });
    t.noteList = [];                                   // 화면 목록엔 없음
    await t.saveItemNote('kn', '샘플 요청\n실 색 바꿈\n추가');
    assert.equal(db.log.filter(l => l[0] === 'insert').length, 0);
    assert.equal(notes.length, 1);
    assert.equal(notes[0].body, '샘플 요청\n실 색 바꿈\n추가');
    assert.equal(items[0].memo, null, '한 줄 칸 비움');
});

test('옛 한 줄만 있고 그대로 둔 채 벗어나면 아무것도 안 쓴다 · 장 목록을 못 받으면 안 만든다', async () => {
    const items = [{ id: 'q', name: 'Q', memo: '그대로' }];
    const { t, db } = mkApp({ items });
    await t.saveItemNote('q', '그대로');
    assert.equal(db.log.length, 0);
    assert.equal(items[0].memo, '그대로');
    const { t: t2, db: db2 } = mkApp({ items: [{ id: 'z', name: 'Z', memo: '' }] });
    t2.supabase = { from: () => ({ select: () => ({ not: async () => ({ data: null, error: { message: '끊김' } }) }) }) };
    assert.equal(await t2.saveItemNote('z', '새 글'), null);
    assert.equal(db2.log.length, 0);
    assert.match(t2.toasts[0], /끊김/);
});

test('확인 배지: 진짜 고칠 것만(이름·브랜드·테스트·출고예정일 지남) — 시즌 없음·메모 낱말은 안 띄운다', () => {
    const { t } = mkApp({ items: [] });
    const ok = { name: '후드', brand_id: 'b', status: '샘플', ship_date: '2026-11-03', product_id: null, memo: '샘플 요청' };
    assert.deepEqual(t._itemIssues(ok, '2026-10-28'), [], '시즌 없음·메모 낱말은 배지 아님');
    assert.deepEqual(t._itemIssues({ ...ok, ship_date: '2026-10-14' }, '2026-10-28'), ['출고예정일 지남']);
    assert.deepEqual(t._itemIssues({ ...ok, ship_date: '2026-10-14', status: '출고완료' }, '2026-10-28'), []);
    assert.deepEqual(t._itemIssues({ ...ok, name: '', brand_id: null }, '2026-10-28'), ['이름 없음', '브랜드 없음']);
    assert.deepEqual(t._itemIssues({ ...ok, name: 'test 후드' }, '2026-10-28'), ['테스트 항목']);
});

test('화면: 제품 페이지에 한 줄 메모 칸 없음 · 목록 메모 열은 장의 첫 줄 · 노션 가져오기는 메모를 장으로', () => {
    const page = src.slice(src.indexOf('\n    _itemPageHTML('), src.indexOf('\n    }\n', src.indexOf('\n    _itemPageHTML(')));
    assert.ok(page.length > 100);
    assert.doesNotMatch(page, /field\('메모'/, '한 줄 메모 칸 없음');
    assert.doesNotMatch(src, /한 줄 메모<\/|'한 줄 메모'/, '자세히 칸에도 없음');
    assert.match(src, /<td class="it-memo"[^\n]*_itemMemoLine\(it\)/);
    assert.match(src, /\.insert\(part\.map\(it => this\._itemNoteRow\(it, String\(it\.memo\)\.trim\(\)\)\)\)/);
    assert.match(src, /oninput="app\.itemNoteTyping\(\)" onblur="app\.saveItemNote\('\$\{it\.id\}'\)">\$\{esc\(this\._itemMemoText\(it\)\)\}/);
});

const PG = !process.env.PGLITE_PATH && 'PGLITE_PATH 없음 — 건너뜀';
const seed = `
    create role anon; create role authenticated;
    create table brands (id uuid primary key default gen_random_uuid(), name text);
    create table products (id uuid primary key default gen_random_uuid(), name text);
    create table product_items (id uuid primary key, name text, memo text, product_id uuid references products(id), brand_id uuid references brands(id));
    create table notes (
      id uuid primary key default gen_random_uuid(), title text not null default '', body text, folder text not null default '메모',
      product_id uuid references products(id) on delete set null, brand_id uuid references brands(id) on delete set null,
      pinned boolean not null default false, created_by text, created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(), owner text, scope text not null default 'shared',
      item_id uuid references product_items(id) on delete cascade);
    create index idx_notes_item on notes(item_id);
    create function touch_note() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
    create trigger trg_note_touch before update on notes for each row execute function touch_note();
    insert into products values ('00000000-0000-0000-0000-0000000000a1', '26FW');
    insert into brands values ('00000000-0000-0000-0000-0000000000b1', '하이헤이호');
    insert into product_items values
      ('00000000-0000-0000-0000-000000000001', '나그랑 맨투맨', E'10/26 원부자재 입고', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1'),
      ('00000000-0000-0000-0000-000000000002', '니트 비니', '샘플 요청', null, '00000000-0000-0000-0000-0000000000b1'),
      ('00000000-0000-0000-0000-000000000003', '벤투스JP', E' 원단 입고 10/20 \n', null, null),
      ('00000000-0000-0000-0000-000000000004', '하렘팬츠', '공장 컨펌', '00000000-0000-0000-0000-0000000000a1', null),
      ('00000000-0000-0000-0000-000000000005', '헨리넥 셋업 어덜트', '본사 확인', null, null),
      ('00000000-0000-0000-0000-000000000006', '빈칸', E'  \n ', null, null),
      ('00000000-0000-0000-0000-000000000007', '없음', null, null, null),
      ('00000000-0000-0000-0000-000000000008', '미입고 반례', '입고', null, null),
      ('00000000-0000-0000-0000-000000000009', '겹친 장 반례', null, null, null);
    insert into notes (id, body, item_id, created_at) values
      ('00000000-0000-0000-0000-00000000f001', '', '00000000-0000-0000-0000-000000000001', '2026-10-01'),
      ('00000000-0000-0000-0000-00000000f002', '실 색 바꿈', '00000000-0000-0000-0000-000000000002', '2026-10-01'),
      ('00000000-0000-0000-0000-00000000f003', E'<!--p {"pin":1}-->\n원단 입고 10/20\n재단', '00000000-0000-0000-0000-000000000003', '2026-10-01'),
      ('00000000-0000-0000-0000-00000000f005', E'상의 기존 맨투맨 수정\n', '00000000-0000-0000-0000-000000000005', '2026-10-26 08:20:26.859'),
      ('00000000-0000-0000-0000-00000000f006', E'\n상의)패턴 솔리드맨투맨-기장 2cm\n![사진](https://x/h.jpg)', '00000000-0000-0000-0000-000000000005', '2026-10-26 08:20:26.874'),
      ('00000000-0000-0000-0000-00000000f008', '미입고', '00000000-0000-0000-0000-000000000008', '2026-10-01'),
      ('00000000-0000-0000-0000-00000000f00a', '미입고', '00000000-0000-0000-0000-000000000009', '2026-10-01'),
      ('00000000-0000-0000-0000-00000000f00b', '입고', '00000000-0000-0000-0000-000000000009', '2026-10-02'),
      ('00000000-0000-0000-0000-00000000f009', '메모 앱 일반 장', null, '2026-10-01');
`;
const snap = async db => JSON.stringify({
    items: (await db.query(`select id, memo from product_items order by id`)).rows,
    notes: (await db.query(`select id, title, body, folder, item_id, product_id, brand_id, scope, created_by, created_at from notes order by id`)).rows,
});

test('100·101 무손실 옮기기 · 다시 돌려도 같음 · 하나 규칙 · 되돌리면 처음과 같음(PGlite)', { skip: PG }, async () => {
    const { PGlite } = await import(pathToFileURL(process.env.PGLITE_PATH).href);
    const db = new PGlite();
    await db.exec(seed);
    const before = await snap(db);
    const up100 = read('../supabase/migrations/100_item_memo_into_note.sql');
    await db.exec(up100);
    const once = await snap(db);
    await db.exec(up100);                                                  // 두 번 돌려도 같음
    assert.equal(await snap(db), once);

    const body = async item => (await db.query(`select body from notes where item_id = $1 order by created_at, id`, [item])).rows.map(r => r.body);
    const I = n => '00000000-0000-0000-0000-00000000000' + n;
    assert.deepEqual(await body(I(1)), ['10/26 원부자재 입고'], '빈 장 → 한 줄');
    assert.deepEqual(await body(I(2)), ['샘플 요청\n실 색 바꿈'], '다른 글 → 한 줄 + 장 글');
    assert.deepEqual(await body(I(3)), ['<!--p {"pin":1}-->\n원단 입고 10/20\n재단'], '이미 있음 → 그대로(메타 줄 유지)');
    const made = (await db.query(`select * from notes where item_id = $1`, [I(4)])).rows;
    assert.equal(made.length, 1, '장 없음 → 새 장');
    assert.deepEqual([made[0].body, made[0].title, made[0].folder, made[0].scope, made[0].brand_id],
        ['공장 컨펌', '하렘팬츠', '26FW', 'project', null]);
    assert.deepEqual(await body(I(5)), ['본사 확인\n상의 기존 맨투맨 수정\n', '\n상의)패턴 솔리드맨투맨-기장 2cm\n![사진](https://x/h.jpg)'], '장 둘이면 먼저 만든 장에');
    assert.deepEqual((await db.query(`select count(*)::int c from notes where item_id = $1`, [I(6)])).rows[0].c, 0, '빈칸 한 줄은 장 안 만듦');
    assert.deepEqual(await body(I(8)), ['입고\n미입고'], '반례: 부분 글자 일치는 있음 아님 — 옛 "입고" 안 잃음');
    const left = (await db.query(`select count(*)::int c from product_items where memo is not null and memo !~ '^\\s*$'`)).rows[0].c;
    assert.equal(left, 0, '한 줄 칸은 다 비움');
    assert.equal((await db.query(`select count(*)::int c from item_memo_merge_100`)).rows[0].c, 6);

    //  잃지 않음: 원래 한 줄 메모 글이 전부 그 제품 장 어딘가에 있다
    for (const r of JSON.parse(before).items.filter(r => r.memo && r.memo.trim())) {
        const all = (await body(r.id)).join('\n');
        assert.ok(all.includes(r.memo.trim()), r.id + ' 한 줄 메모가 장에 있음');
    }

    //  하나 규칙 전엔 둘째 장이 들어간다(101 전 = 헨리넥 사례 그대로)
    const up101 = read('../supabase/migrations/101_item_note_one.sql');
    const pre101 = await snap(db);
    await db.exec(up101);
    assert.deepEqual(await body(I(5)), ['본사 확인\n상의 기존 맨투맨 수정\n\n상의)패턴 솔리드맨투맨-기장 2cm\n![사진](https://x/h.jpg)'], '헨리넥 한 장으로(사진 줄 포함)');
    assert.deepEqual(await body(I(9)), ['미입고\n입고'], '101 반례: 둘째 장 "입고"도 안 잃음');
    await db.exec(up101);
    await assert.rejects(db.query(`insert into notes (body, item_id) values ('둘째', $1)`, [I(2)]), /notes_item_one|duplicate/, '제품당 장 하나');
    await db.query(`insert into notes (body) values ('item 없는 장은 여럿 가능')`);
    await db.query(`insert into notes (body) values ('item 없는 장은 여럿 가능')`);
    await db.query(`delete from notes where item_id is null and body = 'item 없는 장은 여럿 가능'`);
    const anon = (await db.query(`select has_table_privilege('anon', 'item_note_dedupe_101', 'select') a,
        has_table_privilege('authenticated', 'item_memo_merge_100', 'select') b`)).rows[0];
    assert.deepEqual(anon, { a: false, b: false }, '백업 표는 API 로 안 보임');

    await db.exec(read('../supabase/rollbacks/101_item_note_one.down.sql'));
    assert.equal(await snap(db), pre101, '101 되돌리기 = 101 전');
    await db.exec(read('../supabase/rollbacks/100_item_memo_into_note.down.sql'));
    assert.equal(await snap(db), before, '100 되돌리기 = 처음');
    assert.equal((await db.query(`select to_regclass('item_memo_merge_100') a, to_regclass('notes_item_one') b`)).rows[0].a, null);
});

test('100 뒤 직원이 고친 장은 되돌리기가 안 덮는다(PGlite)', { skip: PG }, async () => {
    const { PGlite } = await import(pathToFileURL(process.env.PGLITE_PATH).href);
    const db = new PGlite();
    await db.exec(seed);
    await db.exec(read('../supabase/migrations/100_item_memo_into_note.sql'));
    const I2 = '00000000-0000-0000-0000-000000000002', I4 = '00000000-0000-0000-0000-000000000004';
    await db.query(`update notes set body = '직원이 고침' where item_id = $1`, [I2]);
    await db.query(`update notes set body = '공장 컨펌 → 완료' where item_id = $1`, [I4]);
    await db.exec(read('../supabase/rollbacks/100_item_memo_into_note.down.sql'));
    const b = async i => (await db.query(`select body from notes where item_id = $1`, [i])).rows.map(r => r.body);
    assert.deepEqual(await b(I2), ['직원이 고침']);
    assert.deepEqual(await b(I4), ['공장 컨펌 → 완료'], '고친 새 장은 안 지움');
    assert.equal((await db.query(`select memo from product_items where id = $1`, [I2])).rows[0].memo, '샘플 요청', '한 줄은 되돌아옴');
});
