//  CS 원송장 + 합배송(10-27) — csShipments.js 묶기 · 097 cs_order_shipments RPC · 화면 연결.
//  PGlite 부분은 PGLITE_PATH 가 있을 때만 돈다(cs-fill-order.test.mjs 와 같은 방식).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { groupShipments, shipSummary, courierShort, trackUrl, optionText } from '../csShipments.js';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const src = read('../main.js');
const method = (name) => {
    const m = new RegExp(`\\n    (async )?${name}\\(`).exec(src); assert.ok(m, `${name} 를 main.js 에서 못 찾음`);
    const a = m.index + 1, b = src.indexOf('\n    }\n', a) + 6;
    return eval('(' + src.slice(a, b).trim().replace(new RegExp(`^(async )?${name}\\(`), (_, as) => `${as || ''}function ${name}(`) + ')');
};
const O = 'o1';
const r = (tracking_no, product_name, extra = {}) => ({ channel_order_id: O, channel: 'cafe24', tracking_no, courier: '우체국택배',
    shipped_date: '2026-09-23T14:15:11+09:00', product_name, option_name: null, quantity: 1, ...extra });

test('묶기 — 합배송(1송장 3상품) · 부분출고(2송장) · 미출고 · 정보 없음', () => {
    const one = groupShipments([r('6890175291569', 'A'), r('6890175291569', 'B'), r('6890175291569', 'C')]);
    assert.equal(one.shipments.length, 1); assert.equal(one.shipments[0].items.length, 3); assert.equal(one.unshipped.length, 0);
    assert.deepEqual(shipSummary(one), { kind: 'ship', text: '우체국 6890175291569' });

    const two = groupShipments([r('222', 'B', { shipped_date: '2026-10-08' }), r('111', 'A', { shipped_date: '2026-10-01' }), r(null, 'C')]);
    assert.deepEqual(two.shipments.map(s => s.tracking_no), ['111', '222'], '처음 출고된 송장(원송장)이 먼저');
    assert.equal(shipSummary(two).text, '우체국 111 외 1');
    assert.deepEqual(two.unshipped.map(i => i.product_name), ['C'], '같은 주문의 미출고 상품');

    const un = groupShipments([r(null, 'A'), r(null, 'B')]);
    assert.deepEqual(shipSummary(un), { kind: 'unshipped', text: '미출고' });

    const eland = groupShipments([{ channel_order_id: O, channel: 'eland', tracking_no: null, product_name: null }]);
    assert.equal(eland.none, true); assert.equal(shipSummary(eland).text, '');
    assert.equal(groupShipments([]).none, true);
});

test('택배사 약칭 · 조회 링크(우체국·CJ 만) · 옵션', () => {
    assert.equal(courierShort('우체국택배'), '우체국'); assert.equal(courierShort('CJ대한통운'), 'CJ'); assert.equal(courierShort('한진택배'), '한진');
    assert.equal(courierShort('자체배송'), '자체배송');
    assert.equal(trackUrl('우체국택배', '6890175291569'), 'https://service.epost.go.kr/trace.RetrieveDomRigiTraceList.comm?sid1=6890175291569');
    assert.equal(trackUrl('CJ대한통운', '5123-4567'), 'https://trace.cjlogistics.com/next/tracking.html?wblNo=51234567');
    assert.equal(trackUrl('한진택배', '461084615014'), '', '그 외는 복사만');
    assert.equal(optionText('배송=프리오더 (마감 후 배송3-4주), color=크림, size=ADULT (55-66)'), '크림 · ADULT (55-66)');
    assert.equal(optionText('[컬러] 크림/네이비, [사이즈] L'), '크림/네이비 · L');
});

