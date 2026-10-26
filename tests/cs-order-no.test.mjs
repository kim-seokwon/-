//  CS 주문번호 표기 차이(10-26) — 하이픈·공백·ORD 가 달라도 주문을 찾는다. main.js 후보 · 096 정규화 트리거 · 1회 보정.
//  PGlite 부분은 PGLITE_PATH 가 있을 때만 돈다(cs-fill-order.test.mjs 와 같은 방식).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const src = read('../main.js');
const method = (name) => {
    const m = new RegExp(`\\n    (async )?${name}\\(`).exec(src); assert.ok(m, `${name} 를 main.js 에서 못 찾음`);
    const a = m.index + 1, b = src.indexOf('\n    }\n', a) + 6;
    return eval('(' + src.slice(a, b).trim().replace(new RegExp(`^(async )?${name}\\(`), (_, as) => `${as || ''}function ${name}(`) + ')');
};
const cands = method('_orderNoCandidates');

test('주문번호 후보 — 키디키디 하이픈 붙이기/빼기 · 29cm ORD · cafe24 공백', () => {
    assert.ok(cands('20250724-1209833').includes('202507241209833'), '하이픈 뺀 키디키디 주문');
    assert.ok(cands('202507241209833').includes('20250724-1209833'), '하이픈 붙인 표기');
    assert.ok(cands('20260604-8904004').includes('ORD20260604-8904004'), '29cm ORD 없이 적음');
    assert.ok(cands('ord20260604-8904004').includes('ORD20260604-8904004'), '소문자 ord');
    assert.ok(cands('ORD20260604-8904004').includes('20260604-8904004'), 'ORD 떼기');
    assert.ok(cands(' 20261026 - 0000049 ').includes('20261026-0000049'), 'cafe24 공백 섞임');
    assert.deepEqual(cands('A-2'), ['A-2'], '모르는 형식은 원문만 — A2 로 안 합침');
    assert.deepEqual(cands('ORD1'), ['ORD1'], 'ORD1 ≠ 1');
    assert.deepEqual(cands('2025072-41209833'), ['2025072-41209833'], '하이픈 자리가 다르면 원문만');
    assert.deepEqual(cands('   '), []); assert.deepEqual(cands(null), []);
});

const fakeDb = rows => {
    const calls = [];
    const q = { select() { return q; }, in(c, v) { calls.push(['in', c, v]); return q; }, eq(c, v) { calls.push(['eq', c, v]); return q; },
        limit(n) { calls.push(['limit', n]); return Promise.resolve({ data: rows }); } };
    const items = { select() { return items; }, eq() { return items; }, limit() { return Promise.resolve({ data: [{ product_name: '곰돌이 니트' }] }); } };
    return { calls, from: t => (t === 'channel_orders' ? q : items) };
};
const lookup = method('_csLookupOrder');
const ctx = supabase => ({ supabase, malls: [{ mall_key: 'kidi', brand_id: 'B1' }], _orderNoCandidates: cands });

test('_csLookupOrder — 후보 in 으로 찾고 정확히 1건일 때만 채움', async () => {
    const one = fakeDb([{ id: 'o1', mall_key: 'kidi', channel: 'eland', receiver_name: '홍길동' }]);
    const r = await lookup.call(ctx(one), '20250724-1209833');
    assert.equal(r.channel_order_id, 'o1'); assert.equal(r.purchase_from, '키디키디'); assert.equal(r.brand_id, 'B1');
    assert.equal(r.customer_name, '홍길동'); assert.equal(r.product_name, '곰돌이 니트');
    const inCall = one.calls.find(c => c[0] === 'in');
    assert.equal(inCall[1], 'order_id'); assert.ok(inCall[2].includes('202507241209833'));
    assert.ok(one.calls.some(c => c[0] === 'limit' && c[1] === 2), '2건까지 받아 중복을 안다');
    const two = fakeDb([{ id: 'o1', mall_key: 'kidi' }, { id: 'o2', mall_key: 'hhh' }]);
    assert.equal(await lookup.call(ctx(two), '20250724-1209833'), null, '두 몰에 같은 번호 → 안 채움');
    assert.equal(await lookup.call(ctx(fakeDb([])), '20250724-1209833'), null);
    assert.equal(await lookup.call(ctx(fakeDb([])), ''), null);
    //  mallKey: 몰로 먼저 거르지 않는다 — 전체 후보가 2건이면 몰을 줘도 null, 유일해도 몰이 다르면 null
    const dup = fakeDb([{ id: 'o1', mall_key: 'kidi' }, { id: 'o2', mall_key: 'hhh' }]);
    assert.equal(await lookup.call(ctx(dup), '20250724-1209833', 'kidi'), null, '몰 2곳 같은 번호 + mallKey');
    assert.ok(!dup.calls.some(c => c[0] === 'eq'), 'eq(mall_key) 로 먼저 거르지 않음');
    assert.equal(await lookup.call(ctx(fakeDb([{ id: 'o1', mall_key: 'hhh' }])), '20250724-1209833', 'kidi'), null, '몰 다름');
    assert.equal((await lookup.call(ctx(fakeDb([{ id: 'o1', mall_key: 'kidi' }])), '20250724-1209833', 'kidi')).channel_order_id, 'o1');
});

