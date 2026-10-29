//  사용 기록(ui_events) — 기록 함수(uiTrack.js) · main.js 부착 · 091 RLS
//  RLS 는 진짜 Postgres(PGlite) 로 본다. 돌리려면 PGLITE_PATH=<@electric-sql/pglite>/dist/index.js — 없으면 그 부분만 건너뛴다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { makeTracker, trackAllowed, usageNotice, UI_ID, UI_ACTIONS, UI_ACTIONS_091, UI_ACTIONS_NEXT, ORDER_FILTER_ACTION, INV_TAB_ACTION, PAPER_CLOSE_ACTION } from '../uiTrack.js';

const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const flush = () => new Promise(r => setTimeout(r, 5));

test('같은 화면·동작은 1초 안에 한 번만, 1초 지나면 다시', async () => {
    let t = 0; const sent = [];
    const track = makeTracker({ send: r => { sent.push(r); }, now: () => t });
    assert.equal(track('home', 'open'), true);
    assert.equal(track('home', 'open'), false);
    t = 999; assert.equal(track('home', 'open'), false);
    assert.equal(track('home', 'refresh'), true, '다른 동작은 따로 센다');
    assert.equal(track('orders', 'open'), true, '다른 화면도 따로');
    t = 1000; assert.equal(track('home', 'open'), true);
    await flush();
    assert.deepEqual(sent, [{ screen: 'home', action: 'open' }, { screen: 'home', action: 'refresh' }, { screen: 'orders', action: 'open' }, { screen: 'home', action: 'open' }]);
});

test('비동기로 보낸다 — track 이 돌아온 뒤에야 send 가 불린다', async () => {
    const sent = [];
    const track = makeTracker({ send: r => sent.push(r) });
    track('news', 'paper');
    assert.equal(sent.length, 0);
    await flush();
    assert.equal(sent.length, 1);
});

test('보내다 실패해도(예외·거절·enabled 예외) 화면 쪽으로 튀지 않는다', async () => {
    const boom = makeTracker({ send: () => { throw new Error('네트워크'); } });
    const rej = makeTracker({ send: () => Promise.reject(new Error('RLS')) });
    const bad = makeTracker({ send: () => {}, enabled: () => { throw new Error('x'); } });
    assert.doesNotThrow(() => boom('home', 'open'));
    assert.doesNotThrow(() => rej('home', 'open'));
    assert.equal(bad('home', 'open'), false);
    let unhandled = 0; const h = () => unhandled++;
    process.on('unhandledRejection', h);
    await flush(); await flush();
    process.off('unhandledRejection', h);
    assert.equal(unhandled, 0);
});

test('id 형식만 받는다 — 입력 내용·고객정보·한글·긴 글은 버린다', async () => {
    const sent = [];
    const track = makeTracker({ send: r => sent.push(r) });
    for (const [s, a] of [['home', '홍길동 010-1234-5678'], ['검색', 'open'], ['orders', 'search:나이키'], ['orders', 'a b'],
        ['x'.repeat(61), 'open'], ['', 'open'], [null, 'open'], ['home', undefined], ['<img>', 'open'], ['home', "o'pen"]]) {
        assert.equal(track(s, a), false, `${s}/${a}`);
    }
    await flush();
    assert.equal(sent.length, 0);
    assert.ok(UI_ID.test('sample_maker') && UI_ID.test('paper_auto'));
});

test('동작은 고정 목록만 — 형식이 맞아도 목록 밖이면 버린다, 칸 이름은 표로만 바꾼다', async () => {
    const sent = [];
    const track = makeTracker({ send: r => sent.push(r) });
    for (const a of ['tab_brands', 'filter_x', 'open_123', 'search', 'ship_issue_2']) assert.equal(track('orders', a), false, a);
    assert.equal(track('orders', ORDER_FILTER_ACTION['<script>']), false, '표에 없는 칸 → undefined → 안 보냄');
    assert.equal(track('inventory', INV_TAB_ACTION.__proto__), false);
    assert.equal(track('orders', ORDER_FILTER_ACTION.claim), true);
    await flush();
    assert.deepEqual(sent, [{ screen: 'orders', action: 'filter_claim' }]);
    for (const v of [...Object.values(ORDER_FILTER_ACTION), ...Object.values(INV_TAB_ACTION), ...Object.values(PAPER_CLOSE_ACTION)]) assert.ok(UI_ACTIONS.has(v), v);
});

