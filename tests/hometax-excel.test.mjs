import test from 'node:test';
import assert from 'node:assert/strict';
import { quoteToRow, buildRows, HOMETAX_COLS, xlsxBytes, MAX_PER_BATCH } from '../hometaxExcel.js';

const q = (o = {}) => ({ id: 'a', client_name: '테스트상사', client_biz_no: '012-34-56789', client_ceo: '홍길동', client_email: 'x@y.z',
    quote_date: '2026-10-05', status: 'confirmed', supply_amount: 300000, tax_amount: 30000,
    items: [{ name: '샘플', spec: 'L', qty: 2, price: 100000, tax: 20000 }, { name: '패턴', qty: 1, price: 100000, tax: 10000 }], ...o });

test('정상 견적 → 59열 1행, 등록번호·일자 문자, 합계 일치', () => {
    const { row, errors } = quoteToRow(q());
    assert.deepEqual(errors, []);
    assert.equal(row.length, HOMETAX_COLS.length);
    assert.equal(row[0], '01'); assert.equal(row[1], '20261005'); assert.equal(row[10], '0123456789');
    assert.equal(row[19], 300000); assert.equal(row[20], 30000);
    assert.deepEqual(row.slice(22, 30), ['05', '샘플', 'L', 2, 100000, 200000, 20000, '']);
    assert.equal(row[30 + 1], '패턴'); assert.equal(row.at(-1), '02');
});
test('막아야 할 것: 사업자번호·대표자 없음, 5품목, 합계 불일치, 발행됨', () => {
    assert.match(quoteToRow(q({ client_biz_no: '123' })).errors.join(), /사업자번호/);
    assert.match(quoteToRow(q({ client_ceo: '' })).errors.join(), /대표자/);
    const five = Array.from({ length: 5 }, () => ({ name: 'a', qty: 1, price: 1, tax: 0 }));
    assert.match(quoteToRow(q({ items: five, supply_amount: 5, tax_amount: 0 })).errors.join(), /4개까지/);
    assert.match(quoteToRow(q({ supply_amount: 1 })).errors.join(), /공급가/);
    assert.match(quoteToRow(q({ tax_status: 'issued' })).errors.join(), /발행됨/);
});
test('buildRows 는 오류 건을 빼고 사유를 돌려준다 · 영수 01', () => {
    const r = buildRows([q(), q({ id: 'b', client_biz_no: '' })], { purpose: '01' });
    assert.equal(r.rows.length, 1); assert.equal(r.skipped[0].q.id, 'b'); assert.equal(r.rows[0].at(-1), '01');
});
test('xlsx 바이트는 zip(PK) 시그니처', () => {
    const b = xlsxBytes([quoteToRow(q()).row]);
    assert.equal(b[0], 0x50); assert.equal(b[1], 0x4b);
});
test('회당 50건: 50건은 전부, 51건은 51번째를 skipped(회당 50건 초과)', () => {
    const many = n => Array.from({ length: n }, (_, i) => q({ id: 'q' + i }));
    assert.equal(MAX_PER_BATCH, 50);
    const a = buildRows(many(50));
    assert.equal(a.rows.length, 50); assert.equal(a.skipped.length, 0);
    const b = buildRows(many(51));
    assert.equal(b.rows.length, 50); assert.equal(b.skipped.length, 1);
    assert.equal(b.skipped[0].q.id, 'q50'); assert.match(b.skipped[0].errors.join(), /회당 50건 초과/);
    // 오류 건은 50건 셈에 안 들어간다
    const c = buildRows([q({ id: 'bad', client_ceo: '' }), ...many(50)]);
    assert.equal(c.rows.length, 50); assert.equal(c.skipped.length, 1); assert.match(c.skipped[0].errors.join(), /대표자/);
});
