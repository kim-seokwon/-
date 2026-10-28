//  099 파트너(CLIENT) 계정 막기 — 운영 정책·함수 스냅숏(fixtures/rls-snapshot-1028.sql) 위에 099 를 깔고
//  진짜 Postgres(PGlite)에서 사람을 바꿔 가며 '자기 브랜드(머문) 생산만 보기'인지 확인한다.
//  PGlite 는 프로젝트 의존성이 아니다. 돌리려면: PGLITE_PATH=<@electric-sql/pglite 폴더>/dist/index.js npm test
//  화면 쪽(정적 검사)은 PGLITE_PATH 없이도 돈다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const rd = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const SNAP = rd('./fixtures/rls-snapshot-1028.sql');
const UP = rd('../supabase/migrations/099_partner_guard.sql');
const DOWN = rd('../supabase/rollbacks/099_partner_guard.down.sql');
const P = process.env.PGLITE_PATH;

//  Supabase 가 깔아 주는 것만 흉내: 역할 · auth.jwt()/uid() · storage 표(bhas 읽기 정책 하나)
const STUB = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create schema storage;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;
grant usage on schema auth, storage, public to anon, authenticated, service_role;
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated;
create policy bhas_select_auth on storage.objects for select to authenticated using (bucket_id = 'bhas');
`;
const MUMUN = '8e5ae3b9-4c14-480e-b1d2-5e34bb85da4b', OTHER = '11111111-1111-4111-8111-111111111111';
const S_MINE = 'aaaaaaaa-0000-4000-8000-000000000001', S_OTHER = 'aaaaaaaa-0000-4000-8000-000000000002', S_NULL = 'aaaaaaaa-0000-4000-8000-000000000003';
const U = { boss: 'cccccccc-0000-4000-8000-000000000001', sin: 'cccccccc-0000-4000-8000-000000000002', mumun: 'cccccccc-0000-4000-8000-000000000003' };
//  비밀번호 칸은 비워 둔다(테스트에도 비밀번호를 적지 않는다)
const SEED = `
insert into brands (id, name) values ('${MUMUN}', '머문'), ('${OTHER}', '다른브랜드');
insert into companies (id, name, role, username, brand_id, brand_access) values
  ('${U.boss}', '대표', 'MASTER', 'boss', null, null),
  ('${U.sin}', '직원', 'STAFF', 'sin', null, array['${MUMUN}', '${OTHER}']::uuid[]),
  ('${U.mumun}', '머문', 'CLIENT', 'mumun', '${MUMUN}', null);
insert into products (id, name, brand_id, company_id, access) values
  ('${S_MINE}', '머문 26SS', '${MUMUN}', '${U.boss}', 'all'),
  ('${S_OTHER}', '다른 26SS', '${OTHER}', '${U.boss}', 'all'),
  ('${S_NULL}', '브랜드 없는 시즌', null, '${U.boss}', 'all');
insert into product_items (brand_id, product_id, name, status, memo, vendor_id, quote_id, pattern_no, ship_date, sale_names) values
  ('${MUMUN}', '${S_MINE}', '하렘팬츠', '메인투입', '공장 단가 메모', gen_random_uuid(), gen_random_uuid(), 'P-01', '2026-11-03', array['머문 하렘팬츠']),
  ('${MUMUN}', '${S_OTHER}', '섞인 시즌 제품', '샘플 중', '', null, null, null, null, null),
  ('${OTHER}', '${S_OTHER}', '다른 브랜드 제품', '샘플 중', '비밀', null, null, null, null, null);
