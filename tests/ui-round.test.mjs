//  102 사용 기록 회차 — 1차(091) 확정 뒤 2차를 관리자가 명시적으로 여는 흐름 + 새 낱말 거절 처리(트래커 오류 분류)
//  DB 흐름은 진짜 Postgres(PGlite)로 본다. 돌리려면 PGLITE_PATH=<@electric-sql/pglite>/dist/index.js — 없으면 그 부분만 건너뜀.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { makeTracker, actionCheckMissing, UI_ACTIONS, UI_ACTIONS_091, UI_ACTIONS_NEXT } from '../uiTrack.js';

const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const M102 = read('supabase/migrations/102_ui_events_round.sql');
const D102 = read('supabase/rollbacks/102_ui_events_round.down.sql');
const flush = () => new Promise(r => setTimeout(r, 5));
const checkList = sql => {
    const m = sql.match(/add constraint ui_events_action_check check \(action in \(([\s\S]*?)\)\);/);
    assert.ok(m, 'CHECK 없음');
    return [...m[1].matchAll(/'([a-z0-9_]+)'/g)].map(x => x[1]);
};

// ── 트래커: 새 낱말만 끄는 것은 '동작 목록 CHECK' 일 때뿐 ─────────────────────
const CHECK_ERR = { code: '23514', message: 'new row for relation "ui_events" violates check constraint "ui_events_action_check"' };
test('actionCheckMissing — 23514 + ui_events_action_check 만', () => {
    assert.equal(actionCheckMissing(CHECK_ERR), true);
    assert.equal(actionCheckMissing({ code: '23514', message: 'x', details: 'Failing row … ui_events_action_check' }), true);
    for (const e of [null, undefined, {}, { message: CHECK_ERR.message },                        // 코드 없음
        { code: '23514', message: 'violates check constraint "ui_events_screen_check"' },          // 다른 CHECK
        { code: '42501', message: 'new row violates row-level security policy for table "ui_events"' },
        { code: '', message: 'TypeError: Failed to fetch' }, { code: 'PGRST301', message: 'JWT expired' },
        { code: '23514x', message: CHECK_ERR.message }])
        assert.equal(actionCheckMissing(e), false, JSON.stringify(e));
});

test('새 낱말 거절 오류별: 동작 CHECK → 새 낱말만 끔 · RLS/기간·네트워크 오류 응답·다른 CHECK → 전부 끔 · 요청 실패(reject) → 그대로', async () => {
    let t = 0;
    const run = async err => {
        const sent = [];
        const track = makeTracker({ now: () => (t += 2000), send: r => { sent.push(r.action); if (r.action === 'item_open') return typeof err === 'function' ? err() : { error: err }; return { error: null }; } });
        track('items', 'item_open'); await flush(); await flush();
        const next = track('items', 'item_memo'), base = track('cs', 'cs_status');
        await flush();
        return { next, base, sent };
    };
    assert.deepEqual(await run(CHECK_ERR), { next: false, base: true, sent: ['item_open', 'cs_status'] }, '102 안 깔림 — 기존 기록은 계속');
    for (const e of [{ code: '42501', message: 'new row violates row-level security policy' },   // 기간 끝·직원 아님(RLS)
        { code: '', message: 'TypeError: Failed to fetch' },                                       // supabase-js 네트워크 오류(응답으로 옴)
        { code: '23514', message: 'violates check constraint "ui_events_screen_check"' },
        { message: 'unknown' }])
        assert.deepEqual(await run(e), { next: false, base: false, sent: ['item_open'] }, JSON.stringify(e));
    assert.deepEqual(await run(() => Promise.reject(new Error('offline'))), { next: true, base: true, sent: ['item_open', 'item_memo', 'cs_status'] }, 'reject 는 기존처럼 무시(화면 영향 없음)');
    assert.deepEqual(await run(() => { throw new Error('sync'); }), { next: true, base: true, sent: ['item_open', 'item_memo', 'cs_status'] });
    //  기존 낱말이 동작 CHECK 로 거절되는 일은 없어야 하지만, 나면 안전하게 전부 끔
    const sent = [];
    const track = makeTracker({ now: () => (t += 2000), send: r => { sent.push(r.action); return { error: CHECK_ERR }; } });
    track('cs', 'cs_status'); await flush(); await flush();
    assert.equal(track('items', 'item_open'), false);
    assert.equal(track('cs', 'open'), false);
});

