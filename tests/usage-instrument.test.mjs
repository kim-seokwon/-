//  사용편의 2단계 계측 보완 + 판매/생산 묶음 창 중복(10-29 .work/사용편의/2단계-후보.md)
//  main.js 실제 함수를 떼어 가짜 앱으로 돌린다. task_clicks 연결은 진짜 Postgres(PGlite)에서 091 뷰로 본다 — PGLITE_PATH 없으면 그 부분만 건너뜀.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { makeTracker, paperSeenAction, PAPER_CLOSE_ACTION, ORDER_FILTER_ACTION, INV_TAB_ACTION, UI_ACTIONS_NEXT } from '../uiTrack.js';

const src = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const grab = (name) => {
    const a = src.search(new RegExp(`\\n    (async )?${name}\\(`)) + 1;
    assert.ok(a > 0, name + ' 없음');
    const line = src.slice(a, src.indexOf('\n', a));
    const b = /\}\s*$/.test(line) && !/\{\s*$/.test(line) ? a + line.length : src.indexOf('\n    }\n', a) + 6;   // 한 줄짜리 메서드도
    const body = src.slice(a, b).trim();
    return eval('(' + (body.startsWith('async ') ? 'async function ' + body.slice(6) : 'function ' + body) + ')');
};
const APP_GROUPS = eval(src.slice(src.indexOf('APP_GROUPS = [') + 13, src.indexOf('\n    ];', src.indexOf('APP_GROUPS = [')) + 6));
const flush = () => new Promise(r => setTimeout(r, 5));

//  기록은 진짜 makeTracker 로(1초 거르기까지 그대로) — 시각만 손으로 민다
const mkApp = (extra = {}) => {
    let t = 0;
    const rows = [];
    const app = {
        macMode: true, wins: [], _macZ: 1, renders: 0, APP_GROUPS, rows,
        _viewAllowed: () => true,
        tick(ms = 2000) { t += ms; },
        requestRender() { this.renders++; }, render() { this.renders++; }, _pushHistory() {}, showToast() {},
        ...extra,
    };
    app.track = makeTracker({ send: r => { rows.push(r); }, now: () => t, later: f => f() });
    for (const n of ['_groupOf', '_winOf', '_winView', 'macOpen', 'macShowDesktop', 'switchAppTab', 'switchView', '_csPick', 'selectCS',
        'rowPick', '_itemPick', 'selItem', 'openItemPage', '_itemNoteSaved', 'closePaper', '_pcScroll', 'setItem', 'selectInv']) app[n] = grab(n);
    app.macFocus = function (id) { const w = this.wins.find(x => x.id === id); if (w) w.z = ++this._macZ; };
    return app;
};
const sent = async app => { await flush(); return app.rows.map(r => `${r.screen}:${r.action}`); };
globalThis.window ??= { innerWidth: 1440, innerHeight: 900, scrollTo() {} };
globalThis.document ??= { getElementById: () => null };

// ── 창 버그: 같은 묶음 창은 하나 ─────────────────────────────────────
test('판매 창이 CS 탭일 때 독 판매 → 창을 더 만들지 않고 그 창을 앞으로, 보던 CS 탭 그대로', async () => {
    const app = mkApp();
    app.macOpen('orders', { app: 1 });
    assert.equal(app.wins.length, 1);
    const w = app.wins[0];
    app.tick(); app.switchAppTab(w.id, 'cs');
    app.wins.push({ id: 'w2', view: 'items', z: 9 }); app._macZ = 9;   // 생산 창이 앞에 있다
    app.tick(); app.macOpen('orders', { app: 1 });
    assert.equal(app.wins.length, 2, '판매 창이 하나 더 생기면 안 된다');
    assert.equal(w.view, 'cs', '독 아이콘은 탭을 안 바꾼다');
    assert.ok(w.z > 9, '앞으로');
    assert.deepEqual(await sent(app), ['orders:open', 'cs:open', 'cs:open'], '보이는 화면(cs)을 연 것으로 남긴다');
});