const PG = { skip: !process.env.PGLITE_PATH && 'PGLITE_PATH 없음 — 건너뜀' };
const setup = async () => {
    const { PGlite } = await import(pathToFileURL(process.env.PGLITE_PATH).href);
    const db = new PGlite();
    await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create table malls (mall_key text primary key, brand_id uuid);
create table channel_orders (id uuid primary key default gen_random_uuid(), channel text default 'cafe24', order_id text,
  order_date timestamptz, buyer_name text, receiver_name text, mall_key text references malls(mall_key));
create table channel_order_items (id uuid primary key default gen_random_uuid(),
  channel_order_id uuid references channel_orders(id) on delete cascade, product_name text, quantity int default 1);
create table cs_tickets (id uuid primary key default gen_random_uuid(),
  occurred_on date default ((now() at time zone 'Asia/Seoul'))::date, customer_name text, kind text default '교환',
  brand_id uuid, order_no text, channel_order_id uuid, product_name text, date_suspect boolean default false);
insert into malls values ('kidi', '11111111-1111-4111-8111-111111111111'), ('hhh', '22222222-2222-4222-8222-222222222222'),
  ('29cm', '33333333-3333-4333-8333-333333333333');
`);
    const order = async (no, mall, at = '2026-10-26T03:11:00Z') => (await db.query(
        `insert into channel_orders (order_id, mall_key, order_date, receiver_name, buyer_name) values ($1,$2,$3,'방보경','bbk') returning id`,
        [no, mall, at])).rows[0].id;
    const cs = async (no, extra = {}) => (await db.query(
        `insert into cs_tickets (order_no, customer_name, product_name, occurred_on) values ($1,$2,$3,$4) returning id`,
        [no, extra.name ?? '(이름없음)', extra.product ?? null, extra.on ?? '2026-10-26'])).rows[0].id;
    const get = async id => (await db.query(`select * from cs_tickets where id = $1`, [id])).rows[0];
    //  운영 미연결 3건과 같은 꼴(10-26 읽기 전용 조회) — 096 1회 보정 대상
    const o = {
        k1: await order('202507241209833', 'kidi', '2025-07-24T01:00:00Z'),
        k2: await order('202507111006403', 'kidi', '2025-07-11T01:00:00Z'),
        c29: await order('ORD20260604-8904004', '29cm', '2026-06-04T01:00:00Z'),
    };
    const t = {
        k1: await cs('20250724-1209833', { on: '2025-07-25' }),
        k2: await cs('20250711-1006403', { name: '직원이 적은 이름', on: '2025-07-12' }),
        c29: await cs('ORD20260604-8904004', { on: '2026-06-05' }),
    };
    return { db, order, cs, get, o, t };
};
const apply = async db => {
    await db.exec(read('../supabase/migrations/095_cs_fill_from_order.sql'));
    const up = read('../supabase/migrations/096_cs_order_no_norm.sql');
    await db.exec(up); await db.exec(up);                                         // 두 번 깔아도 선다(보정도 중복 없음)
};

test('096 정규화는 알려진 형식만(PGlite)', PG, async () => {
    const { db } = await setup();
    await db.exec(read('../supabase/migrations/095_cs_fill_from_order.sql'));
    await db.exec(read('../supabase/migrations/096_cs_order_no_norm.sql'));
    const n = async v => (await db.query(`select public.order_no_norm($1) v`, [v])).rows[0].v;
    for (const v of ['20250724-1209833', '202507241209833', ' 20250724 - 1209833 ', 'ORD20250724-1209833', 'ord202507241209833'])
        assert.equal(await n(v), '202507241209833', v);
    assert.equal(await n('ORD1'), 'ORD1'); assert.equal(await n('A-2'), 'A-2'); assert.equal(await n('2025072-41209833'), '2025072-41209833');
    assert.notEqual(await n('ORD1'), await n('1')); assert.notEqual(await n('A-2'), await n('A2'));
    await db.close();
});

test('096 1회 보정 — 운영 3건만 · 트리거 정규화 · 되돌리기(PGlite)', PG, async () => {
    const { db, order, cs, get, o, t } = await setup();
    const B1 = '11111111-1111-4111-8111-111111111111';
    const other = await cs('20250801-0000001', { on: '2025-08-02' });             // 3건 목록 밖 → 보정 안 함
    await order('202508010000001', 'kidi', '2025-08-01T01:00:00Z');
    await db.exec(read('../supabase/migrations/095_cs_fill_from_order.sql'));
    assert.equal((await get(t.k1)).channel_order_id, null, '095 만으로는 표기가 달라 못 찾음');
    const up = read('../supabase/migrations/096_cs_order_no_norm.sql');
    await db.exec(up); await db.exec(up);

    let r = await get(t.k1);
    assert.equal(r.channel_order_id, o.k1); assert.equal(r.customer_name, '방보경'); assert.equal(r.brand_id, B1);
    assert.equal(r.auto_fill.channel_order_id, o.k1);
    r = await get(t.k2);
    assert.equal(r.channel_order_id, o.k2); assert.equal(r.customer_name, '직원이 적은 이름', '직원 값 안 덮음');
    assert.equal(r.auto_fill.customer_name, undefined);
    assert.equal((await get(t.c29)).channel_order_id, o.c29);
    assert.equal((await get(other)).channel_order_id, null, '목록 밖 미연결은 보정 안 함');

    // 이후 들어오는 주문(트리거): 하이픈 → 하이픈 없는 키디키디 주문
    const a = await cs('20261026-1234567'); const ao = await order('202610261234567', 'kidi');
    assert.equal((await get(a)).channel_order_id, ao);
    const b = await cs('202610260000049'); const bo = await order('20261026-0000049', 'hhh');
    assert.equal((await get(b)).channel_order_id, bo, '하이픈 없이 적음 → cafe24');
    const c = await cs('20260604-8904005'); const co = await order('ORD20260604-8904005', '29cm');
    assert.equal((await get(c)).channel_order_id, co, '29cm ORD 없이');
    const d = await cs(' 20261026 - 0000050 '); const dO = await order('20261026-0000050', 'hhh');
    assert.equal((await get(d)).channel_order_id, dO, 'cafe24 공백');
    // 모르는 형식은 안 합침: ORD1 ↔ 1, A-2 ↔ A2
    const e = await cs('1'); await order('ORD1', 'hhh');
    const f = await cs('A2'); await order('A-2', 'hhh');
    assert.equal((await get(e)).channel_order_id, null, 'ORD1 ≠ 1');
    assert.equal((await get(f)).channel_order_id, null, 'A-2 ≠ A2');
    const g = await cs('A-3'); const go = await order('A-3', 'hhh');
    assert.equal((await get(g)).channel_order_id, go, '모르는 형식도 원문 일치면 붙음');
    // 같은 번호가 다른 몰에 2건째(표기만 다름) → 자동으로 채운 것 되돌림
    await order('20261026-1234567', 'hhh');
    r = await get(a);
    assert.equal(r.channel_order_id, null); assert.equal(r.customer_name, '(이름없음)'); assert.equal(r.auto_fill, null);
    assert.equal((await db.query(`select count(*)::int n from pg_indexes where indexname = 'channel_orders_order_no_norm_idx'`)).rows[0].n, 1);

    // 되돌리기: 095 본문(그대로 비교)으로 — 표기 다른 주문은 다시 안 붙고, 같은 표기는 그대로 붙는다
    await db.exec(read('../supabase/rollbacks/096_cs_order_no_norm.down.sql'));
    assert.equal((await db.query(`select count(*)::int n from pg_proc where proname = 'order_no_norm'`)).rows[0].n, 0);
    assert.equal((await get(t.k1)).channel_order_id, o.k1, '채운 값은 남김');
    const h = await cs('20261027-0000001'); await order('202610270000001', 'kidi');
    assert.equal((await get(h)).channel_order_id, null);
    const i = await cs('20261027-0000002'); const io = await order('20261027-0000002', 'hhh');
    assert.equal((await get(i)).channel_order_id, io);
    await db.close();
});

test('096 1회 보정 — 대상이 정확히 3건이 아니면 아무것도 안 함(PGlite)', PG, async () => {
    //  같은 번호로 CS 가 하나 더 있으면(4건) 통째로 건너뜀
    const s1 = await setup();
    const extra = await s1.cs('20250724-1209833', { on: '2025-07-26' });
    await apply(s1.db);
    for (const id of [...Object.values(s1.t), extra]) assert.equal((await s1.get(id)).channel_order_id, null);
    await s1.db.close();
    //  세 번호 중 하나가 몰 2곳에 겹치면(주문 유일 아님) 건너뜀
    const s2 = await setup();
    await s2.order('ORD20250711-1006403', '29cm', '2025-07-11T02:00:00Z');
    await apply(s2.db);
    for (const id of Object.values(s2.t)) assert.equal((await s2.get(id)).channel_order_id, null);
    await s2.db.close();
});