insert into product_stages (product_id, stage_id, status) values ('${S_MINE}', 'design', 'done'), ('${S_OTHER}', 'design', 'done');
insert into photos (product_id, url) values ('${S_MINE}', 'mine.jpg'), ('${S_OTHER}', 'other.jpg');
insert into season_steps (brand_id, name) values (null, '공통 틀'), ('${MUMUN}', '머문 틀'), ('${OTHER}', '다른 틀');
insert into memos (product_id, text) values ('${S_MINE}', '내부 메모');
insert into todos (product_id, text) values ('${S_MINE}', '내부 할 일');
insert into history (product_id, note) values ('${S_MINE}', '기록');
insert into documents (product_id, name) values ('${S_MINE}', '견적서.pdf');
insert into ig_accounts (brand_id, username) values ('${MUMUN}', 'mumun_ig');
insert into cs_tickets (brand_id, customer_name) values (null, '고객A'), ('${MUMUN}', '고객B');
insert into news_items (kind, title) values ('news', '뉴스');
insert into sync_log (channel, result) values ('cafe24', 'ok');
insert into storage.objects (bucket_id, name) values ('bhas', 'a.jpg');
`;
const GUARDED = ['morning_brief()', 'get_channel_operational_status()', 'reap_apify_runs()',
    "brand_customers('머문')", "brand_gone_counts('머문')", "brand_vip_rank_changes('머문')"];

test('099 파트너 막기(PGlite, 운영 스냅숏)', { skip: !P && 'PGLITE_PATH 없음 — 건너뜀' }, async t => {
    const { PGlite } = await import(pathToFileURL(P).href);
    const db = new PGlite();
    await db.exec(STUB);
    await db.exec(SNAP);
    await db.exec(SEED);

    //  사람 바꾸기: 세션에 JWT 를 걸고 역할을 바꾼다. who=null 이면 슈퍼유저(마이그레이션 돌리는 쪽)
    const as = async (who, sql) => {
        await db.exec('reset role');
        const claims = who === 'service' ? { role: 'service_role' }
            : who ? { role: 'authenticated', sub: U[who], email: `${who}@bhas.com` } : null;
        await db.query(`select set_config('request.jwt.claims', $1, false)`, [claims ? JSON.stringify(claims) : '']);
        if (who === 'service') await db.exec('set role service_role');
        else if (who) await db.exec('set role authenticated');
        try { return await db.query(sql); } finally { await db.exec('reset role'); }
    };
    const n = async (who, sql) => (await as(who, sql)).rows.length;
    const err = async (who, sql) => { try { await as(who, sql); return null; } catch (e) { return e.code || e.message; } };

    const tables = (await db.query(`select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
        where s.nspname = 'public' and c.relkind in ('r','p') and c.relrowsecurity order by 1`)).rows.map(r => r.relname);
    //  직원·대표가 보는 줄 수(표 전부) — 099 전후로 같아야 한다
    const snapshot = async who => {
        const out = {};
        for (const tb of tables) {
            try { out[tb] = (await as(who, `select count(*)::int c from public."${tb}"`)).rows[0].c; }
            catch (e) { out[tb] = 'ERR ' + (e.code || ''); }
        }
        return out;
    };
    const defs = async () => (await db.query(`select p.proname, pg_get_functiondef(p.oid) d from pg_proc p
        join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' order by 1, 2`)).rows;

    const before = { boss: await snapshot('boss'), sin: await snapshot('sin') };
    const defsBefore = await defs();
    //  비교가 헛돌지 않게: 직원은 실제로 줄을 본다
    assert.equal(before.sin.memos, 1); assert.equal(before.sin.product_items, 3); assert.equal(before.boss.cs_tickets, 2);
    //  099 전: 구멍이 실제로 있었다(로그인만 하면 메모·인스타가 보였다)
    assert.equal(await n('mumun', 'select * from memos'), 1, '전제: 099 전엔 파트너가 메모를 읽었다');
    assert.equal(await n('mumun', 'select * from ig_accounts'), 1, '전제: 099 전엔 파트너가 인스타 계정을 읽었다');

    await db.exec(UP);
    await db.exec(UP);                                       // 두 번 깔아도 깨지지 않는다

    await t.test('정책 목록 대조 — RLS 켜진 표마다 4개 + 스토리지 1개, 기존 156개는 그대로', async () => {
        const g = (await db.query(`select tablename, count(*)::int c, bool_and(permissive = 'RESTRICTIVE') r,
            bool_and(roles = '{authenticated}') a from pg_policies where policyname like 'partner_guard%' and schemaname = 'public' group by 1`)).rows;
        assert.equal(g.length, tables.length);
        assert.ok(g.every(x => x.c === 4 && x.r && x.a));
        assert.equal((await db.query(`select count(*)::int c from pg_policies where schemaname = 'public' and policyname not like 'partner_guard%'`)).rows[0].c, 156);
        assert.equal((await db.query(`select count(*)::int c from pg_policies where schemaname = 'storage' and policyname = 'partner_guard_select'`)).rows[0].c, 1);
    });

    await t.test('직원·대표가 보는 것은 099 전과 똑같다', async () => {
        assert.deepEqual(await snapshot('boss'), before.boss);
        assert.deepEqual(await snapshot('sin'), before.sin);
        assert.equal(await n('sin', 'select * from product_items'), 3);
        assert.equal(await err('sin', `update product_items set ship_date = '2026-12-01' where name = '하렘팬츠'`), null);
        assert.equal(await err('boss', 'select public.reap_apify_runs()'), null);
    });

    await t.test('파트너: 자기 브랜드 시즌·단계·사진·자기 계정 행만', async () => {
        assert.deepEqual((await as('mumun', 'select name from products order by 1')).rows.map(r => r.name), ['머문 26SS']);
        assert.equal(await n('mumun', 'select * from product_stages'), 1);
        assert.deepEqual((await as('mumun', 'select url from photos')).rows.map(r => r.url), ['mine.jpg']);
        assert.deepEqual((await as('mumun', 'select name from brands')).rows.map(r => r.name), ['머문']);
        assert.deepEqual((await as('mumun', 'select username from companies')).rows.map(r => r.username), ['mumun']);
        assert.deepEqual((await as('mumun', 'select name from season_steps order by 1')).rows.map(r => r.name), ['공통 틀', '머문 틀']);
    });

    await t.test('파트너: 내부 자료·다른 브랜드는 0줄', async () => {
        for (const tb of ['memos', 'todos', 'history', 'documents', 'ig_accounts', 'cs_tickets', 'news_items', 'sync_log', 'product_items']) {
            assert.equal(await n('mumun', `select * from ${tb}`), 0, tb);
        }
        //  RLS 켜진 표 전부: 위에서 허용한 6개 말고는 한 줄도 안 보인다
        const ok = new Set(['companies', 'brands', 'products', 'product_stages', 'photos', 'season_steps']);
        for (const tb of tables.filter(x => !ok.has(x))) {
            const r = await err('mumun', `select 1 from public."${tb}" limit 1`) ?? (await n('mumun', `select 1 from public."${tb}"`));
            assert.ok(r === 0 || r === '42501', `${tb}: ${r}`);
        }
        assert.equal(await n('mumun', 'select * from storage.objects'), 0);
    });

    await t.test('파트너 제품 목록 partner_items — 자기 브랜드, 안전한 열만', async () => {
        const r = await as('mumun', 'select * from public.partner_items()');
        assert.deepEqual(r.rows.map(x => x.name).sort(), ['섞인 시즌 제품', '하렘팬츠']);
        const cols = r.fields.map(f => f.name);
        for (const c of ['memo', 'vendor_id', 'quote_id', 'tech_pack_id', 'pattern_no', 'trims', 'checked', 'created_by']) assert.ok(!cols.includes(c), c);
        const h = r.rows.find(x => x.name === '하렘팬츠');
        assert.equal(h.season_name, '머문 26SS');
        assert.equal(h.status, '메인투입');
        assert.deepEqual(h.sale_names, ['머문 하렘팬츠']);
        //  다른 브랜드 시즌에 걸린 제품은 시즌 이름을 숨긴다
        assert.equal(r.rows.find(x => x.name === '섞인 시즌 제품').season_name, null);
        assert.equal(await err('mumun', 'select public.partner_items()') , null);
        assert.ok(await err(null, `set role anon; select public.partner_items()`), '비로그인은 못 부른다');
        await db.exec('reset role');
    });

    await t.test('파트너는 아무것도 못 쓴다', async () => {
        const w = [
            `insert into memos (text) values ('x')`,
            `insert into products (name, brand_id) values ('x', '${MUMUN}')`,
            `insert into cs_tickets (customer_name) values ('x')`,
            `insert into ig_accounts (username) values ('x')`,
            `insert into storage.objects (bucket_id, name) values ('bhas', 'x.jpg')`,
        ];
        for (const s of w) assert.ok(await err('mumun', s), s);
        //  고치기·지우기는 거절되거나 0줄
        for (const s of [`update products set name = 'x' returning id`, `update product_stages set status = 'x' returning id`,
            `update product_items set status = 'x' returning id`, `delete from photos returning id`, `delete from companies returning id`,
            `update companies set role = 'MASTER' returning id`, `update season_steps set name = 'x' returning id`]) {
            const e = await err('mumun', s);
            assert.ok(e || (await n('mumun', s)) === 0, s);
        }
        assert.equal((await db.query(`select role from companies where username = 'mumun'`)).rows[0].role, 'CLIENT');
        assert.equal((await db.query(`select count(*)::int c from products`)).rows[0].c, 3);
    });

    await t.test('SECURITY DEFINER 함수 6개 — 파트너 42501, 엣지함수(service_role)는 막지 않음', async () => {
        for (const f of GUARDED) assert.equal(await err('mumun', `select public.${f}`), '42501', f);
        //  weekly_brief 는 원래부터 파트너를 거절한다
        assert.equal(await err('mumun', `select public.weekly_brief('2026-10-26')`), '42501');
        assert.equal(await err('service', 'select public.require_staff()'), null);
        assert.equal(await err(null, 'select public.require_staff()'), null);   // 크론(JWT 없음)
        assert.equal(await err('sin', 'select public.require_staff()'), null);
        assert.equal(await err('mumun', 'select public.require_staff()'), '42501');
    });

    await t.test('되돌리기 — 정책·함수가 099 전과 똑같아진다', async () => {
        await db.exec(DOWN);
        await db.exec(DOWN);                                 // 두 번 돌려도 안전
        assert.equal((await db.query(`select count(*)::int c from pg_policies where policyname like 'partner_guard%'`)).rows[0].c, 0);
        assert.deepEqual(await defs(), defsBefore);
        assert.equal(await n('mumun', 'select * from memos'), 1);
        await db.exec(UP);                                   // 다시 깔아도 된다
        assert.equal(await n('mumun', 'select * from memos'), 0);
    });
});