test('바탕화면·링크로 다른 탭 화면을 부르면 → 같은 묶음 창을 그 탭으로 바꾼다(새 창 없음)', async () => {
    const app = mkApp();
    app.macOpen('orders');
    const w = app.wins[0];
    app.tick(); app.macOpen('cs');
    assert.equal(app.wins.length, 1); assert.equal(w.view, 'cs');
    const r0 = app.renders;
    app.tick(); app.macOpen('orders');
    assert.equal(app.wins.length, 1); assert.equal(w.view, 'orders');
    assert.ok(app.renders > r0, '탭이 바뀌면 다시 그린다');
    app.tick(); app.macOpen('inventory');
    assert.equal(w.view, 'inventory');
    assert.deepEqual(await sent(app), ['orders:open', 'cs:open', 'orders:open', 'inventory:open']);
});

test('다른 묶음·묶음 밖 화면은 따로 — 판매와 생산은 각자 창, 뉴스는 뉴스 창 하나', () => {
    const app = mkApp();
    app.macOpen('cs'); app.tick();
    app.macOpen('tech_packs'); app.tick();
    assert.deepEqual(app.wins.map(w => w.view), ['cs', 'tech_packs']);
    app.macOpen('items'); app.tick();
    assert.deepEqual(app.wins.map(w => w.view), ['cs', 'items'], '생산 창 재사용');
    app.macOpen('news'); app.tick(); app.macOpen('news', { app: 1 }); app.tick();
    app.macOpen('calendar');
    assert.deepEqual(app.wins.map(w => w.view), ['cs', 'items', 'news', 'calendar']);
});

test('내려둔 묶음 창도 다시 올린다 · 같은 화면 창이 정확히 있으면 그 창이 먼저', () => {
    const app = mkApp();
    app.wins.push({ id: 'a', view: 'orders', min: false, z: 1 }, { id: 'b', view: 'cs', min: true, z: 2 });   // 옛 중복 창
    const r0 = app.renders;
    app.macOpen('cs');
    assert.equal(app.wins.find(w => w.id === 'b').min, false, '정확히 cs 인 창(b)을 올림');
    assert.equal(app.wins.find(w => w.id === 'a').view, 'orders', '다른 판매 창은 건드리지 않음');
    assert.ok(app.renders > r0);
    const one = mkApp();
    one.wins.push({ id: 'm', view: 'cs', min: true, z: 1 });
    one.macOpen('orders', { app: 1 });
    assert.equal(one.wins.length, 1); assert.equal(one.wins[0].min, false); assert.equal(one.wins[0].view, 'cs');
});

test('독: 앱 아이콘은 {app:1} 로 부르고, 켜짐 표시는 같은 묶음 창으로 본다', () => {
    assert.match(src, /const open = d\.launcher \? false : \(d\.desktop \? !this\.wins\.some\(w => !w\.min\) : this\._winOf\(d\.id\)\);/);
    assert.match(src, /`app\.macOpen\('\$\{d\.id\}',\{app:1\}\)`/);
    const app = mkApp();
    app.wins.push({ id: 'a', view: 'cs' });
    assert.ok(app._winOf('orders'), '판매 아이콘 = CS 탭 창도 켜짐');
    assert.equal(app._winOf('items'), null);
    assert.equal(app._winOf('news'), null);
});

// ── 계측 1·2: 창 안 화면 바꾸기도 open ────────────────────────────────
test('탭 전환은 바뀔 때만 그 화면 open — 같은 탭 다시 누름은 안 셈, 창 없으면 switchView', async () => {
    const app = mkApp();
    app.macOpen('items', { app: 1 });
    const w = app.wins[0];
    for (const v of ['tech_packs', 'tech_packs', 'sample_maker', 'items']) { app.tick(); app.switchAppTab(w.id, v); }
    assert.equal(w.view, 'items');
    const plain = mkApp({ macMode: false });
    plain.switchAppTab('none', 'quotes');
    assert.equal(plain.currentView, 'quotes');
    assert.deepEqual(await sent(app), ['items:open', 'tech_packs:open', 'sample_maker:open', 'items:open']);
    assert.deepEqual(await sent(plain), ['quotes:open']);
});