test('상세 구역 — 연결 안 됨 · 실패·다시 · 송장별 상품 · 조회 링크', () => {
    const ctx = { _vesc: s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`), csShip: {}, _csShipErr: {} };
    const html = method('_csShipHtml');
    assert.match(html.call(ctx, { channel_order_id: null }), /주문 연결되면 표시/);
    ctx._csShipErr.o9 = true;
    assert.match(html.call(ctx, { channel_order_id: 'o9' }), /불러오기 실패[\s\S]*_csShipRetry\('o9'\)[\s\S]*다시/);
    ctx.csShip.o1 = groupShipments([r('6890175291569', 'Classic Blouson', { option_name: 'color=크림, size=XL' }), r('6890175291569', 'Blouse'), r(null, 'Vest')]);
    const h = html.call(ctx, { channel_order_id: 'o1' });
    assert.match(h, /우체국[\s\S]*6890175291569[\s\S]*복사[\s\S]*epost\.go\.kr[^"]*sid1=6890175291569[\s\S]*조회/);
    assert.match(h, /2026-09-23 출고 · 합배송 2개/);
    assert.match(h, /Classic Blouson[\s\S]*크림 · XL[\s\S]*Blouse[\s\S]*미출고 1[\s\S]*Vest/);
    ctx.csShip.o2 = groupShipments([{ channel: 'eland' }]);
    assert.match(html.call(ctx, { channel_order_id: 'o2' }), /송장 정보 없음/);
});

test('목록·상세 연결 — 보이는 행만 RPC · 실패는 그 구역만', async () => {
    const body = src.slice(src.indexOf('    renderCS() {'), src.indexOf('    // ── 법인카드 지출'));
    assert.match(body, /const shown = list\.slice\(0, 300\)/);
    assert.match(body, /shown\.map\(t => t\.channel_order_id\)/);
    assert.match(body, /this\._csShipLine\(t\)/);
    assert.match(src, /\$\{f\('회수·재발송 송장', t\.invoice_no\)\}/, '직원이 넣던 송장은 따로');
    assert.match(src, /\$\{this\._csShipHtml\(t\)\}/);
    //  RPC 1회로 여러 주문 · 이미 받은 것/실패한 것은 다시 안 부름 · 실패하면 err 표시만
    const calls = [];
    const ctx = { requestRender() {}, supabase: { rpc: async (fn, a) => { calls.push([fn, a.p_ids]); return { data: [r('1', 'A', { channel_order_id: 'a' })], error: null }; } } };
    const load = method('_csShipLoad');
    await load.call(Object.assign(ctx, { csShip: undefined }), ['a', 'b', 'a', null]);
    assert.deepEqual(calls, [['cs_order_shipments', ['a', 'b']]]);
    assert.equal(ctx.csShip.a.shipments.length, 1); assert.equal(ctx.csShip.b.none, true);
    await load.call(ctx, ['a', 'b']); assert.equal(calls.length, 1, '이미 받은 건 안 부름');
    const bad = { requestRender() {}, supabase: { rpc: async () => ({ data: null, error: { message: 'x' } }) } };
    await load.call(bad, ['c']);
    assert.equal(bad._csShipErr.c, true); assert.equal(bad.csShip.c, undefined);
    const many = { requestRender() {}, supabase: { rpc: async (fn, a) => { calls.push(a.p_ids.length); return { data: [], error: null }; } } };
    calls.length = 0; await load.call(many, Array.from({ length: 250 }, (_, i) => 'x' + i));
    assert.deepEqual(calls, [200, 50], '200개씩');
});

test('097 cs_order_shipments RPC(PGlite)', { skip: !process.env.PGLITE_PATH && 'PGLITE_PATH 없음 — 건너뜀' }, async () => {
    const { PGlite } = await import(pathToFileURL(process.env.PGLITE_PATH).href);
    const db = new PGlite();
    await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create table channel_orders (id uuid primary key default gen_random_uuid(), channel text, order_id text,
  courier text, invoice_no text, shipped_at timestamptz, raw jsonb);
`);
    const up = read('../supabase/migrations/097_cs_order_shipments.sql');
    await db.exec(up); await db.exec(up);
    const ins = async (channel, raw, extra = {}) => (await db.query(
        `insert into channel_orders (channel, order_id, raw, courier, invoice_no) values ($1,'x',$2,$3,$4) returning id`,
        [channel, raw && JSON.stringify(raw), extra.courier ?? null, extra.invoice_no ?? null])).rows[0].id;
    const it = (tracking_no, product_name, option_value = 'color=크림') => ({ tracking_no, shipping_company_name: tracking_no ? '우체국택배' : '',
        shipped_date: tracking_no ? '2026-09-23T14:15:11+09:00' : '', product_name, option_value, quantity: 1, order_status: 'R40' });
    //  합배송: 1송장 2상품 / 부분출고: 2송장 + 미출고 / 미출고 / 29cm 칸 / 키디키디 없음
    const ids = {
        combo: await ins('cafe24', { items: [it('6890175291569', 'A'), it('6890175291569', 'B')] }),
        part: await ins('cafe24', { items: [it('111', 'A'), it('222', 'B'), it('', 'C')] }),
        none: await ins('cafe24', { items: [it('', 'A')] }),
        c29: await ins('29cm', { items: [{ itemName: 'Lily Blouse', optionValueList: ['[SIZE] M'], orderCount: 2, invoiceNo: '6890158122139',
            deliveryCompanyName: '우체국택배', deliveryStartedAt: '2026-07-27T14:55:25+09:00' }] }),
        c29col: await ins('29cm', null, { courier: '한진택배', invoice_no: '461084615014' }),
        eland: await ins('eland', { orderNo: '202507241209833' }),
    };
    const rpc = async list => (await db.query(`select * from cs_order_shipments($1::uuid[])`, [list])).rows;
    const all = await rpc(Object.values(ids));
    const of = k => all.filter(x => x.channel_order_id === ids[k]);
    const g = k => groupShipments(of(k));

    assert.equal(of('combo').length, 2); assert.equal(g('combo').shipments.length, 1); assert.equal(g('combo').shipments[0].items.length, 2);
    assert.equal(of('combo')[0].courier, '우체국택배'); assert.equal(of('combo')[0].option_name, 'color=크림'); assert.equal(of('combo')[0].quantity, 1);
    assert.equal(g('part').shipments.length, 2); assert.equal(shipSummary(g('part')).text, '우체국 111 외 1'); assert.equal(g('part').unshipped.length, 1);
    assert.equal(shipSummary(g('none')).text, '미출고');
    assert.deepEqual({ ...of('c29')[0], channel_order_id: 0, shipped_date: of('c29')[0].shipped_date.slice(0, 10) }, { channel_order_id: 0, channel: '29cm',
        tracking_no: '6890158122139', courier: '우체국택배', shipped_date: '2026-07-27', product_name: 'Lily Blouse', option_name: '[SIZE] M', quantity: 2 });
    assert.equal(of('c29col').length, 1); assert.equal(of('c29col')[0].tracking_no, '461084615014'); assert.equal(of('c29col')[0].courier, '한진택배');
    assert.equal(of('eland').length, 1, '키디키디는 빈 행 하나'); assert.equal(of('eland')[0].tracking_no, null); assert.equal(g('eland').none, true);

    //  최대 200개 · security invoker · anon 실행 불가
    const big = Array.from({ length: 199 }, () => '00000000-0000-4000-8000-000000000000');
    assert.equal((await rpc([...big, ids.combo, ids.part])).filter(x => x.channel_order_id === ids.part).length, 0, '201번째부터 안 봄');
    const fn = (await db.query(`select prosecdef, provolatile from pg_proc where proname = 'cs_order_shipments'`)).rows[0];
    assert.equal(fn.prosecdef, false, 'security invoker(RLS 그대로)'); assert.equal(fn.provolatile, 's');
    assert.equal((await db.query(`select has_function_privilege('anon', 'cs_order_shipments(uuid[])', 'execute') v`)).rows[0].v, false);
    assert.equal((await db.query(`select has_function_privilege('authenticated', 'cs_order_shipments(uuid[])', 'execute') v`)).rows[0].v, true);

    await db.exec(read('../supabase/rollbacks/097_cs_order_shipments.down.sql'));
    assert.equal((await db.query(`select count(*)::int n from pg_proc where proname = 'cs_order_shipments'`)).rows[0].n, 0);
    await db.close();
});