//  화면 — main.js 실제 코드 정적 검사(PGlite 없이)
const src = rd('../main.js');
const grab = name => {
    const a = src.search(new RegExp(`\\n    (async )?${name}\\(`)) + 1;
    assert.ok(a > 0, name + ' 없음');
    const b = src.indexOf('\n    }\n', a) + 6;
    const body = src.slice(a, b).trim();
    return eval('(' + (body.startsWith('async ') ? 'async function ' + body.slice(6) : 'function ' + body) + ')');
};

const grabNotices = () => eval(src.match(/\n    PARTNER_NOTICES = (\[[\s\S]*?\]);/)[1]);

test('파트너 제품 목록은 partner_items 로 받고, 직원은 그대로 product_items', async () => {
    const calls = [];
    const mk = role => ({
        currentUser: { role }, showToast() {}, requestRender() {},
        supabase: {
            rpc: async n => { calls.push('rpc:' + n); return { data: [{ id: 1 }], error: null }; },
            from: tb => { calls.push('from:' + tb); const q = { select: () => q, order: () => q, then: r => r({ data: [{ id: 2 }], error: null }) }; return q; },
        },
        loadItems: grab('loadItems'),
    });
    const c = mk('CLIENT'); await c.loadItems();
    const s = mk('STAFF'); await s.loadItems();
    assert.deepEqual(calls, ['rpc:partner_items', 'from:product_items']);
    assert.deepEqual(c.pItems, [{ id: 1 }]);
    assert.deepEqual(s.pItems, [{ id: 2 }]);
});