test('주문에서 CS 접수 → CS 탭으로 넘길 때 cs open · 시즌 → 제품리스트도 _winView', () => {
    assert.match(src, /const w = \(this\.wins \|\| \[\]\)\.find\(x => x\.view === 'orders'\);\n\s*if \(w\) \{ this\._winView\(w, 'cs'\); \} else if \(!this\.macMode\) \{ this\.currentView = 'cs'; this\.track\?\.\('cs', 'open'\); \}/);
    assert.match(src, /if \(this\.macMode && w\) \{ this\._winView\(w, 'items'\);/);
    assert.doesNotMatch(src, /\bw\.view = '(cs|items)'/, '창 화면을 직접 바꾸는 곳이 남으면 open 이 빠진다');
    assert.equal((src.match(/\bw\.view = view;/g) || []).length, 1, 'w.view 를 바꾸는 곳은 _winView 한 곳');
});

// ── 계측 3: cs_select ─────────────────────────────────────────────
test('CS 줄 고르기 — 줄 누름·상태칸 누름·상세 단추 모두 cs_select 한 번, 같은 줄은 안 셈', async () => {
    const app = mkApp();
    const ev = tag => ({ target: { closest: () => (tag ? { tagName: tag, type: '', dataset: {} } : null) } });
    app.rowPick(ev(null), 'c1', 'cs');
    assert.equal(app.csSel, 'c1');
    const r1 = app.renders;
    app.tick(); app.rowPick(ev(null), 'c1', 'cs');
    assert.equal(app.renders, r1, '같은 줄은 다시 안 그림');
    app.tick(); app.rowPick(ev('SELECT'), 'c2', 'cs');
    assert.equal(app.csSel, 'c2'); assert.equal(app.renders, r1, '상태칸 드롭다운은 그리지 않는다(닫히지 않게)');
    app.tick(); app.selectCS('c3'); app.tick(); app.selectCS('c3');
    app.tick(); app.rowPick(ev('BUTTON'), 'c9', 'cs');
    assert.equal(app.csSel, 'c3', '단추는 제 할 일만');
    assert.deepEqual(await sent(app), ['cs:cs_select', 'cs:cs_select', 'cs:cs_select']);
});

// ── 계측 4: 제품 상세·메모·더블클릭 ───────────────────────────────────
test('제품: 줄 고르기 item_select · 이름 단추 item_open · 두 번 누름 item_open_dbl', async () => {
    const app = mkApp();
    const ev = { target: { closest: () => null } };
    app.rowPick(ev, 'i1'); app.tick(); app.rowPick(ev, 'i1');
    app.tick(); app.openItemPage('i1', 1);
    assert.equal(app.itemPage, 'i1');
    app.tick(); app.openItemPage('i2');
    assert.deepEqual(await sent(app), ['items:item_select', 'items:item_open_dbl', 'items:item_open']);
    //  목록 줄: 두 번 누름 → ,1 / 이름 단추 → 인자 없음
    const html = src.slice(src.indexOf("const open = compact ? `app.openItemFromNote"), src.indexOf('<td class="it-c">', src.indexOf("const open = compact ? `app.openItemFromNote")));
    assert.match(html, /const openDbl = compact \? open : `app\.openItemPage\('\$\{it\.id\}',1\)`;/);
    assert.match(html, /ondblclick="\$\{openDbl\}"/);
    assert.match(src, /class="it-nameb" onclick="event\.stopPropagation\(\);\$\{open\}"/);
});

test('제품 한 줄 메모 저장 성공 때만 item_memo — 실패·다른 칸은 안 셈', async () => {
    let fail = false;
    const app = mkApp({
        pItems: [{ id: 'i1', memo: '' }], _seasons: () => [],
        supabase: { from: () => ({ update: () => ({ eq: async () => ({ error: fail ? { message: 'x' } : null }) }) }) },
    });
    assert.equal(await app.setItem('i1', 'memo', '원단 확인'), true);
    app.tick(); fail = true; assert.equal(await app.setItem('i1', 'memo', '다시'), false);
    app.tick(); fail = false; await app.setItem('i1', 'pattern_no', 'P1');
    assert.deepEqual(await sent(app), ['items:item_memo']);
});

test('제품 기록 저장 — 0.9초 자동 저장마다가 아니라 상세 한 번 볼 때 한 번(item_note)', async () => {
    const app = mkApp();
    app._itemPick('i1');
    for (let i = 0; i < 4; i++) { app.tick(); app._itemNoteSaved('i1'); }
    app.tick(); app._itemPick('i2'); app.tick(); app._itemNoteSaved('i2');
    app.tick(); app.openItemPage('i2'); app.tick(); app._itemNoteSaved('i2');
    assert.deepEqual(await sent(app), ['items:item_select', 'items:item_note', 'items:item_select', 'items:item_note', 'items:item_open', 'items:item_note']);
    //  saveItemNote: 고친 저장이 성공했을 때만(업데이트 실패 → 안 셈), 새 장도 성공 뒤
    const at = src.indexOf('\n    async _saveItemNoteNow(');
    const f = src.slice(at, src.indexOf('\n    }\n', at));
    assert.match(f, /if \(error\) return fail\(error\.message\);[\s\S]*n\.body = body;[\s\S]*this\._itemNoteSaved\(id\);/);
    assert.match(f, /if \(error\) return fail\('\(047 SQL 필요\) ' \+ error\.message\);[\s\S]*this\._itemNoteSaved\(id\);\n\s*return data;/);
});

// ── 계측 5: 조간 닫는 법 + 본 장 수 ──────────────────────────────────
test('조간 본 장 수는 고정 구간 낱말로만', () => {
    assert.equal(paperSeenAction(1, 8), 'paper_seen_1');
    assert.equal(paperSeenAction(2, 8), 'paper_seen_2_3'); assert.equal(paperSeenAction(3, 8), 'paper_seen_2_3');
    assert.equal(paperSeenAction(4, 8), 'paper_seen_4_6'); assert.equal(paperSeenAction(6, 8), 'paper_seen_4_6');
    assert.equal(paperSeenAction(7, 12), 'paper_seen_7p');
    assert.equal(paperSeenAction(8, 8), 'paper_seen_all'); assert.equal(paperSeenAction(9, 8), 'paper_seen_all');
    assert.equal(paperSeenAction(1, 1), 'paper_seen_all');
    for (const [s, n] of [[0, 8], [1, undefined], [NaN, 3], ['x', 3], [1, 0]]) assert.equal(paperSeenAction(s, n), null, `${s}/${n}`);
});

test('조간 닫기: 닫는 법(다 봤음/✕/Esc) + 가장 멀리 넘긴 장 · 불러오는 중이면 장 수 없음 · 닫은 날은 다시 안 뜸', async () => {
    const store = {};
    globalThis.localStorage = { setItem: (k, v) => { store[k] = v; }, getItem: k => store[k] ?? null };
    const box = { querySelectorAll: () => [], querySelector: () => ({ disabled: false, textContent: '' }) };
    const track = { scrollLeft: 0, clientWidth: 100, closest: () => box };
    const app = mkApp({ _paperKey: () => 'pk', _ymdSeoul: () => '2026-10-29' });
    app.paper = { idx: 0, n: 8 };
    for (const i of [1, 2, 4, 3]) { track.scrollLeft = i * 100; app._pcScroll(track); }   // 5장째까지 갔다가 한 장 뒤로
    assert.equal(app.paper.seen, 5);
    app.closePaper('done');
    assert.equal(app.paper, null); assert.equal(store.pk, '2026-10-29');
    app.tick(); app.paper = { idx: 0, n: 8 }; app.closePaper('x');
    app.tick(); app.paper = { idx: 0, n: 3 }; for (const i of [1, 2]) { track.scrollLeft = i * 100; app._pcScroll(track); } app.closePaper('esc');
    app.tick(); app.paper = { loading: true }; app.closePaper('x');
    app.tick(); app.closePaper('x');   // 이미 닫힘 — 아무것도 안 남김
    assert.deepEqual(await sent(app), ['news:paper_close_done', 'news:paper_seen_4_6', 'news:paper_close_x', 'news:paper_seen_1',
        'news:paper_close_esc', 'news:paper_seen_all', 'news:paper_close_x']);
    assert.doesNotMatch(src, /closePaper\(\)/, '닫는 곳은 모두 닫는 법을 넘긴다');
    assert.match(src, /e\.key === 'Escape'\) \{ e\.preventDefault\(\); this\.closePaper\('esc'\); \}/);
    assert.match(src, /class="pp-done" onclick="app\.closePaper\('done'\)"/);
    assert.match(src, /class="pc-x" onclick="app\.closePaper\('x'\)"/);
    assert.deepEqual(Object.keys(PAPER_CLOSE_ACTION).sort(), ['done', 'esc', 'x']);
});

