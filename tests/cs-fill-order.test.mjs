//  CS 주문 늦게 연결(10-26) — 095 트리거: 접수가 먼저, 주문·상품이 나중에 들어와도 CS 빈칸이 채워진다.
//  PGlite 부분은 PGLITE_PATH 가 있을 때만 돈다(tech-pack-upload.test.mjs 와 같은 방식).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');

test('addCS: 주문을 못 찾으면 "아직 수집 전" 안내', () => {
    const main = read('../main.js');
    const body = main.slice(main.indexOf('async addCS(kind)'), main.indexOf('async setCSStatus('));
    assert.match(body, /if \(orderNo && !found\) this\.showToast\('주문이 아직 안 들어왔어요\(5분마다 수집\)\. 들어오면 고객·상품이 자동으로 채워집니다'\)/);
    assert.doesNotMatch(body, /수동으로 저장합니다/);
});

test('095 늦게 들어온 주문으로 CS 빈칸 채우기 · 되돌리기(PGlite)', { skip: !process.env.PGLITE_PATH && 'PGLITE_PATH 없음 — 건너뜀' }, async () => {
    const { PGlite } = await import(pathToFileURL(process.env.PGLITE_PATH).href);
    const db = new PGlite();
    //  운영 칸(10-26 information_schema 읽기 전용 조회) 중 쓰는 것만 + 운영 cs_tickets_guard_date 그대로
    await db.exec(`
create role anon nologin; create role authenticated nologin;
create table malls (mall_key text primary key, brand_id uuid);
create table channel_orders (id uuid primary key default gen_random_uuid(), channel text default 'cafe24', order_id text,
  order_date timestamptz, buyer_name text, receiver_name text, mall_key text references malls(mall_key));
create table channel_order_items (id uuid primary key default gen_random_uuid(),
  channel_order_id uuid references channel_orders(id) on delete cascade, product_name text, quantity int default 1);
create table cs_tickets (id uuid primary key default gen_random_uuid(),
  occurred_on date default ((now() at time zone 'Asia/Seoul'))::date, customer_name text, kind text default '교환',
  brand_id uuid, order_no text, channel_order_id uuid, product_name text, date_suspect boolean default false);
create function cs_tickets_guard_date() returns trigger language plpgsql as $$
declare od date;
begin
  if new.channel_order_id is null or new.occurred_on is null then new.date_suspect := false; return new; end if;
  select (o.order_date at time zone 'Asia/Seoul')::date into od from channel_orders o where o.id = new.channel_order_id;
  if od is null then new.date_suspect := false; return new; end if;
  if new.occurred_on < od then
    if tg_op = 'INSERT' or new.occurred_on is distinct from old.occurred_on
       or new.channel_order_id is distinct from old.channel_order_id then
      raise exception '접수일(%)이 주문일(%)보다 빠릅니다.', new.occurred_on, od;
    end if;
    new.date_suspect := true;
  else new.date_suspect := false; end if;
  return new;
end $$;
create trigger trg_cs_tickets_guard_date before insert or update on cs_tickets for each row execute function cs_tickets_guard_date();
insert into malls values ('hhh', '11111111-1111-4111-8111-111111111111'), ('rohi', '22222222-2222-4222-8222-222222222222');
`);
    const up = read('../supabase/migrations/095_cs_fill_from_order.sql');
    await db.exec(up); await db.exec(up);                                       // 두 번 깔아도 선다
    const B1 = '11111111-1111-4111-8111-111111111111';
    const order = async (no, mall, at = '2026-10-26T03:11:00Z') => (await db.query(
        `insert into channel_orders (order_id, mall_key, order_date, receiver_name, buyer_name) values ($1,$2,$3,'방보경','bbk') returning id`,
        [no, mall, at])).rows[0].id;
    const items = (id, names) => db.query(`insert into channel_order_items (channel_order_id, product_name)
        select $1, unnest($2::text[])`, [id, names]);
    const cs = async (no, extra = {}) => (await db.query(
        `insert into cs_tickets (order_no, customer_name, product_name, brand_id, occurred_on) values ($1,$2,$3,$4,$5) returning id`,
        [no, extra.name ?? '(이름없음)', extra.product ?? null, extra.brand ?? null, extra.on ?? '2026-10-26'])).rows[0].id;
    const get = async id => (await db.query(`select * from cs_tickets where id = $1`, [id])).rows[0];

    // 1) 접수 먼저 → 주문 → 상품: 이름·주문·브랜드·상품(3개까지) 채움
    const t1 = await cs('20261026-0000049');
    const o1 = await order('20261026-0000049', 'hhh');
    let r = await get(t1);
    assert.equal(r.customer_name, '방보경'); assert.equal(r.channel_order_id, o1); assert.equal(r.brand_id, B1);
    assert.equal(r.product_name, null, '상품은 아직');
    await items(o1, ['곰돌이 니트', '멜빵바지', '양말', '모자']);
    r = await get(t1);
    assert.equal(r.product_name.split(', ').length, 3);
    assert.ok(r.product_name.split(', ').every(p => ['곰돌이 니트', '멜빵바지', '양말', '모자'].includes(p)));

    // 2) 직원이 적은 이름·상품·브랜드는 그대로, 빈 칸(주문 연결)만 채움
    const t2 = await cs('A-2', { name: '김고객(직원입력)', product: '직원이 적은 상품', brand: '22222222-2222-4222-8222-222222222222' });
    const o2 = await order('A-2', 'hhh'); await items(o2, ['다른 상품']);
    r = await get(t2);
    assert.equal(r.customer_name, '김고객(직원입력)'); assert.equal(r.product_name, '직원이 적은 상품');
    assert.equal(r.brand_id, '22222222-2222-4222-8222-222222222222'); assert.equal(r.channel_order_id, o2);

    // 3) 몰 두 곳에 같은 주문번호 → 안 채움
    const oa = await order('DUP-1', 'hhh'); await items(oa, ['가']);
    const t3 = await cs('DUP-1');
    const ob = await order('DUP-1', 'rohi'); await items(ob, ['나']);
    r = await get(t3);
    assert.equal(r.customer_name, '(이름없음)'); assert.equal(r.channel_order_id, null); assert.equal(r.product_name, null);

    // 4) 접수일이 주문일보다 빠르면(가드가 막는 경우) 건드리지 않고, 주문 수집은 그대로 성공
    const t4 = await cs('OLD-1', { on: '2026-10-01' });
    const o4 = await order('OLD-1', 'hhh'); await items(o4, ['상품']);
    r = await get(t4);
    assert.equal(r.channel_order_id, null); assert.equal(r.customer_name, '(이름없음)');
    assert.equal((await db.query(`select count(*)::int c from channel_order_items where channel_order_id = $1`, [o4])).rows[0].c, 1);

    // 5) 주문번호 없는 CS · 다른 주문번호 CS 는 그대로
    const t5 = await cs('OTHER-9');
    await order('NOPE-1', 'hhh');
    assert.equal((await get(t5)).channel_order_id, null);

    // 6) 되돌리기: 트리거·함수만 빠지고 채운 값은 남는다
    await db.exec(read('../supabase/rollbacks/095_cs_fill_from_order.down.sql'));
    const t6 = await cs('AFTER-1'); await order('AFTER-1', 'hhh');
    assert.equal((await get(t6)).channel_order_id, null, '되돌린 뒤엔 안 채움');
    assert.equal((await get(t1)).customer_name, '방보경');
    assert.equal((await db.query(`select count(*)::int c from pg_proc where proname like 'cs_fill%'`)).rows[0].c, 0);
});
