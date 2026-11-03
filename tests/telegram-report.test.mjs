//  텔레그램 운영 보고서 — 네트워크 없이 fetch 를 흉내 내 보고서 글을 만든다.
//  가짜 PostgREST 는 운영 칸 목록(001·004·030·035·036 마이그레이션)에 없는 칸을 고르면 진짜처럼 400 을 준다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { build, orderAmount, md } from '../channel-bots/telegram/report.mjs';

const COLS = {
  channel_orders: ['id', 'channel', 'order_id', 'order_date', 'pay_amount', 'status', 'mall_key', 'order_amount', 'actual_paid_amount', 'refund_amount', 'op_status'],
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
    const filt = [...url.searchParams.keys()].filter(k => !['select', 'order', 'limit', 'or'].includes(k));
    const orCols = [...(url.searchParams.get('or') || '').matchAll(/(?:^\(|,)(\w+)\./g)].map(m => m[1]);
    const bad = [...sel, ...filt, ...orCols].find(c => !COLS[table]?.includes(c));
    if (bad) return new Response(JSON.stringify({ code: '42703', message: `column ${table}.${bad} does not exist` }), { status: 400 });
    //  이 보고서가 쓰는 필터만 흉내 낸다(eq · like · 유효주문 or). 날짜 범위는 데이터가 이미 그 범위라 건너뛴다.
    let rows = data[table] || [];
    for (const [k, v] of url.searchParams) {
      if (v.startsWith('eq.')) rows = rows.filter(r => String(r[k]) === v.slice(3));
      if (v.startsWith('like.')) { const re = new RegExp('^' + v.slice(5).replace(/\*/g, '.*') + '$'); rows = rows.filter(r => re.test(r[k] || '')); }
      if (k === 'or' && v === '(op_status.is.null,op_status.not.in.(cancel,return))') rows = rows.filter(r => r.op_status == null || !['cancel', 'return'].includes(r.op_status));
    }
    const lim = Number(url.searchParams.get('limit') || rows.length);
    return new Response(JSON.stringify(rows.slice(0, lim)), { status: 200, headers: { 'content-range': `0-${Math.max(0, Math.min(lim, rows.length) - 1)}/${rows.length}` } });
  };
}

const DATA = {
  channel_orders: [
    //  운영처럼 status 는 전부 new — 출고 대기는 op_status='pre' 로만 센다
    { order_id: 'A1', mall_key: 'smart_store', order_amount: 59000, pay_amount: 59000, status: 'new', op_status: 'pre' },
    { order_id: 'A2', mall_key: 'smart_store', order_amount: '41000', pay_amount: 41000, status: 'new', op_status: 'done' },  // numeric 문자열
    { order_id: 'A3', mall_key: 'cafe24', order_amount: 0, pay_amount: 30000, status: 'new', op_status: null },               // 옛 수집분
    { order_id: 'C1', mall_key: 'cafe24', order_amount: 99000, pay_amount: 99000, status: 'new', op_status: 'cancel' },      // 빠져야 함
    { order_id: 'R1', mall_key: 'cafe24', order_amount: 77000, pay_amount: 77000, status: 'new', op_status: 'return' },      // 빠져야 함
  ],
  //  맨 위가 뉴스 skipped 여도 주문 수집(pull_orders)을 본다
  sync_log: [
    { run_at: '2026-10-22T23:55:00Z', channel: 'news', type: 'apify:ig', result: 'skipped' },
    { run_at: '2026-10-22T23:50:00Z', channel: 'instagram', type: 'ig:competitors', result: 'error' },
    { run_at: '2026-10-22T23:40:00Z', channel: 'cafe24', type: 'hiheiho:pull_orders', result: 'ok' },
  ],
  reminders: [{ title: '샘플 발송', due_date: '2026-10-22', done: false }, { title: '정산_확인', due_date: '2026-10-23', done: false }],
  cs_tickets: [{ id: 1, status: '접수' }],
};

test('실제 칸으로 주문금액·최근수집이 오류문구 없이 나온다', async () => {
  const calls = [];
  const text = await build({ url: 'https://x.supabase.co', key: 'k', fetch: fakeRest(DATA, calls), now: NOW });
  assert.doesNotMatch(text, /못 읽음|does not exist/);
  assert.match(text, /\*어제 주문\* 3건 · 130,000원/);
  assert.match(text, /smart\\_store 2건/, '몰 키 밑줄은 이스케이프');
  assert.match(text, /📦 \*출고 대기\* 1건/, 'status=new 전체가 아니라 op_status=pre 만');
  assert.match(text, /\*오늘까지 할 일\* 2건/);
  assert.match(text, /샘플 발송 ⚠️지연/);
  assert.match(text, /정산\\_확인/);
  assert.match(text, /🔁 \*CS 진행 중\* 1건/);
  assert.match(text, /🔌 마지막 수집 20분 전 \(cafe24 hiheiho:pull\\_orders\)$/m);
  assert.match(text, /⚠️ 24시간 수집 오류 1건 · 종류별 instagram ig:competitors 1/);
  //  어제 = KST 10-22 00:00 ~ 10-23 00:00
  const q = calls[0].url.searchParams.getAll('order_date');
  assert.deepEqual(q, ['gte.2026-10-22T00:00:00+09:00', 'lt.2026-10-23T00:00:00+09:00']);
  assert.equal(calls[0].opt.headers.apikey, 'k');
  assert.ok(calls.every(c => !('Authorization' in c.opt.headers)), '새 sb_secret 키는 Bearer 로 안 보낸다');
  assert.ok(calls.every(c => c.url.origin === 'https://x.supabase.co'), '텔레그램 등 외부로 안 나간다');
});