test('파트너 화면 — 시즌·제품·제작현황·출고일자·오픈일만, 고치는 칸·메모·공장 없음', () => {
    const t = {
        _itemsLoaded: true, PARTNER_NOTICES: grabNotices(), ITEM_SC: { '메인투입': '#ff9f0a' },
        pItems: [
            { id: 'a', season_name: '머문 26SS', name: '하렘팬츠', sale_names: ['머문 하렘팬츠'], status: '메인투입', ship_date: '2026-11-03', open_date: null },
            { id: 'b', season_name: '머문 25FW', name: '<b>조끼', sale_names: null, status: '출고완료', ship_date: null, open_date: '2026-09-01' },
        ],
        _vesc: s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
        _mpTop: (a, b) => `<div class="mp-top"><b>${a}</b><span>${b}</span></div>`,
        requestRender() {},
    };
    t.renderPartnerItems = grab('renderPartnerItems');
    t.setPartnerFilter = grab('setPartnerFilter');
    let html = t.renderPartnerItems();
    const ths = [...html.matchAll(/<th>([^<]*)<\/th>/g)].map(m => m[1]);
    //  날짜는 '확정'으로 읽히지 않게 예정일로
    assert.deepEqual(ths, ['시즌', '제품', '제작현황', '출고예정일', '오픈예정일']);
    //  안내문 2줄은 사장님 원문 그대로, 표보다 위에 늘 보인다
    const note = html.split('<table')[0];
    assert.ok(note.includes('<div>*원부자재 입고일이 작업시작일이 아닙니다.</div>'));
    assert.ok(note.includes('<div>*출고예정일자는 예정된 날짜로, 확정이 아닙니다.</div>'));
    assert.match(html, /하렘팬츠/); assert.match(html, /2026-11-03/);
    assert.doesNotMatch(html, /조끼/);                         // 기본은 진행 중만
    assert.doesNotMatch(html, /<input|<select|contenteditable|setItem|memo|vendor/);
    t.setPartnerFilter('all', 1);
    html = t.renderPartnerItems();
    assert.match(html, /&lt;b>조끼/);                          // 이름은 이스케이프
    t.setPartnerFilter('season', 0);                          // 정렬된 시즌 순번 0 = 머문 25FW
    html = t.renderPartnerItems();
    assert.doesNotMatch(html, /하렘팬츠/); assert.match(html, /조끼/);
});