// ── 새 낱말은 DB(091)가 아직 모른다 — 거절돼도 나머지 기록은 계속 ───────────
test('새 낱말이 거절되면 새 낱말만 끈다 · 기존 낱말이 거절되면(기간 끝·권한) 전부 끈다', async () => {
    const got = [];
    const db091 = r => { got.push(r.action); return UI_ACTIONS_NEXT.has(r.action) ? { error: { code: '23514', message: 'new row for relation "ui_events" violates check constraint "ui_events_action_check"' } } : { error: null }; };
    let t = 0;
    const track = makeTracker({ send: db091, now: () => (t += 2000) });
    assert.equal(track('items', 'item_open'), true); await flush(); await flush();
    assert.equal(track('items', 'item_memo'), false, '새 낱말은 그 뒤로 안 보냄');
    assert.equal(track('cs', 'cs_status'), true, '기존 기록은 그대로');
    await flush();
    assert.deepEqual(got, ['item_open', 'cs_status']);
    const off = makeTracker({ send: () => ({ error: { message: 'rls' } }), now: () => (t += 2000) });
    off('cs', 'open'); await flush(); await flush();
    assert.equal(off('items', 'item_open'), false); assert.equal(off('cs', 'cs_status'), false);
    //  기존 고정 표는 그대로 기존 낱말
    for (const v of [...Object.values(ORDER_FILTER_ACTION), ...Object.values(INV_TAB_ACTION)]) assert.ok(!UI_ACTIONS_NEXT.has(v), v);
});