test('옛 쿼리(total_amount · job,ok)는 가짜 PostgREST 에서 400 — 이번 수정이 잡는 불일치', async () => {
  const f = fakeRest(DATA);
  assert.equal((await f('https://x/rest/v1/channel_orders?select=order_id,total_amount')).status, 400);
  assert.equal((await f('https://x/rest/v1/sync_log?select=run_at,job,ok')).status, 400);
});

test('수집 실패·오래 멈춤은 경고로, 읽기 실패는 못 읽음으로', async () => {
  const d = { ...DATA, sync_log: [{ run_at: '2026-10-22T20:00:00Z', channel: 'cafe24', type: 'pull_orders', result: 'error' }] };
  //  (오류 1건이라 24시간 오류 줄도 같이 나온다)
  const t1 = await build({ url: 'https://x', key: 'k', fetch: fakeRest(d), now: NOW });
  assert.match(t1, /240분 전 \(cafe24 pull\\_orders · error\) ⚠️ 멈춘 듯/);
  const t2 = await build({ url: 'https://x', key: 'k', fetch: fakeRest({ ...DATA, sync_log: [] }), now: NOW });
  assert.match(t2, /수집 기록 없음/);
  const down = async () => new Response('boom', { status: 503 });
  const t3 = await build({ url: 'https://x', key: 'k', fetch: down, now: NOW });
  assert.match(t3, /주문: 못 읽음 \(channel\\_orders → 503 boom\)/);
  assert.match(t3, /수집: 못 읽음/);
  //  (반려1-③) 어느 항목이 실패해도 조용히 사라지지 않는다
  for (const k of ['출고 대기: 못 읽음', '할 일: 못 읽음', 'CS: 못 읽음', '24시간 수집 오류: 못 읽음']) assert.ok(t3.includes(k), k);
});

test('orderAmount · md', () => {
  assert.equal(orderAmount({ order_amount: 0, pay_amount: '1200' }), 1200);
  assert.equal(orderAmount({ order_amount: null, pay_amount: null }), 0);
  assert.equal(md('a_b*c`d[e'), 'a\\_b\\*c\\`d\\[e');
});

test('(반려1-②) 24시간 오류 수는 전체 건수, 종류 요약은 최근 200건 기준이라고 밝힌다', async () => {
  const errs = Array.from({ length: 250 }, (_, i) => ({ run_at: '2026-10-22T23:00:00Z', channel: i < 230 ? 'instagram' : 'cafe24', type: i < 230 ? 'ig:competitors' : 'hh:members', result: 'error' }));
  const d = { ...DATA, sync_log: [...DATA.sync_log, ...errs] };
  const text = await build({ url: 'https://x', key: 'k', fetch: fakeRest(d), now: NOW });
  assert.match(text, /⚠️ 24시간 수집 오류 251건 · 최근 200건 기준 instagram ig:competitors 200/);
});

test('(반려1-③) 한 항목만 실패하면 그 항목만 못 읽음, 나머지는 정상', async () => {
  const ok = fakeRest(DATA);
  const f = async (u, o) => (new URL(u).pathname.endsWith('/cs_tickets') ? new Response('denied', { status: 401 }) : ok(u, o));
  const text = await build({ url: 'https://x', key: 'k', fetch: f, now: NOW });
  assert.match(text, /🔁 CS: 못 읽음 \(cs\\_tickets → 401 denied\)/);
  assert.match(text, /\*어제 주문\* 3건/);
  assert.equal((text.match(/못 읽음/g) || []).length, 1);
});

test('(반려1-①) 워크플로: 등록 전 정기 실행은 건너뜀, 돌면 secret 없을 때 빨간 실패(초록 성공 아님)', async () => {
  const fs = await import('node:fs');
  const y = fs.readFileSync(new URL('../.github/workflows/telegram-report.yml', import.meta.url), 'utf8');
  assert.match(y, /if: \$\{\{ vars\.TELEGRAM_READY == 'true' \|\| github\.event_name == 'workflow_dispatch' \}\}/);
  assert.match(y, /::error::TELEGRAM_BOT_TOKEN[^\n]*\n\s*exit 1/);
  assert.doesNotMatch(y, /::notice::|ready=false/, '안내만 남기고 성공으로 끝나는 길이 없어야 한다');
});
