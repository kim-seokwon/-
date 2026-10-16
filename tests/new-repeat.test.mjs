// 홈 '신규/재구매' 분류(_loadNewRepeat) 회귀 테스트 — main.js 함수를 직접 떼어 가짜 DB 위에서 돌린다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const a = src.indexOf('    async _loadNewRepeat() {');
const b = src.indexOf('\n    }\n', a) + 6;
assert.ok(a > 0, '_loadNewRepeat 를 main.js 에서 못 찾음');
const fn = eval('(' + src.slice(a, b).replace('async _loadNewRepeat()', 'async function _loadNewRepeat()').trim() + ')');

const mkSb = rows => ({ from: () => { const f = []; let lo = 0, hi = 1e9; const q = {
    select: () => q,
    gte: (c, v) => (f.push(o => o[c] != null && o[c] >= v), q),
    lt: (c, v) => (f.push(o => o[c] != null && o[c] < v), q),
    in: (c, vs) => (f.push(o => vs.includes(o[c])), q),
    order: () => q, range: (x, y) => (lo = x, hi = y, q),
    then: res => {
        const d = rows.filter(o => f.every(g => g(o))).sort((x, y) => x.order_date < y.order_date ? -1 : x.order_date > y.order_date ? 1 : x.id - y.id);
        res({ data: d.slice(lo, Math.min(hi + 1, lo + 1000)), error: null });
    }
}; return q; } });
const run = async rows => {
    const t = { supabase: mkSb(rows), _isCancelled: o => ['cancel', 'return'].includes(o.op_status), requestRender() {} };
    await fn.call(t);
    return t._newRepeat;
};
const now = new Date();
const d = (m, day) => new Date(now.getFullYear(), now.getMonth() + m, day, 12).toISOString();
const O = (id, date, x) => ({ id, order_date: date, pay_amount: 1000, op_status: 'done', channel: 'cafe24', ...x });

test('다음 달 주문은 이번 달에 안 들어간다', async () => {
    const r = await run([O(1, d(0, 5), { receiver_phone: '010-1000-0001' }), O(2, d(1, 1), { receiver_phone: '010-1000-0002' })]);
    assert.equal(r.total, 1);
});

for (const [name, past, cur] of [
    ['숫자만 ↔ 3-4-4', '01011112222', '010-1111-2222'],
    ['3-4-4 ↔ 숫자만', '010-1111-2222', '01011112222'],
    ['3-3-4 (10자리)', '011-111-2222', '0111112222'],
    ['02-4-4', '02-1234-5678', '0212345678'],
    ['02-3-4 (9자리)', '02-123-4567', '021234567'],
]) {
    test(`전화 표기가 달라도 같은 사람 — ${name}`, async () => {
        const r = await run([O(1, d(-1, 10), { receiver_phone: past }), O(2, d(0, 5), { receiver_phone: cur })]);
        assert.deepEqual([r.neu, r.rep], [0, 1]);
    });
}

test('과거엔 전화 있음 + 지금은 주문자명만 → 재구매', async () => {
    const r = await run([O(1, d(-1, 10), { receiver_phone: '010-3333-4444', buyer_name: '가나다' }), O(2, d(0, 5), { buyer_name: '가나다' })]);
    assert.deepEqual([r.neu, r.rep], [0, 1]);
});

test('같은 달 첫 주문은 신규, 다음 주문은 재구매', async () => {
    const r = await run([O(1, d(0, 2), { receiver_phone: '010-5555-0000' }), O(2, d(0, 3), { receiver_phone: '010-5555-0000' })]);
    assert.deepEqual([r.total, r.neu, r.rep], [2, 1, 1]);
});

test('취소·반품은 빼고, 식별 정보 없는 주문은 미분류', async () => {
    const r = await run([
        O(1, d(0, 2), { receiver_phone: '010-6666-0000' }),
        O(2, d(0, 4), { op_status: 'cancel', receiver_phone: '010-7777-0000' }),
        O(3, d(0, 4), { op_status: 'return', receiver_phone: '010-8888-0000' }),
        O(4, d(0, 6), {}),
    ]);
    assert.deepEqual([r.total, r.neu, r.rep, r.unk], [2, 1, 0, 1]);
});

test('과거 주문이 취소였으면 재구매로 안 친다', async () => {
    const r = await run([O(1, d(-1, 10), { op_status: 'cancel', receiver_phone: '010-9999-0000' }), O(2, d(0, 5), { receiver_phone: '010-9999-0000' })]);
    assert.deepEqual([r.neu, r.rep], [1, 0]);
});