test('수집 기간 확인 전에는 들고 있다가 — 기간 안이면 보내고, 끝났으면 버리고 그 뒤로 끈다', async () => {
    let ok; const sent = [];
    const track = makeTracker({ send: r => sent.push(r), ready: new Promise(r => { ok = r; }) });
    assert.equal(track('home', 'open'), true);
    for (let i = 0; i < 30; i++) track('s' + i, 'open');
    await flush(); assert.equal(sent.length, 0, '확인 전엔 안 보냄');
    ok(true); await flush(); await flush();
    assert.equal(sent.length, 20, '들고 있는 건 20개까지');
    const sent2 = [];
    const t2 = makeTracker({ send: r => sent2.push(r), ready: Promise.resolve(false) });
    t2('home', 'open'); await flush(); await flush();
    assert.equal(t2('orders', 'open'), false); await flush();
    assert.equal(sent2.length, 0, '기간 끝 → 하나도 안 보냄');
    const t3 = makeTracker({ send: () => {}, ready: Promise.reject(new Error('rpc')) });
    await flush(); assert.equal(t3('home', 'open'), false, '기간 확인 실패도 끔');
});

test('보냈는데 DB 가 거절하면(기간 끝·권한) 그 뒤로 조용히 멈춘다', async () => {
    let n = 0;
    const track = makeTracker({ send: () => { n++; return { error: { message: 'new row violates row-level security' } }; } });
    track('home', 'open'); await flush(); await flush();
    assert.equal(track('orders', 'open'), false);
    await flush(); assert.equal(n, 1);
});

test('직원 안내 문구 — 무엇·왜·언제까지·누가 봄·안 모으는 것·지움', () => {
    const t = usageNotice('2026-11-03T09:00:00+09:00');
    for (const w of ['11월 3일까지', '1주', '화면·버튼', '편하게', '입력한 내용', '고객정보', '검색어', '대표만', '지우고', '익명']) assert.ok(t.includes(w), w);
    assert.ok(!usageNotice('x').includes('NaN'));
});

test('enabled 가 false 면 아무것도 안 보낸다', async () => {
    const sent = [];
    makeTracker({ send: r => sent.push(r), enabled: () => false })('home', 'open');
    await flush();
    assert.equal(sent.length, 0);
});

test('미리보기·검수·dev 서버·고객사·로그아웃은 기록 대상이 아니다', () => {
    const staff = { id: '3f0c…', role: 'STAFF' };
    assert.equal(trackAllowed(staff), true);
    assert.equal(trackAllowed({ id: 'u', role: 'MASTER' }), true);
    assert.equal(trackAllowed(staff, { dev: true }), false, '로컬 dev 서버');
    assert.equal(trackAllowed(staff, { search: '?dev-preview=news' }), false);
    assert.equal(trackAllowed(staff, { search: '?a=1&dev-preview=crm' }), false);
    for (const id of ['dev', 'preview', 'preview-user']) assert.equal(trackAllowed({ id, role: 'MASTER' }), false, id);
    assert.equal(trackAllowed({ id: 'c', role: 'CLIENT' }), false);
    assert.equal(trackAllowed(null), false);
});

