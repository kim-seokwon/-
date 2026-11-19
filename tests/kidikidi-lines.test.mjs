//  키디키디 수집기 줄 보존(P0-03 설계 → 구현 11-19). 합성 자료만 — 이랜드·운영 DB 안 씀.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { groupElandLines as g, splitRows, UPDATE_KEYS } from '../channel-bots/kidikidi/lines.mjs';

const L = (o, x) => ({ ordNo: 'O1', ordTs: '2026-03-05 10:00:00', itemName: '티셔츠', ordQty: 1, sellAmount: 10000, ...x, ...o });
const sync = readFileSync(new URL('../channel-bots/kidikidi/sync.mjs', import.meta.url), 'utf8');

test('다품목 주문 — 전 줄을 raw.items 에, 금액 합, 첫 줄 필드 유지', () => {
    const [o] = g([[L({ itemNo: 'A', uitemNo: 'S' }), L({ itemNo: 'B', uitemNo: 'M', sellAmount: 7000 }), L({ itemNo: 'C', uitemNo: 'L', sellAmount: 3000 })]]);
    assert.equal(o.raw.items.length, 3); assert.equal(o.pay_amount, 20000);
    assert.equal(o.raw.itemNo, 'A'); assert.equal(o.raw.ordTs, '2026-03-05 10:00:00');
    assert.deepEqual(o.raw.items.map(i => i.sellAmount), [10000, 7000, 3000]);
});

test('중복 키 — ordDtlNo 있으면 두 창 겹친 줄 1번만', () => {
    const a = [L({ ordDtlNo: '1', itemNo: 'A' }), L({ ordDtlNo: '2', itemNo: 'B', sellAmount: 5000 })];
    const [o] = g([a, [a[1]]]);
    assert.equal(o.dedupe, 'dtl'); assert.equal(o.raw.items.length, 2); assert.equal(o.pay_amount, 15000);
});

test('중복 키 — itemNo·uitemNo·줄순번이면 그 키로, 같은 상품·옵션 두 줄은 순번으로 구분', () => {
    const a = [L({ itemNo: 'A', uitemNo: 'S', ordSeq: 1 }), L({ itemNo: 'A', uitemNo: 'S', ordSeq: 2 })];
    const [o] = g([a, a]);
    assert.equal(o.dedupe, 'seq'); assert.equal(o.raw.items.length, 2); assert.equal(o.pay_amount, 20000);
});

test('안정 키 없음 — 줄은 합치지 않고(같은 상품·옵션 두 줄도 둘), 뒤 창의 같은 주문은 통째 무시', () => {
    const [o] = g([[L({ itemNo: 'A', uitemNo: 'S' }), L({ itemNo: 'A', uitemNo: 'S' })]]);
    assert.equal(o.dedupe, 'none'); assert.equal(o.raw.items.length, 2);
    const a = [L({}), L({ sellAmount: 4000 })];
    const [p] = g([a, a]);
    assert.equal(p.raw.items.length, 2); assert.equal(p.pay_amount, 14000); assert.equal(p.windows, 2);
    const [q] = g([[L({ ordDtlNo: '1', itemNo: 'A' }), L({ itemNo: 'A' })]]);
    assert.equal(q.dedupe, 'none', '일부만 키 → 부분 키로 합치지 않음'); assert.equal(q.raw.items.length, 2);
});

test('여러 주문·평면 배열·ordNo 없는 줄 무시·sellPrice 대체', () => {
    const r = g([L({ ordDtlNo: '1' }), L({ ordNo: 'O2', ordDtlNo: '1', sellAmount: undefined, sellPrice: 900 }), { itemName: '번호없음' }]);
    assert.deepEqual(r.map(o => [o.order_id, o.pay_amount]), [['O1', 10000], ['O2', 900]]);
    assert.deepEqual(g([]), []);
});

test('저장 나누기 — 이미 있는 주문은 수집 칸만(status·수령인 안 건드림), 새 주문만 전체 행', () => {
    const row = id => ({ channel: 'eland', mall_key: 'kidikidi', order_id: id, order_date: 'd', buyer_name: 'b', receiver_name: null, pay_amount: 1, channel_status: '1010', status: 'new', raw: {} });
    const { fresh, update } = splitRows([row('A'), row('B')], ['B']);
    assert.deepEqual(fresh.map(r => r.order_id), ['A']); assert.equal(fresh[0].status, 'new');
    assert.deepEqual(Object.keys(update[0]).sort(), [...UPDATE_KEYS].sort());
    assert.ok(!('status' in update[0]) && !('receiver_name' in update[0]) && !('buyer_name' in update[0]));
});