test('파트너는 허용 화면만 열고, 직원 메뉴는 그대로', () => {
    const mk = (role, menu_access) => {
        const t = { currentUser: { role, menu_access }, APP_GROUPS: [] };
        for (const n of ['_menuItems', '_menuViewSet', '_viewAllowed']) t[n] = grab(n);
        return t;
    };
    globalThis.mockData = { permissions: { MASTER: ['dashboard', 'documents', 'user_management'], STAFF: ['dashboard', 'documents'], CLIENT: ['dashboard', 'detail'] } };
    const c = mk('CLIENT', null);
    for (const v of ['home', 'items', 'dashboard', 'timeline', 'sample_maker', 'settings']) assert.ok(c._viewAllowed(v), v);
    for (const v of ['orders', 'cs', 'sales', 'inventory', 'vendors', 'quotes', 'notes', 'reminders', 'news', 'sns', 'documents', 'tech_packs', 'user_management', 'crm', 'contacts'])
        assert.ok(!c._viewAllowed(v), v);
    //  계정 화면에서 메뉴 권한(menu_access)을 저장한 파트너도 제품은 보인다
    assert.ok(mk('CLIENT', ['dashboard'])._viewAllowed('items'));
    const s = mk('STAFF', null);
    for (const v of ['orders', 'cs', 'items', 'news', 'vendors']) assert.ok(s._viewAllowed(v), v);
    //  직원 사이드 메뉴엔 파트너용 '제품' 줄이 안 생긴다
    assert.ok(!s._menuItems().find(i => i.id === 'items').visible);
    delete globalThis.mockData;
    //  독·전체 메뉴·창 열기가 같은 문을 지난다
    assert.match(src, /macOpen\(view\) \{\n[^\n]*\n\s+if \(!this\._viewAllowed\(view\)\)/);
    assert.match(src, /MAC_DOCK\.filter\(d => !d\.tool && \(d\.launcher \|\| this\._viewAllowed\(d\.id\)\)\)/);
    assert.match(src, /items = items\.filter\(i => this\._viewAllowed\(i\[0\]\)\)/);
    assert.match(src, /if \(this\.currentUser\?\.role === 'CLIENT'\) return this\.renderPartnerItems\(\);/);
});