// ── 계측 6: task_clicks 연결 — 판매 창 → CS 탭 → 상태 바꾸기가 091 뷰에 잡히는가 ─────
const P = process.env.PGLITE_PATH;
test('task_clicks(091 뷰): 탭 전환 open 이 있어야 CS 상태·재고 저장이 한 일로 잡힌다', { skip: !P && 'PGLITE_PATH 없음 — 건너뜀' }, async () => {
    //  화면 흐름을 가짜 앱으로 돌려 실제로 나가는 기록을 받는다
    const app = mkApp();
    const ev = { target: { closest: () => null } };
    app.macOpen('orders', { app: 1 }); app.tick();
    const w = app.wins[0];
    app.switchAppTab(w.id, 'cs'); app.tick();
    app.rowPick(ev, 'c1', 'cs'); app.tick();
    app.track('cs', 'cs_status'); app.tick();          // setCSStatus 가 남기는 것(ui-track 테스트가 부착을 본다)
    app.switchAppTab(w.id, 'inventory'); app.tick();
    app.track('inventory', 'inv_save'); app.tick();
    app.macClose = grab('macClose'); app.macClose(w.id);
    const rows = (await flush(), app.rows);
    assert.deepEqual(rows.map(r => `${r.screen}:${r.action}`),
        ['orders:open', 'cs:open', 'cs:cs_select', 'cs:cs_status', 'inventory:open', 'inventory:inv_save', 'inventory:close']);

    delete globalThis.window; delete globalThis.document;   // 가짜 브라우저가 있으면 PGlite 가 브라우저로 알고 location 을 찾는다
    const { PGlite } = await import(pathToFileURL(P).href);
    const db = new PGlite();
    await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
        create schema auth;
        create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
        create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
        create table public.companies (username text primary key, role text);`);
    await db.exec(fs.readFileSync(new URL('../supabase/migrations/091_ui_events.sql', import.meta.url), 'utf8'));
    const U = '00000000-0000-0000-0000-00000000000c';
    const load = async list => {
        await db.exec('delete from ui_events');
        for (const [i, r] of list.entries())
            await db.query(`insert into ui_events (user_id, screen, action, at) values ($1, $2, $3, now() - interval '1 hour' + $4 * interval '5 seconds')`, [U, r.screen, r.action, i]);
        return (await db.query(`select screen, task, done::int n, avg_clicks::float a from ui_m_task_clicks order by screen`)).rows.map(r => [r.screen, r.task, r.n, r.a]);
    };
    assert.deepEqual(await load(rows), [['cs', 'cs_status', 1, 2], ['inventory', 'inv_save', 1, 1]], 'cs: 줄 고르기 1 + 상태 1 = 2 · 재고: 저장 1');
    //  보완 전(탭 전환 open 없음) — 같은 흐름이 한 일로 하나도 안 잡혔다(10-29 집계 task_clicks 에 cs_status 가 없던 까닭)
    assert.deepEqual(await load(rows.filter(r => !(r.action === 'open' && r.screen !== 'orders'))), []);
    await db.close();
});