// ── 102 파일 모양 ──────────────────────────────────────────────────
test('102 CHECK = 앱 UI_ACTIONS 전체 · 되돌리기 CHECK = 091 그대로 · 091 재실행·자동 재개 없음', () => {
    assert.deepEqual(checkList(M102).sort(), [...UI_ACTIONS].sort());
    assert.deepEqual(checkList(D102).sort(), [...UI_ACTIONS_091].sort());
    assert.deepEqual(checkList(read('supabase/migrations/091_ui_events.sql')).sort(), [...UI_ACTIONS_091].sort(), '091 은 안 고침');
    const body = M102.replace(/^\s*--.*$/gm, '');
    assert.equal((body.match(/finalized_at = null/g) || []).length, 1, '확정 표시를 지우는 곳은 start_round 하나');
    assert.doesNotMatch(body, /insert into public\.ui_events_config/, 'config 를 새로 넣지 않는다');
    assert.doesNotMatch(body, /delete from (public\.)?ui_usage_summary|truncate/i, '1차 합계를 안 지운다');
    assert.doesNotMatch(D102, /drop table|delete from (public\.)?ui_usage_summary/i, '되돌려도 합계는 남긴다');
    for (const f of ['ui_events_finalize()', 'ui_events_start_round(int)']) {
        assert.match(body, new RegExp(`revoke all on function public\\.${f.replace(/[()]/g, '\\$&')} from public, anon;`));
    }
});