test('수집기 연결 — 창별로 받아 groupElandLines·splitRows 를 쓰고, 옛 첫 줄만 남기던 묶기는 없다', () => {
    assert.match(sync, /import \{ groupElandLines, splitRows \} from '\.\/lines\.mjs'/);
    assert.match(sync, /const groups = groupElandLines\(wins\)/);
    assert.match(sync, /splitRows\(rows, existing\)/);
    assert.doesNotMatch(sync, /byOrd\[k\] = mapOrder\(o\)/);
    assert.doesNotMatch(sync, /upsert\(rows,/, '전체 행 upsert 로 status 를 new 로 덮지 않음');
    assert.match(sync, /if \(error\) throw error;   \/\/ 조회 실패를 '없음'으로 보면/);
    assert.match(sync, /process\.env\.DIAG === '1' \|\| process\.env\.DRY === '1'\) return;/, 'DRY 는 sync_log 안 남김');
    assert.match(sync, /if \(process\.env\.DRY !== '1'\) await ensureMall\(\)/);
});

const P = process.env.PGLITE_PATH;
test('상태 보존(PGlite) — 이미 shipped 인 주문을 다시 수집해도 shipped·수령인 그대로, raw·금액만 갱신', { skip: !P && 'PGLITE_PATH 없음' }, async () => {
    const { PGlite } = await import(pathToFileURL(P).href);
    const db = new PGlite();
    await db.exec(`create table channel_orders (id serial primary key, channel text, mall_key text, order_id text, order_date timestamptz, buyer_name text,
      receiver_name text, receiver_phone text, receiver_address text, pay_amount numeric, channel_status text, status text not null default 'new', raw jsonb, unique (mall_key, order_id));
      insert into channel_orders (channel, mall_key, order_id, pay_amount, status, receiver_name, raw) values ('eland', 'kidikidi', 'K1', 30000, 'shipped', '홍*동', '{"itemNo":"A"}');`);
    const [k1, k2] = g([[L({ ordNo: 'K1', itemNo: 'A' }), L({ ordNo: 'K1', itemNo: 'B', sellAmount: 20000 }), L({ ordNo: 'K2', itemNo: 'C' })]]);
    const rows = [k1, k2].map(x => ({ channel: 'eland', mall_key: 'kidikidi', order_id: x.order_id, order_date: '2026-03-05T10:00:00', buyer_name: null,
      receiver_name: null, receiver_phone: null, receiver_address: null, pay_amount: x.pay_amount, channel_status: '1010', status: 'new', raw: x.raw }));
    const ex = (await db.query(`select order_id from channel_orders where mall_key = 'kidikidi' and order_id = any($1)`, [rows.map(r => r.order_id)])).rows.map(r => r.order_id);
    const { fresh, update } = splitRows(rows, ex);
    //  supabase-js insert / upsert(onConflict) 가 보내는 SQL 모양 그대로: 준 칸만 넣고, 충돌 시 준 칸만 갱신
    const put = async (r, upsert) => { const ks = Object.keys(r); await db.query(`insert into channel_orders (${ks}) values (${ks.map((_, i) => '$' + (i + 1))})` +
      (upsert ? ` on conflict (mall_key, order_id) do update set ${ks.map(k => `${k} = excluded.${k}`)}` : ''), ks.map(k => k === 'raw' ? JSON.stringify(r[k]) : r[k])); };
    for (const r of fresh) await put(r, false);
    for (const r of update) await put(r, true);
    const got = Object.fromEntries((await db.query(`select order_id, status, receiver_name, pay_amount::int p, jsonb_array_length(raw->'items') n from channel_orders`)).rows.map(r => [r.order_id, r]));
    assert.deepEqual(got.K1, { order_id: 'K1', status: 'shipped', receiver_name: '홍*동', p: 30000, n: 2 });
    assert.deepEqual(got.K2, { order_id: 'K2', status: 'new', receiver_name: null, p: 10000, n: 1 });
    await db.close();
});
