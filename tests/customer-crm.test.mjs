//  고객 CRM 탭 — 숫자는 DB repurchase_segments(103, KST)가 만든다. 재구매 쿠폰 미리보기와 같은 SQL(_coupon_member_stats ·
//  coupon_target_match)이라 'CRM 휴면90 = 쿠폰 미리보기 대상'이 된다(반려1-1). 옛 JS _crmSegments(UTC) 경계 사례를 SQL 로 그대로 돌린다.
//  DB 사례는 PGLITE_PATH 가 있을 때만(repurchase-coupon.test.mjs 와 같다). 정적 검사는 항상 돈다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const rd = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const src = rd('../main.js');
const P = process.env.PGLITE_PATH;
const B = 'b0000000-0000-4000-8000-000000000001', STAFF = 'cccccccc-0000-4000-8000-000000000002';
const AS_OF = '2026-10-18';
const at = days => new Date(Date.parse('2026-10-18T00:00:00Z') - days * 864e5).toISOString();

test('CRM 세그먼트(SQL repurchase_segments, KST)', { skip: !P && 'PGLITE_PATH 없음 — 건너뜀' }, async t => {
    const { PGlite } = await import(pathToFileURL(P).href);
    const db = new PGlite();
    await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create schema storage;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;
grant usage on schema auth, storage, public to anon, authenticated, service_role;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, owner_id text, created_at timestamptz default now());`);
    await db.exec(rd('./fixtures/rls-snapshot-1028.sql'));
    await db.exec('alter table brands add primary key (id);');
    await db.exec(`
      insert into brands (id, name) values ('${B}', '하이헤이호');
      insert into companies (id, name, role, username, brand_access) values ('${STAFF}', '직원', 'STAFF', 'staff', array['${B}'::uuid]);
      insert into malls (mall_key, label, channel, brand_id, active) values ('hh', '하이헤이호', 'cafe24', '${B}', true);`);
    await db.exec(rd('../supabase/migrations/103_repurchase_coupon.sql'));
    await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ role: 'authenticated', sub: STAFF, email: 'staff@bhas.com' })]);

    let n = 0;
    const O = (days, member, x = {}) => ({ days, member, x });
    const seg = async rows => {
        await db.exec('reset role; truncate channel_orders;');
        for (const { days, member, x } of rows) await db.query(
            `insert into channel_orders (channel, order_id, order_date, buyer_name, receiver_phone, pay_amount, actual_paid_amount, op_status, mall_key, raw)
             values ('cafe24', $1, $2, $3, $4, $5, $6, $7, 'hh', $8)`,
            [`o${++n}`, x.at || at(days), `고객${member}`, x.phone || null, 'pay_amount' in x ? x.pay_amount : 10000, x.actual_paid_amount ?? null,
                x.op_status || 'done', JSON.stringify(member == null ? {} : { member_id: member, email: x.email })]);
        await db.exec('set role authenticated');
        try { return (await db.query(`select repurchase_segments($1, $2) s`, [B, AS_OF])).rows[0].s; } finally { await db.exec('reset role'); }
    };
    const ids = list => list.map(x => x.member_id);

    await t.test('첫구매 30일 경계: 29일은 제외, 30일은 포함', async () => {
        assert.deepEqual(ids((await seg([O(29, 'm1'), O(30, 'm2')])).segments.first30), ['m2']);
    });
    await t.test('첫구매와 휴면90은 89/90일 경계에서 겹치지 않는다', async () => {
        const r = await seg([O(89, 'm1'), O(90, 'm2')]);
        assert.deepEqual(ids(r.segments.first30), ['m1']);
        assert.deepEqual(ids(r.segments.dormant90), ['m2']);
    });
    await t.test('휴면 180일 경계: 179일은 휴면90, 180일은 휴면180', async () => {
        const r = await seg([O(179, 'm1'), O(180, 'm2')]);
        assert.deepEqual(ids(r.segments.dormant90), ['m1']);
        assert.deepEqual(ids(r.segments.dormant180), ['m2']);
    });
    await t.test('같은 회원ID 주문은 누적금액·최근 주문일로 합친다', async () => {
        const x = (await seg([O(120, 'same', { pay_amount: 12000 }), O(90, 'same', { pay_amount: 33000 })])).segments.dormant90[0];
        assert.deepEqual({ id: x.member_id, orders: x.orders, spend: Number(x.spend), last: x.last }, { id: 'same', orders: 2, spend: 45000, last: '2026-07-20' });
    });
    await t.test('누적금액은 actual_paid_amount 를 pay_amount 보다 우선한다', async () => {
        assert.equal(Number((await seg([O(90, 'paid', { pay_amount: null, actual_paid_amount: 27000 })])).segments.dormant90[0].spend), 27000);
    });
    await t.test('취소·반품·비회원 주문은 CRM 대상에서 제외', async () => {
        assert.equal((await seg([O(90, 'c', { op_status: 'cancel' }), O(90, 'r', { op_status: 'return' }), O(90, null)])).customers, 0);
    });
    await t.test('VIP 누적 상위 고객은 평소 구매주기 2배가 지나야 이탈 위험', async () => {
        const v = { pay_amount: 300000 };
        assert.deepEqual(ids((await seg([O(400, 'vip', v), O(300, 'vip', v), O(200, 'vip', v)])).segments.vipRisk), ['vip']);
        assert.equal((await seg([O(399, 'vip', v), O(299, 'vip', v), O(199, 'vip', v)])).segments.vipRisk.length, 0);
    });
    await t.test('지난달 말 세그먼트 고객의 이후 재구매를 복귀율로 센다', async () => {
        const r = await seg([O(0, 'back', { at: '2026-06-30T00:00:00Z' }), O(0, 'back', { at: '2026-10-02T00:00:00Z', pay_amount: 20000 })]);
        assert.equal(r.previous_month_end, '2026-09-30');
        assert.deepEqual(r.return_rates.dormant90, { base: 1, returned: 1, rate: 1 * 100 });
    });
    await t.test('KST 기준: UTC 로는 전날인 주문(10/17 15:30Z = KST 10/18 00:30)은 KST 날짜로 센다', async () => {
        const r = await seg([O(0, 'k', { at: '2026-07-19T15:30:00Z' })]);   // KST 7/20 → 90일
        assert.deepEqual(ids(r.segments.dormant90), ['k']);
        assert.equal(r.segments.dormant90[0].gone_days, 90);
    });
    await t.test('결과에는 전화·이메일 원문이 남지 않는다', async () => {
        const out = JSON.stringify(await seg([O(90, 'safe-id', { phone: '010-1234-5678', email: 'secret@example.com' })]));
        assert.equal(out.includes('010-1234-5678') || out.includes('01012345678'), false);
        assert.equal(out.includes('secret@example.com'), false);
    });
});

test('정적: CRM 탭은 DB repurchase_segments 만 쓰고 전화·이메일을 요구하지 않는다', () => {
    assert.equal(src.includes('_crmSegments'), false, '옛 JS(UTC) 집계가 남아 있음');
    const s = src.indexOf('    async _loadCRM('), e = src.indexOf('\n    _retryCRM(', s);
    assert.ok(s > 0 && e > s, '_loadCRM 을 못 찾음');
    const load = src.slice(s, e);
    assert.match(load, /rpc\('repurchase_segments'/);
    assert.equal(/channel_orders/.test(load), false, '주문 원본을 화면에서 다시 집계하지 않는다');
    assert.equal(/phone|email/i.test(load), false);
    assert.match(load, /const cafeMalls = brandMalls\.filter/);
    assert.match(src, /\['회원ID', '이름', '마지막 주문일', '누적금액'\]/);
});