// ── 진짜 Postgres: 091 → 1차 확정 → 102 → 명시 시작 → 2차 → 확정 → 되돌리기 ──────────
const P = process.env.PGLITE_PATH;
const STUB = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub', '')::uuid $$;
grant usage on schema auth, public to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
create table public.companies (username text primary key, role text);
insert into public.companies values ('boss', 'MASTER'), ('kim', 'STAFF'), ('lee', 'STAFF'), ('client1', 'CLIENT');
`;
const UID = { boss: '00000000-0000-0000-0000-00000000000b', kim: '00000000-0000-0000-0000-00000000000c', lee: '00000000-0000-0000-0000-00000000000e', client1: '00000000-0000-0000-0000-00000000000d' };

test('091 → finalize → 102 → 명시 start(2) → 2차 수집 → finalize → down (PGlite)', { skip: !P && 'PGLITE_PATH 없음 — 건너뜀' }, async t => {
    const { PGlite } = await import(pathToFileURL(P).href);
    const db = new PGlite();
    const as = async (who, sql, params = []) => {
        const claims = who ? JSON.stringify({ email: `${who}@bhas.com`, sub: UID[who] }) : '';
        await db.exec(`reset role; select set_config('request.jwt.claims', '${claims}', false); set role ${who ? 'authenticated' : 'anon'};`);
        try { return (await db.query(sql, params)).rows; } finally { await db.exec('reset role'); }
    };
    const su = sql => db.exec(`reset role; ${sql}`);
    const q = async (sql, p = []) => (await db.query(sql, p)).rows;
    const denied = (p, re = /row-level security|permission denied|check constraint/) => assert.rejects(p, re);
    const put = (who, screen, action) => as(who, `insert into ui_events (screen, action) values ($1, $2)`, [screen, action]);
    //  앱과 같은 모양으로 보낸다(supabase-js: 실패는 { error: { code, message } } 로 온다)
    const sendAs = who => async row => { try { await put(who, row.screen, row.action); return { error: null }; } catch (e) { return { error: { code: e.code, message: e.message } }; } };
    const cfg = async () => { const { id, ...c } = (await q(`select * from ui_events_config`))[0]; return c; };
    const summary = async (round = true) => q(`select ${round ? 'round_no, ' : ''}metric, day, screen, action, n, value from ui_usage_summary order by ${round ? 'round_no, ' : ''}metric, screen, action, day`);
    const strip = rows => rows.map(({ round_no, ...r }) => r);
    await db.exec(STUB);
    await db.exec(read('supabase/migrations/091_ui_events.sql'));

    let round1;
    await t.test('1차(091): 새 낱말은 DB 가 23514 로 거절 → 트래커는 새 낱말만 끄고 기존 기록 계속', async () => {
        let n = 0;
        const track = makeTracker({ send: sendAs('kim'), now: () => (n += 2000) });
        track('items', 'item_open'); await flush(); await flush(); await flush();
        assert.equal(track('items', 'item_memo'), false);
        assert.equal(track('orders', 'open'), true); await flush(); await flush();
        await put('lee', 'cs', 'cs_status');
        assert.deepEqual((await q(`select screen, action from ui_events order by id`)).map(r => r.screen + ':' + r.action), ['orders:open', 'cs:cs_status']);
        await assert.rejects(as('boss', `select public.ui_events_start_round(2)`), /function .*does not exist/, '091 만 깔린 곳엔 시작 함수 없음');
    });
    await t.test('1차 확정 → 기록 닫힘', async () => {
        await su(`update ui_events_config set ends_at = now() - interval '1 second'`);
        assert.equal(Number((await as('boss', `select public.ui_events_finalize() g`))[0].g), 2);
        round1 = await summary(false);
        assert.ok(round1.length > 0);
        await denied(put('kim', 'orders', 'open'));
    });

    await t.test('102 깔기(두 번): 1차 합계 그대로 + round_no=1 · 닫힌 채(자동 재개 없음) · 새 낱말도 기간 밖이면 RLS 거절', async () => {
        const before = await cfg();
        await db.exec(M102); await db.exec(M102);
        const c = await cfg();
        assert.equal(c.round_no, 1);
        assert.deepEqual([c.ends_at, c.finalized_at], [before.ends_at, before.finalized_at], '기간·확정 표시 그대로');
        assert.ok(c.started_at, '1차 시작 = 끝 - 7일');
        assert.deepEqual(strip(await summary()), round1, '1차 합계 그대로');
        assert.ok((await summary()).every(r => r.round_no === 1));
        const until = (await as('kim', `select public.ui_events_until() u`))[0].u;
        assert.ok(new Date(until) < new Date(), '닫힌 채');
        await denied(put('kim', 'items', 'item_open'), /row-level security/);
        let n = 0;
        const track = makeTracker({ send: sendAs('kim'), now: () => (n += 2000) });
        track('items', 'item_open'); await flush(); await flush(); await flush();
        assert.equal(track('cs', 'cs_status'), false, '기간 밖 거절(RLS 42501)은 전부 끔');
    });

    await t.test('시작은 관리자만 · 다음 번호만 · 원자료 남으면 거절', async () => {
        await denied(as('kim', `select public.ui_events_start_round(2)`), /관리자만/);
        await denied(as(null, `select public.ui_events_start_round(2)`), /permission denied/);
        await denied(as('boss', `select public.ui_events_start_round(3)`), /다음 회차는 2/);
        await denied(as('boss', `select public.ui_events_start_round(1)`), /다음 회차는 2/);
        await su(`insert into ui_events (user_id, screen, action) values ('${UID.kim}', 'orders', 'open')`);
        await denied(as('boss', `select public.ui_events_start_round(2)`), /원자료가 남아 있음/);
        await su(`delete from ui_events`);
        assert.equal((await cfg()).round_no, 1, '거절은 아무것도 안 바꿈');
    });

    let c2;
    await t.test('start(2): 7일 열림 · 같은 번호 재호출은 그대로(기간 안 늘어남) · 진행 중엔 3 거절 · 102 다시 깔아도 그대로', async () => {
        assert.equal((await as('boss', `select public.ui_events_start_round(2) r`))[0].r, 2);
        c2 = await cfg();
        assert.equal(c2.round_no, 2); assert.equal(c2.finalized_at, null);
        const days = (new Date(c2.ends_at) - new Date(c2.started_at)) / 864e5;
        assert.ok(Math.abs(days - 7) < 1e-6, '7일');
        await su(`select pg_sleep(0.01)`);
        assert.equal((await as('boss', `select public.ui_events_start_round(2) r`))[0].r, 2);
        assert.deepEqual(await cfg(), c2, '재호출로 기간 안 늘어남');
        await denied(as('boss', `select public.ui_events_start_round(3)`), /2차가 아직 확정 안 됨/);
        await db.exec(M102);
        assert.deepEqual(await cfg(), c2, '102 다시 깔아도 회차·기간 그대로');
        await denied(as('boss', `select public.ui_events_finalize()`), /아직 수집 중/);
    });

    await t.test('2차 수집: 새 낱말 받음 · 권한은 그대로(직원 본인만·고객 거절·관리자만 읽기)', async () => {
        let n = 0;
        const track = makeTracker({ send: sendAs('kim'), now: () => (n += 2000) });
        for (const [s, a] of [['items', 'open'], ['items', 'item_select'], ['items', 'item_open_dbl'], ['items', 'item_memo'], ['news', 'paper_close_x'], ['news', 'paper_seen_2_3']]) assert.equal(track(s, a), true);
        await flush(); await flush(); await flush();
        assert.equal(track('items', 'item_note'), true, '새 낱말 계속 켜짐');
        await flush(); await flush();
        await put('lee', 'items', 'open');
        await denied(put('client1', 'items', 'open'));
        await denied(put('kim', 'items', 'item_open 홍길동'));
        await denied(as('kim', `insert into ui_events (screen, action, user_id) values ('items', 'open', '${UID.lee}')`));
        assert.equal((await as('kim', `select * from ui_events`)).length, 0, '직원은 못 읽음');
        assert.equal((await as('boss', `select * from ui_events`)).length, 8);
        await denied(as('boss', `delete from ui_events`));
        await assert.rejects(db.exec(read('supabase/rollbacks/102_ui_events_round.down.sql')), /확정 전/, '진행 중엔 되돌리기 거절');
        assert.equal((await cfg()).round_no, 2, '거절된 되돌리기는 아무것도 안 바꿈');
    });

    await t.test('2차 확정: 2차 합계는 round_no=2 로 따로 · 1차 합계 그대로 · 재호출 0(멱등)', async () => {
        await su(`update ui_events_config set ends_at = now() - interval '1 second'`);
        await denied(as('boss', `select public.ui_events_start_round(3)`), /2차가 아직 확정 안 됨/);   // 끝났어도 확정 전엔 거절
        assert.equal(Number((await as('boss', `select public.ui_events_finalize() g`))[0].g), 8);
        const all = await summary();
        assert.deepEqual(strip(all.filter(r => r.round_no === 1)), round1, '1차 그대로');
        const r2 = all.filter(r => r.round_no === 2);
        const open2 = r2.filter(r => r.metric === 'open_top').map(r => [r.screen, Number(r.n), Number(r.value)]);
        assert.deepEqual(open2, [['items', 2, 2]], '2차 열기 = items 2번·2명');
        const daily2 = r2.filter(r => r.metric === 'daily').map(r => r.action).sort();
        assert.deepEqual(daily2, ['item_memo', 'item_note', 'item_open_dbl', 'item_select', 'open', 'paper_close_x', 'paper_seen_2_3']);
        assert.ok(!all.some(r => r.round_no === 1 && UI_ACTIONS_NEXT.has(r.action)), '1차엔 새 낱말 없음');
        assert.equal((await q(`select count(*)::int n from ui_events`))[0].n, 0, '원자료 지움');
        const n = all.length;
        assert.equal(Number((await as('boss', `select public.ui_events_finalize() g`))[0].g), 0);
        assert.equal((await summary()).length, n, '다시 불러도 합계 안 늘어남');
        await denied(as('kim', `select public.ui_events_finalize()`), /관리자만/);
        assert.equal((await as('kim', `select * from ui_usage_summary`)).length, 0, '합계도 관리자만');
        await denied(put('kim', 'items', 'open'), /row-level security/);
    });

    await t.test('되돌리기: 시작 함수 걷힘 · CHECK 091 로 · 합계(회차 포함) 남음 · 다시 102 → 회차 이어받기', async () => {
        const before = await summary();
        await db.exec(D102);
        await assert.rejects(as('boss', `select public.ui_events_start_round(3)`), /does not exist/);
        assert.deepEqual(await summary(), before, '합계·회차 그대로');
        assert.ok(!(await q(`select column_name from information_schema.columns where table_name = 'ui_events_config'`)).some(r => ['round_no', 'started_at'].includes(r.column_name)));
        await su(`update ui_events_config set finalized_at = null, ends_at = now() + interval '1 day'`);   // 관리 권한으로 잠깐 열어 CHECK 확인
        await denied(put('kim', 'items', 'item_open'), /ui_events_action_check/);
        await put('kim', 'items', 'open');
        await su(`delete from ui_events; update ui_events_config set finalized_at = now(), ends_at = now() - interval '1 second'`);
        assert.equal(Number((await as('boss', `select public.ui_events_finalize() g`))[0].g), 0, '091 finalize: 확정된 것은 그대로');
        await db.exec(M102);
        assert.equal((await cfg()).round_no, 2, '합계의 가장 큰 회차(2)를 이어받음 — 다음은 3');
        await denied(as('boss', `select public.ui_events_start_round(2)`), /다음 회차는 3/);
    });
    await db.close();
});
