//  텔레그램 운영 보고서 — 네트워크 없이 fetch 를 흉내 내 보고서 글을 만든다.
//  가짜 PostgREST 는 운영 칸 목록(001·004·030·035·036 마이그레이션)에 없는 칸을 고르면 진짜처럼 400 을 준다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { build, orderAmount, md } from '../channel-bots/telegram/report.mjs';

const COLS = {
  channel_orders: ['id', 'channel', 'order_id', 'order_date', 'pay_amount', 'status', 'mall_key', 'order_amount', 'actual_paid_amount', 'refund_amount'],
  sync_log: ['id', 'run_at', 'channel', 'type', 'result', 'detail'],
  reminders: ['id', 'title', 'due_date', 'done', 'assignee'],
  cs_tickets: ['id', 'status'],
};
const NOW = new Date('2026-10-23T00:00:00Z');            // KST 10-23 09:00

function fakeRest(data, calls = []) {
  return async (u, opt) => {
    const url = new URL(u);
    calls.push({ url, opt });
    const table = url.pathname.split('/').pop();
    const sel = (url.searchParams.get('select') || '').split(',');
    const filt = [...url.searchParams.keys()].filter(k => !['select', 'order', 'limit'].includes(k));
    const bad = [...sel, ...filt].find(c => !COLS[table]?.includes(c));
    if (bad) return new Response(JSON.stringify({ code: '42703', message: `column ${table}.${bad} does not exist` }), { status: 400 });
    let rows = data[table] || [];
    if (table === 'channel_orders' && url.searchParams.get('status')) rows = rows.filter(o => ['new', 'ready'].includes(o.status));
    const lim = Number(url.searchParams.get('limit') || rows.length);
    return new Response(JSON.stringify(rows.slice(0, lim)), { status: 200, headers: { 'content-range': `0-${Math.max(0, Math.min(lim, rows.length) - 1)}/${rows.length}` } });
  };
}

const DATA = {
  channel_orders: [
    { order_id: 'A1', mall_key: 'smart_store', order_amount: 59000, pay_amount: 59000, status: 'new' },
    { order_id: 'A2', mall_key: 'smart_store', order_amount: '41000', pay_amount: 41000, status: 'done' },  // numeric 문자열
    { order_id: 'A3', mall_key: 'cafe24', order_amount: 0, pay_amount: 30000, status: 'ready' },          // 옛 수집분
  ],
  sync_log: [{ run_at: '2026-10-22T23:40:00Z', channel: 'cafe24', type: 'pull_orders', result: 'ok' }],
  reminders: [{ title: '샘플 발송', due_date: '2026-10-22', done: false }, { title: '정산_확인', due_date: '2026-10-23', done: false }],
  cs_tickets: [{ id: 1, status: '접수' }],
};

test('실제 칸으로 주문금액·최근수집이 오류문구 없이 나온다', async () => {
  const calls = [];
  const text = await build({ url: 'https://x.supabase.co', key: 'k', fetch: fakeRest(DATA, calls), now: NOW });
  assert.doesNotMatch(text, /못 읽음|does not exist/);
  assert.match(text, /\*어제 주문\* 3건 · 130,000원/);
  assert.match(text, /smart\\_store 2건/, '몰 키 밑줄은 이스케이프');
  assert.match(text, /📦 \*출고 대기\* 2건/);
  assert.match(text, /\*오늘까지 할 일\* 2건/);
  assert.match(text, /샘플 발송 ⚠️지연/);
  assert.match(text, /정산\\_확인/);
  assert.match(text, /🔁 \*CS 진행 중\* 1건/);
  assert.match(text, /🔌 마지막 수집 20분 전 \(cafe24 pull\\_orders\)$/m);
  //  어제 = KST 10-22 00:00 ~ 10-23 00:00
  const q = calls[0].url.searchParams.getAll('order_date');
  assert.deepEqual(q, ['gte.2026-10-22T00:00:00+09:00', 'lt.2026-10-23T00:00:00+09:00']);
  assert.equal(calls[0].opt.headers.Authorization, 'Bearer k');
  assert.ok(calls.every(c => c.url.origin === 'https://x.supabase.co'), '텔레그램 등 외부로 안 나간다');
});

test('옛 쿼리(total_amount · job,ok)는 가짜 PostgREST 에서 400 — 이번 수정이 잡는 불일치', async () => {
  const f = fakeRest(DATA);
  assert.equal((await f('https://x/rest/v1/channel_orders?select=order_id,total_amount')).status, 400);
  assert.equal((await f('https://x/rest/v1/sync_log?select=run_at,job,ok')).status, 400);
});

test('수집 실패·오래 멈춤은 경고로, 읽기 실패는 못 읽음으로', async () => {
  const d = { ...DATA, sync_log: [{ run_at: '2026-10-22T20:00:00Z', channel: 'cafe24', type: 'pull_orders', result: 'error' }] };
  const t1 = await build({ url: 'https://x', key: 'k', fetch: fakeRest(d), now: NOW });
  assert.match(t1, /240분 전 \(cafe24 pull\\_orders · error\) ⚠️ 멈춘 듯/);
  const t2 = await build({ url: 'https://x', key: 'k', fetch: fakeRest({ ...DATA, sync_log: [] }), now: NOW });
  assert.match(t2, /수집 기록 없음/);
  const down = async () => new Response('boom', { status: 503 });
  const t3 = await build({ url: 'https://x', key: 'k', fetch: down, now: NOW });
  assert.match(t3, /주문: 못 읽음 \(channel\\_orders → 503 boom\)/);
  assert.match(t3, /수집: 못 읽음/);
});

test('orderAmount · md', () => {
  assert.equal(orderAmount({ order_amount: 0, pay_amount: '1200' }), 1200);
  assert.equal(orderAmount({ order_amount: null, pay_amount: null }), 0);
  assert.equal(md('a_b*c`d[e'), 'a\\_b\\*c\\`d\\[e');
});
