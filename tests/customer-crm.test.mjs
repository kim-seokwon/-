import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const a = src.indexOf('    _crmSegments(rows, nowISO) {');
const b = src.indexOf('\n    setCRMBrand(', a);
assert.ok(a > 0 && b > a, '_crmSegments 를 main.js 에서 못 찾음');
const crmSegments = eval('(' + src.slice(a, b).trim().replace('_crmSegments(rows, nowISO)', 'function crmSegments(rows, nowISO)') + ')');

const NOW = '2026-10-18T12:00:00Z';
const at = days => new Date(Date.parse('2026-10-18T00:00:00Z') - days * 864e5).toISOString();
const O = (id, days, member = `m${id}`, extra = {}) => ({
    id, mem: member, buyer_name: `고객${member}`, order_date: at(days), pay_amount: 10000, op_status: 'done', ...extra,
});
const seg = rows => crmSegments(rows, NOW);

test('첫구매 30일 경계: 29일은 제외, 30일은 포함', () => {
    const r = seg([O(1, 29), O(2, 30)]);
    assert.deepEqual(r.segments.first30.map(x => x.member_id), ['m2']);
});

test('첫구매와 휴면90은 89/90일 경계에서 겹치지 않는다', () => {
    const r = seg([O(1, 89), O(2, 90)]);
    assert.deepEqual(r.segments.first30.map(x => x.member_id), ['m1']);
    assert.deepEqual(r.segments.dormant90.map(x => x.member_id), ['m2']);
});

test('휴면 90일 경계: 89일은 제외, 90일은 포함', () => {
    const r = seg([O(1, 89), O(2, 90)]);
    assert.deepEqual(r.segments.dormant90.map(x => x.member_id), ['m2']);
});

test('휴면 180일 경계: 179일은 제외, 180일은 포함', () => {
    const r = seg([O(1, 179), O(2, 180)]);
    assert.deepEqual(r.segments.dormant90.map(x => x.member_id), ['m1']);
    assert.deepEqual(r.segments.dormant180.map(x => x.member_id), ['m2']);
});

test('같은 회원ID 주문은 누적금액·최근 주문일로 합친다', () => {
    const r = seg([O(1, 120, 'same', { pay_amount: 12000 }), O(2, 90, 'same', { pay_amount: 33000 })]);
    const x = r.segments.dormant90[0];
    assert.deepEqual({ id: x.member_id, orders: x.orders, spend: x.spend, last: x.last }, { id: 'same', orders: 2, spend: 45000, last: '2026-07-20' });
});

test('누적금액은 actual_paid_amount 를 pay_amount 보다 우선한다', () => {
    const r = seg([O(1, 90, 'paid', { pay_amount: null, actual_paid_amount: 27000 })]);
    assert.equal(r.segments.dormant90[0].spend, 27000);
});

test('취소·반품·비회원 주문은 CRM 대상에서 제외', () => {
    const r = seg([O(1, 90, 'cancelled', { op_status: 'cancel' }), O(2, 90, 'returned', { op_status: 'return' }), O(3, 90, null)]);
    assert.equal(r.customers, 0);
});

test('VIP 누적 상위 고객은 평소 구매주기 2배가 지나야 이탈 위험', () => {
    const r = seg([O(1, 400, 'vip', { pay_amount: 300000 }), O(2, 300, 'vip', { pay_amount: 300000 }), O(3, 200, 'vip', { pay_amount: 300000 })]);
    assert.deepEqual(r.segments.vipRisk.map(x => x.member_id), ['vip']);
    const notYet = seg([O(1, 399, 'vip'), O(2, 299, 'vip'), O(3, 199, 'vip')]);
    assert.equal(notYet.segments.vipRisk.length, 0);
});

test('지난달 세그먼트 고객의 이후 재구매를 복귀율로 센다', () => {
    const r = seg([
        { id: 1, mem: 'back', buyer_name: '복귀고객', order_date: '2026-06-30T00:00:00Z', pay_amount: 10000, op_status: 'done' },
        { id: 2, mem: 'back', buyer_name: '복귀고객', order_date: '2026-10-02T00:00:00Z', pay_amount: 20000, op_status: 'done' },
    ]);
    assert.deepEqual(r.return_rates.dormant90, { base: 1, returned: 1, rate: 100 });
});

test('최근 주문이 오래돼도 복귀율 계산 결과를 유지한다', () => {
    const stale = seg([O(1, 120), O(2, 1)]);
    assert.ok(stale.return_rates);
    assert.equal(Object.hasOwn(stale, 'data_gap'), false);
});

test('결과에는 전화·이메일 원문이 남지 않는다', () => {
    const r = seg([O(1, 90, 'safe-id', { receiver_phone: '010-1234-5678', email: 'secret@example.com' })]);
    const out = JSON.stringify(r.segments.dormant90);
    assert.equal(out.includes('010-1234-5678'), false);
    assert.equal(out.includes('secret@example.com'), false);
});

test('DB 조회와 CSV 열은 회원ID 중심이며 전화·이메일을 요구하지 않는다', () => {
    const load = src.slice(src.indexOf('    async _loadCRM('), src.indexOf('\n    _retryCRM(', src.indexOf('    async _loadCRM(')));
    assert.equal(/phone|email/i.test(load), false);
    assert.match(src, /\['회원ID', '이름', '마지막 주문일', '누적금액'\]/);
    assert.match(load, /const cafeMalls = brandMalls\.filter/);
});