test('main.js 부착: 업무 흐름(주문·CS·재고·할 일·캘린더)까지, 고정 동작만, 검수 모드는 끈다', () => {
    const m = read('main.js');
    assert.match(m, /import \{ makeTracker, trackAllowed, usageNotice, ORDER_FILTER_ACTION, INV_TAB_ACTION, PAPER_CLOSE_ACTION, paperSeenAction \} from '\.\/uiTrack\.js'/);
    assert.match(m, /if \(devPreview\) this\._noTrack = true/);
    assert.match(m, /send: row => this\.supabase\.from\('ui_events'\)\.insert\(row\)/);
    assert.match(m, /this\.supabase\.rpc\('ui_events_until'\)/);
    assert.match(m, /txt\.textContent = usageNotice\(until\)/, '안내는 textContent 로(HTML 아님)');
    const calls = [...m.matchAll(/this\.track\?\.\(([^;]*?)\);/g)].map(x => x[1]);   // ?. — 다른 테스트처럼 메서드만 떼어 돌려도 안 깨지게
    //  view, 'open' 은 둘 — 새 창(macOpen) · 창 안 화면 바꾸기(_winView: 판매·생산 탭 · 주문→CS · 시즌→제품)
    const need = ["view, 'open'", "view, 'open'", "found.view, 'open'", "viewId, 'open'", "'home', 'open'", "cw.view, 'close'", "this.currentView || 'home', 'refresh'",
        "'news', auto ? 'paper_auto' : 'paper'", "'news', 'brand_open'", "'news', PAPER_CLOSE_ACTION[how]", "'news', paperSeenAction(P.seen || 1, P.n)",
        "'cs', 'open'", "'items', 'item_select'", "'items', dbl ? 'item_open_dbl' : 'item_open'", "'items', 'item_memo'", "'items', 'item_note'",
        "'orders', ORDER_FILTER_ACTION[t.dataset.f]", "'orders', 'order_sync'", "'orders', 'invoice_export'", "'orders', 'ship_issue'", "'orders', 'invoice_upload'",
        "'orders', 'cs_create_order'", "'cs', 'cs_create'", "'cs', 'cs_status'", "'cs', 'cs_filter'", "'cs', 'cs_select'", "'cs', 'cs_memo'",
        "'inventory', INV_TAB_ACTION[tab]", "'inventory', 'inv_save'",
        "'reminders', 'todo_add'", "'reminders', done ? 'todo_done' : 'todo_undo'", "'calendar', 'cal_add'"];
    for (const c of new Set(need)) assert.equal(calls.filter(x => x === c).length, need.filter(x => x === c).length, c);
    assert.equal(calls.length, need.length, '목록에 없는 부착이 생기면 여기 먼저 적는다');
    //  두 번째 인자는 따옴표 고정 낱말(목록 안) · 고정 표 조회 · 삼항의 고정 낱말뿐 — 이어 붙이기·템플릿 금지
    for (const c of calls) {
        const act = c.slice(c.indexOf(',') + 1).trim();
        assert.doesNotMatch(act, /\+|`/, c);
        for (const w of act.match(/'([^']*)'/g) || []) assert.ok(UI_ACTIONS.has(w.slice(1, -1)), `${c} → ${w}`);
        if (!/'/.test(act)) assert.match(act, /^(ORDER_FILTER_ACTION|INV_TAB_ACTION|PAPER_CLOSE_ACTION)\[|^paperSeenAction\(P\.seen \|\| 1, P\.n\)$/, c);
        assert.doesNotMatch(c, /value|input|name|phone|query|search|\.text|orderNo|\bid\b/i, c);
    }
    //  CS 메모는 저장 성공 뒤에만, 할 일 완료도 저장 성공 뒤에만
    assert.match(m, /if \(error\) \{ t\.memo = old;[^\n]*return; \}\n\s*this\.track\?\.\('cs', 'cs_memo'\);/);
    assert.match(m, /if \(error\) throw error;\n\s*this\.track\?\.\('reminders', done \? 'todo_done' : 'todo_undo'\);/);
});

test('091: 형식/고정목록 CHECK · 서버값만 · 기간 강제 · 관리자만 · 지표 뷰 5개 · 확정/폐기 · 롤백', () => {
    const sql = read('supabase/migrations/091_ui_events.sql'), down = read('supabase/rollbacks/091_ui_events.down.sql');
    assert.match(sql, /screen\s+text not null check \(screen ~ '\^\[a-z0-9_\.:-\]\{1,60\}\$'\)/);
    const list = sql.match(/ui_events_action_check check \(action in \(([^)]*)\)\)/)[1].match(/'([^']+)'/g).map(x => x.slice(1, -1));
    assert.deepEqual([...list].sort(), [...UI_ACTIONS_091].sort(), 'DB 동작 목록 = 앱 UI_ACTIONS_091');
    //  새 낱말(UI_ACTIONS_NEXT)은 091 에 없다 — 다음 수집 마이그레이션이 CHECK 에 더할 몫. 겹치지 않고, 합치면 앱 사전 전체.
    for (const a of UI_ACTIONS_NEXT) assert.ok(!list.includes(a), a);
    assert.deepEqual([...UI_ACTIONS].sort(), [...list, ...UI_ACTIONS_NEXT].sort());
    assert.match(sql, /grant select, insert \(screen, action\) on public\.ui_events to authenticated/);
    assert.match(sql, /with check \(public\.is_staff\(\) and user_id = auth\.uid\(\) and now\(\) < public\.ui_events_until\(\)\)/);
    assert.match(sql, /using \(public\.is_master\(\) and now\(\) < public\.ui_events_until\(\) \+ interval '14 days'\)/);
    assert.match(sql, /values \(now\(\) \+ interval '7 days'\) on conflict \(id\) do nothing/);
    assert.doesNotMatch(sql, /create policy[^;]*for (update|delete|all)/, "고치기·지우기 정책 없음");
    for (const v of ['ui_m_first_screen', 'ui_m_open_top', 'ui_m_task_clicks', 'ui_m_quick_close', 'ui_m_unused'])
        assert.match(sql, new RegExp(`create or replace view public\\.${v} with \\(security_invoker = true\\)`), v);
    assert.match(sql, /function public\.ui_events_finalize\(\)[\s\S]*not public\.is_master\(\)[\s\S]*where id for update;[\s\S]*finalized_at is not null then return 0[\s\S]*now\(\) < cfg\.ends_at[\s\S]*delete from ui_events[\s\S]*set finalized_at = now\(\)/);
    for (const x of ['ui_events_finalize()', 'ui_m_first_screen', 'ui_usage_summary', 'public.ui_events;', 'ui_events_until()', 'ui_events_config'])
        assert.ok(down.includes(x), x);
    assert.doesNotMatch(down, /drop function[^;]*(is_staff|is_master)/, 'is_staff·is_master 는 다른 마이그레이션 소유');
});

const P = process.env.PGLITE_PATH;
const STUB = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub', '')::uuid $$;
grant usage on schema auth, public to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
create table public.companies (username text primary key, role text);
insert into public.companies values ('boss', 'MASTER'), ('kim', 'STAFF'), ('client1', 'CLIENT');
`;
const UID = { boss: '00000000-0000-0000-0000-00000000000b', kim: '00000000-0000-0000-0000-00000000000c', client1: '00000000-0000-0000-0000-00000000000d' };

test('091 RLS(PGlite)', { skip: !P && 'PGLITE_PATH 없음 — 건너뜀' }, async t => {
    const { PGlite } = await import(pathToFileURL(P).href);
    const db = new PGlite();
    await db.exec(STUB); await db.exec(read('supabase/migrations/091_ui_events.sql')); await db.exec(read('supabase/migrations/091_ui_events.sql'));
    const as = async (who, sql, params = []) => {
        const claims = who ? JSON.stringify({ email: `${who}@bhas.com`, sub: UID[who] }) : '';
        await db.exec(`reset role; select set_config('request.jwt.claims', '${claims}', false); set role ${who ? 'authenticated' : 'anon'};`);
        try { return (await db.query(sql, params)).rows; } finally { await db.exec('reset role'); }
    };
    const denied = p => assert.rejects(p, /row-level security|permission denied|check constraint/);

    await t.test('직원은 자기 것만 쓴다, 남의 id·과거 시각·자유 글자는 못 넣는다', async () => {
        await as('kim', `insert into ui_events (screen, action) values ('orders', 'open')`);
        await as('boss', `insert into ui_events (screen, action) values ('home', 'refresh')`);
        await denied(as('kim', `insert into ui_events (screen, action, user_id) values ('home', 'open', '${UID.boss}')`));
        await denied(as('kim', `insert into ui_events (screen, action, at) values ('home', 'open', '2020-01-01')`));
        await denied(as('kim', `insert into ui_events (screen, action) values ('home', '홍길동 010')`));
        await denied(as('client1', `insert into ui_events (screen, action) values ('home', 'open')`));
        await denied(as(null, `insert into ui_events (screen, action) values ('home', 'open')`));
    });
    await t.test('읽기는 관리자만, 고치기·지우기는 아무도', async () => {
        assert.equal((await as('kim', `select * from ui_events`)).length, 0, '직원은 자기 것도 못 읽음');
        const all = await as('boss', `select user_id, screen from ui_events order by id`);
        assert.deepEqual(all.map(r => [r.user_id, r.screen]), [[UID.kim, 'orders'], [UID.boss, 'home']]);
        await denied(as('boss', `update ui_events set screen = 'x'`));
        await denied(as('boss', `delete from ui_events`));
        await denied(as(null, `select * from ui_events`));
    });
    const su = sql => db.exec(`reset role; ${sql}`);   // 관리 권한(SQL 편집기) 흉내
    const q1 = async sql => (await db.query(sql)).rows;
    await t.test('목록 밖 동작은 DB 도 거절한다', async () => {
        await denied(as('kim', `insert into ui_events (screen, action) values ('news', 'tab_brands')`));
        await denied(as('kim', `insert into ui_events (screen, action) values ('orders', 'filter_x')`));
        for (const a of UI_ACTIONS_NEXT) await denied(as('kim', `insert into ui_events (screen, action) values ('items', '${a}')`));   // 새 낱말은 다음 마이그레이션 전까지 DB 가 거절
    });
    await t.test('기간: 다시 깔아도 안 늘고, 끝나면 쓰기 거절, 끝난 뒤 14일이 지나면 관리자도 원자료를 못 본다', async () => {
        const before = (await q1(`select ends_at from ui_events_config`))[0].ends_at;
        assert.ok(new Date(before) - Date.now() > 6.9 * 864e5, '깔린 때부터 7일');
        await db.exec(read('supabase/migrations/091_ui_events.sql'));
        assert.deepEqual((await q1(`select ends_at from ui_events_config`))[0].ends_at, before, '다시 깔아도 그대로');
        assert.ok(new Date((await as('kim', `select public.ui_events_until() u`))[0].u).getTime() === new Date(before).getTime(), '직원도 기간은 본다');
        await denied(as('kim', `select * from ui_events_config`));
        await denied(as('kim', `update ui_events_config set ends_at = now() + interval '1 year'`));
        await su(`update ui_events_config set ends_at = now() - interval '1 second'`);
        await denied(as('kim', `insert into ui_events (screen, action) values ('orders', 'open')`));
        await denied(as('boss', `insert into ui_events (screen, action) values ('orders', 'open')`));
        assert.equal((await as('boss', `select * from ui_events`)).length, 2, '종료 직후엔 관리자가 읽을 수 있다');
        await su(`update ui_events_config set ends_at = now() - interval '15 days'`);
        assert.equal((await as('boss', `select * from ui_events`)).length, 0, '14일 지나면 관리자도 못 봄');
        await su(`update ui_events_config set ends_at = now() + interval '7 days'`);
    });
    await t.test('지표 5개 — 심어 둔 하루치로 값이 맞는지', async () => {
        const K = UID.kim, B = UID.boss;
        await su(`delete from ui_events; insert into ui_events (user_id, screen, action, at) values
            ('${K}', 'orders', 'open', '2026-10-20 09:00:00+09'), ('${K}', 'orders', 'filter_target', '2026-10-20 09:00:05+09'),
            ('${K}', 'orders', 'filter_shipping', '2026-10-20 09:00:10+09'), ('${K}', 'orders', 'ship_issue', '2026-10-20 09:00:20+09'),
            ('${K}', 'orders', 'close', '2026-10-20 09:00:30+09'), ('${K}', 'cs', 'open', '2026-10-20 09:01:00+09'),
            ('${K}', 'cs', 'close', '2026-10-20 09:01:03+09'),
            ('${B}', 'home', 'open', '2026-10-20 08:30:00+09'), ('${B}', 'reminders', 'open', '2026-10-20 08:31:00+09'),
            ('${B}', 'reminders', 'todo_add', '2026-10-20 08:31:10+09'), ('${B}', 'reminders', 'todo_done', '2026-10-20 08:31:20+09'),
            ('${K}', 'reminders', 'open', '2026-10-21 00:10:00+09'), ('${K}', 'orders', 'ship_issue', '2026-10-21 03:00:00+09')`);
        const first = await as('boss', `select day::text d, user_id u, screen from ui_m_first_screen order by d, screen`);
        assert.deepEqual(first.map(r => [r.d, r.u, r.screen]), [['2026-10-20', B, 'home'], ['2026-10-20', K, 'orders'], ['2026-10-21', K, 'reminders']], '한국 시각 하루 기준(00:10 은 다음 날)');
        const top = await as('boss', `select screen, opens::int o, users::int u from ui_m_open_top order by opens desc, screen`);
        assert.deepEqual(top.map(r => [r.screen, r.o, r.u]), [['reminders', 2, 2], ['cs', 1, 1], ['home', 1, 1], ['orders', 1, 1]]);
        const tc = await as('boss', `select screen, task, done::int n, avg_clicks::float a, p50_clicks::int p from ui_m_task_clicks order by screen`);
        assert.deepEqual(tc.map(r => [r.screen, r.task, r.n, r.a, r.p]), [['orders', 'ship_issue', 1, 3, 3], ['reminders', 'todo_done', 1, 2, 2]],
            '열기 뒤 필터 2 + 출고 1 = 3 / 추가 1 + 완료 1 = 2 · 30분 넘게 열기 없이 한 출고는 빼기');
        const qc = await as('boss', `select screen, opens::int o, quick_closes::int q from ui_m_quick_close order by screen`);
        assert.deepEqual(qc.map(r => [r.screen, r.o, r.q]), [['cs', 1, 1], ['home', 1, 0], ['orders', 1, 0], ['reminders', 2, 0]], 'cs 3초 = 바로 닫음, 주문 30초 = 아님');
        const un = (await as('boss', `select screen from ui_m_unused`)).map(r => r.screen);
        assert.ok(un.includes('inventory') && un.includes('settings') && !un.includes('orders') && !un.includes('reminders'), un.join());
        for (const v of ['ui_m_first_screen', 'ui_m_open_top', 'ui_m_task_clicks', 'ui_m_quick_close'])
            assert.equal((await as('kim', `select * from ${v}`)).length, 0, `직원은 ${v} 못 봄`);
        await denied(as(null, `select * from ui_m_open_top`));
    });
    await t.test('확정: 관리자만 · 수집 끝난 뒤에만 · 익명 합계 남기고 원자료 삭제', async () => {
        await assert.rejects(as('kim', `select public.ui_events_finalize()`), /관리자만/);
        await assert.rejects(as('boss', `select public.ui_events_finalize()`), /아직 수집 중/);
        await denied(as(null, `select public.ui_events_finalize()`));
        assert.equal((await q1(`select count(*)::int n from ui_events`))[0].n, 13, '거절된 확정은 아무것도 안 지움');
        await su(`update ui_events_config set ends_at = now() - interval '1 second'`);
        assert.equal(Number((await as('boss', `select public.ui_events_finalize() n`))[0].n), 13);
        await su('select 1');
        assert.equal((await q1(`select count(*)::int n from ui_events`))[0].n, 0, '원자료는 지워짐');
        const cols = (await q1(`select column_name c from information_schema.columns where table_name = 'ui_usage_summary'`)).map(r => r.c);
        assert.ok(!cols.includes('user_id'), '합계에는 사람 칸이 없다');
        const sum = await as('boss', `select metric, screen, action, n::int n, value::float v from ui_usage_summary order by metric, screen, action`);
        const pick = (m, sc, ac) => sum.find(r => r.metric === m && r.screen === sc && (ac === undefined || r.action === ac));
        assert.equal(pick('open_top', 'reminders').n, 2);
        assert.equal(pick('task_clicks', 'orders', 'ship_issue').v, 3);
        assert.equal(pick('quick_close', 'cs').v, 1);
        assert.equal(pick('first_screen', 'orders').n, 1);
        assert.ok(pick('unused', 'inventory'));
        assert.equal(pick('daily', 'orders', 'ship_issue').n, 1, '하루·화면·동작별 횟수(10-20 하루치)');
        assert.equal((await as('kim', `select * from ui_usage_summary`)).length, 0, '직원은 합계도 못 봄');
        await denied(as('boss', `delete from ui_usage_summary`));
    });
    await t.test('확정은 한 번만 — 다시 불러도 합계 줄 수·값이 그대로, 기간을 늘려도 다시 안 열림', async () => {
        const snap = async () => JSON.stringify(await q1(`select metric, day, screen, action, n, value from ui_usage_summary order by id`));
        await su('select 1');
        const before = await snap(), rows = (await q1(`select count(*)::int n from ui_usage_summary`))[0].n;
        assert.ok(rows > 0 && (await q1(`select finalized_at from ui_events_config`))[0].finalized_at, '확정 표시가 찍혔다');
        for (let i = 0; i < 2; i++) assert.equal(Number((await as('boss', `select public.ui_events_finalize() n`))[0].n), 0, `재호출 ${i + 1}`);
        await su('select 1');
        assert.equal(await snap(), before, '합계가 한 줄도 안 바뀜');
        await su(`update ui_events_config set ends_at = now() + interval '7 days'`);   // 실수로 기간을 늘려도
        await denied(as('kim', `insert into ui_events (screen, action) values ('orders', 'open')`));
        assert.equal(Number((await as('boss', `select public.ui_events_finalize() n`))[0].n), 0);
        await su('select 1');
        assert.equal(await snap(), before);
    });
    await t.test('되돌리기 후 함수는 남고 다시 깔 수 있다', async () => {
        await db.exec(read('supabase/rollbacks/091_ui_events.down.sql'));
        const r = (await db.query(`select to_regclass('public.ui_events') t, to_regprocedure('public.is_master()') m`)).rows[0];
        assert.equal(r.t, null); assert.ok(r.m);
        await db.exec(read('supabase/migrations/091_ui_events.sql'));
    });
    await db.close();
});
