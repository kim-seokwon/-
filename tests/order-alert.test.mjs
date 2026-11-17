//  주문 수집 알림 — 규칙(orderAlerts.js)과 스크립트(order-alert.mjs)를 네트워크 없이.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { syncHealth, zeroDrop, isWeekend, dailyCounts, evaluate, alertMessage, errorText, kstDay, addDays, parseSyncType } from '../orderAlerts.js';
import { run, table } from '../channel-bots/telegram/order-alert.mjs';

const NOW = Date.parse('2026-11-17T03:00:00Z');          // 11-17 12:00 KST
const ago = h => new Date(NOW - h * 3600e3).toISOString();
const L = (mk, h, result, kind = 'pull_orders', detail = null) => ({ run_at: ago(h), type: `${mk}:${kind}`, result, detail });

// ── ① 연속 실패 ──
test('실패 1회는 주의(알림 없음), 2회부터 끊김', () => {
    const one = syncHealth([L('29cm', 1, 'error'), L('29cm', 25, 'ok')], { channel: '29cm', now: NOW });
    assert.equal(one.state, 'warn'); assert.equal(one.rule, null); assert.equal(one.failStreak, 1);
    const two = syncHealth([L('29cm', 1, 'error'), L('29cm', 25, 'error'), L('29cm', 49, 'ok')], { channel: '29cm', now: NOW });
    assert.equal(two.state, 'down'); assert.equal(two.rule, 'fail'); assert.equal(two.failStreak, 2);
});
test('연속은 최근부터 센다 — 사이에 성공이 끼면 끊긴다(순서 섞여 들어와도)', () => {
    const h = syncHealth([L('29cm', 49, 'error'), L('29cm', 1, 'error'), L('29cm', 25, 'ok'), L('29cm', 73, 'error')], { channel: '29cm', now: NOW });
    assert.equal(h.failStreak, 1); assert.equal(h.state, 'warn');
});
test('11-10~16 실측 모양 — 7회 연속 invalid_grant 면 fail, 사유 표시', () => {
    const logs = [1, 25, 49, 73, 97, 121, 145].map(h => L('29cm', h, 'error', 'pull_orders', { error: 'invalid_grant' }));
    logs.push(L('29cm', 169, 'ok'));
    const h = syncHealth(logs, { channel: '29cm', now: NOW });
    assert.equal(h.rule, 'fail'); assert.equal(h.failStreak, 7); assert.equal(h.lastError, 'invalid_grant');
});
test('카페24 는 실패를 ":error" 로 남긴다 — 그것도 실패로 센다. warn·dry_run·다른 type 은 건너뛴다', () => {
    const h = syncHealth([
        L('hiheiho', 0.1, 'error', 'error'), L('hiheiho', 0.2, 'warn', 'pull_orders'),
        { run_at: ago(0.25), type: 'hiheiho:push_inventory', result: 'dry_run' },
        L('hiheiho', 0.3, 'error', 'error'), L('hiheiho', 0.5, 'ok'),
    ], { channel: 'cafe24', now: NOW });
    assert.equal(h.failStreak, 2); assert.equal(h.rule, 'fail');
    assert.equal(parseSyncType('hiheiho:push_inventory'), null);
});

// ①' 멈춤
test('실패 기록 없이 멈춤 — 하루 채널은 26h 까지 정상, 52h 넘으면 stale', () => {
    assert.equal(syncHealth([L('kidikidi', 25, 'ok')], { channel: 'eland', now: NOW }).state, 'ok');
    assert.equal(syncHealth([L('kidikidi', 30, 'ok')], { channel: 'eland', now: NOW }).state, 'warn');
    const s = syncHealth([L('kidikidi', 53, 'ok')], { channel: 'eland', now: NOW });
    assert.equal(s.state, 'down'); assert.equal(s.rule, 'stale');
});
test('카페24(10분 크론)는 2h 넘으면 주의, 4h 넘으면 stale', () => {
    assert.equal(syncHealth([L('rohi', 3, 'ok')], { channel: 'cafe24', now: NOW }).state, 'warn');
    assert.equal(syncHealth([L('rohi', 5, 'ok')], { channel: 'cafe24', now: NOW }).rule, 'stale');
});
test('범위 밖 마지막 성공(lastOkAt)도 쓴다 · 기록이 아예 없으면 none(알림 없음)', () => {
    assert.equal(syncHealth([], { channel: '29cm', now: NOW, lastOkAt: ago(2) }).state, 'ok');
    const n = syncHealth([], { channel: '29cm', now: NOW });
    assert.equal(n.state, 'none'); assert.equal(n.rule, null);
});
test('실패 사유는 숫자열을 가리고 80자로 자른다', () => {
    assert.equal(errorText({ error: 'token 123456789 rejected' }), 'token **** rejected');
    assert.equal(errorText(null), '');
    assert.ok(errorText({ error: 'x'.repeat(200) }).length <= 80);
});

// ── ② 0건 경계 ──
const TODAY = '2026-11-17';
const counts = (base, d2, d1, extra = {}) => {
    const c = { [addDays(TODAY, -2)]: d2, [addDays(TODAY, -1)]: d1, ...extra };
    base.forEach((n, i) => { c[addDays(TODAY, -3 - i)] = n; });
    return c;
};
test('직전 7일 합 7건(평균 정확히 1.0) + 2일 0건 → 알림', () => {
    const z = zeroDrop(counts([1, 1, 1, 1, 1, 1, 1], 0, 0), TODAY);
    assert.equal(z.hit, true); assert.equal(z.avg, 1);
    assert.deepEqual(z.zeroDays, ['2026-11-15', '2026-11-16']); assert.equal(z.baseFrom, '2026-11-08'); assert.equal(z.baseTo, '2026-11-14');
});
test('주말 평균 0.5(11-08 일요일 0건) → 11-15(일) 0건은 평소대로라 알림 없음', () => {
    assert.equal(zeroDrop(counts([1, 1, 1, 1, 1, 1, 0], 0, 0), TODAY).hit, false);
});
//  반려1 ② 주말 오탐 — 0건인 날의 평일/주말 평균으로 본다
test('평일에만 팔리는 몰: 토·일 0건은 알림 없음, 평일 이틀 0건은 알림', () => {
    const MON = '2026-11-16';   // 0건 판정일 = 11-14(토)·11-15(일)
    const weekdayOnly = {}; for (let i = 3; i <= 9; i++) { const d = addDays(MON, -i); weekdayOnly[d] = isWeekend(d) ? 0 : 4; }
    const z = zeroDrop(weekdayOnly, MON);
    assert.equal(z.hit, false); assert.deepEqual(z.expected, [0, 0]); assert.equal(z.avgWeekday, 4);
    const WED = '2026-11-18';   // 0건 판정일 = 11-16(월)·11-17(화)
    const w2 = {}; for (let i = 3; i <= 9; i++) { const d = addDays(WED, -i); w2[d] = isWeekend(d) ? 0 : 4; }
    assert.equal(zeroDrop(w2, WED).hit, true);
});
test('0건이 1일뿐이면 알림 없음(그제 1건·어제 0건 / 그제 0건·어제 1건)', () => {
    assert.equal(zeroDrop(counts([5, 5, 5, 5, 5, 5, 5], 1, 0), TODAY).hit, false);
    assert.equal(zeroDrop(counts([5, 5, 5, 5, 5, 5, 5], 0, 1), TODAY).hit, false);
});
test('오늘(덜 끝난 날) 주문과 8일 전보다 오래된 주문은 안 센다', () => {
    const z = zeroDrop(counts([0, 0, 0, 0, 0, 0, 0], 0, 0, { [TODAY]: 50, [addDays(TODAY, -10)]: 50 }), TODAY);
    assert.equal(z.hit, false); assert.equal(z.avg, 0);
});
test('주문 날짜는 KST 로 자른다 — 11-15 15:30Z 는 11-16', () => {
    assert.equal(kstDay('2026-11-15T15:30:00Z'), '2026-11-16');
    assert.equal(kstDay('2026-11-15T14:59:00Z'), '2026-11-15');
    assert.deepEqual(dailyCounts([{ mall_key: 'a', order_date: '2026-11-15T15:30:00Z' }, { mall_key: 'a', order_date: '2026-11-15T23:59:00+09:00' }, { mall_key: null, order_date: 'x' }]), { a: { '2026-11-16': 1, '2026-11-15': 1 } });
});

// ── 전체 판정 · 중복 억제 ──
const MALLS = [
    { mall_key: '29cm', label: '29CM 하이헤이호', channel: '29cm', brand_id: 1 },
    { mall_key: 'smartstore', label: '스마트스토어', channel: 'naver', brand_id: 1 },
    { mall_key: 'old', label: '닫은 몰', channel: 'cafe24', active: false },
];
const BRANDS = [{ id: 1, name: '하이헤이호' }];
const failing = [L('29cm', 1, 'error', 'pull_orders', { error: 'invalid_grant' }), L('29cm', 25, 'error'), L('29cm', 49, 'ok')];
const healthy = [L('smartstore', 2, 'ok')];
const busyThenZero = counts([3, 3, 3, 3, 3, 3, 3], 0, 0);

test('끊긴 몰은 fail 만 낸다(0건이어도 zero 를 따로 안 냄) · 수집 정상 몰은 zero · 닫은 몰은 안 본다', () => {
    const r = evaluate({ malls: MALLS, brands: BRANDS, logsByMall: { '29cm': failing, smartstore: healthy }, countsByMall: { '29cm': busyThenZero, smartstore: busyThenZero }, now: NOW });
    assert.equal(r.today, TODAY);
    assert.deepEqual(r.alerts.map(a => [a.mall_key, a.rule]), [['29cm', 'fail'], ['smartstore', 'zero']]);
    assert.equal(r.rows.length, 2);
    assert.match(r.alerts[0].text, /2회 연속 실패.*invalid_grant/);
    assert.match(r.alerts[1].name, /스마트스토어 \(하이헤이호\)/);
});
//  반려1 ② zero 는 수집 정상(ok)일 때만 — 실패 1회(주의)·기록 없음이면 0건이어도 zero 안 냄
test('수집이 주의(실패 1회)거나 기록이 없으면 zero 를 안 낸다', () => {
    const warn = [L('smartstore', 1, 'error'), L('smartstore', 25, 'ok')];
    const r = evaluate({ malls: MALLS, brands: BRANDS, logsByMall: { smartstore: warn }, countsByMall: { smartstore: busyThenZero }, now: NOW });
    assert.equal(r.rows.find(x => x.mall_key === 'smartstore').state, 'warn'); assert.equal(r.alerts.length, 0);
    const none = evaluate({ malls: MALLS, brands: BRANDS, logsByMall: {}, countsByMall: { smartstore: busyThenZero }, now: NOW });
    assert.equal(none.alerts.length, 0);
});
//  반려1 ① 일부러 끈 몰(alert_enabled=false) — 표에는 남되 알림은 안 간다
test('alert_enabled=false 몰은 fail·zero 둘 다 알림에서 빠진다', () => {
    const malls = MALLS.map(m => ({ ...m, alert_enabled: false }));
    const r = evaluate({ malls, brands: BRANDS, logsByMall: { '29cm': failing, smartstore: healthy }, countsByMall: { smartstore: busyThenZero }, now: NOW });
    assert.equal(r.alerts.length, 0);
    assert.deepEqual(r.rows.map(x => [x.mall_key, x.rule, x.off]), [['29cm', 'fail', true], ['smartstore', 'zero', true]]);
    assert.match(table(r), /fail \(알림 꺼짐\)/);
});
test('중복 억제 — 오늘 같은 (몰, 규칙)을 보냈으면 빼고, 어제 보낸 것·다른 규칙은 다시 보낸다', () => {
    const base = { malls: MALLS, brands: BRANDS, logsByMall: { '29cm': failing, smartstore: healthy }, countsByMall: { smartstore: busyThenZero }, now: NOW };
    const same = evaluate({ ...base, sent: [{ day: TODAY, mall_key: '29cm', rule: 'fail' }] });
    assert.deepEqual(same.alerts.map(a => a.mall_key), ['smartstore']);
    assert.equal(same.rows.find(x => x.mall_key === '29cm').dup, true);
    const yest = evaluate({ ...base, sent: [{ day: '2026-11-16', mall_key: '29cm', rule: 'fail' }] });
    assert.ok(yest.alerts.some(a => a.mall_key === '29cm'));
    const other = evaluate({ ...base, sent: [{ day: TODAY, mall_key: '29cm', rule: 'stale' }] });
    assert.ok(other.alerts.some(a => a.mall_key === '29cm' && a.rule === 'fail'));
});
test('알림 글 — 없으면 빈 글, 있으면 몰마다 한 줄', () => {
    assert.equal(alertMessage([], TODAY), '');
    const t = alertMessage([{ rule: 'fail', name: 'A', text: 'x' }, { rule: 'zero', name: 'B', text: 'y' }], TODAY);
    assert.match(t, /주문 수집 알림.*2026-11-17/); assert.match(t, /🔴 A — x/); assert.match(t, /🟠 B — y/);
});

// ── 스크립트: 가짜 PostgREST + 텔레그램 ──
function fakeServer({ logs, sent = [], tgOk = true, claimOk = true, delOk = true }) {
    const calls = [];
    const store = sent.map(x => ({ ...x }));
    const orders = [];
    Object.entries(busyThenZero).forEach(([d, n]) => { for (let i = 0; i < n; i++) orders.push({ mall_key: 'smartstore', order_date: `${d}T12:00:00+09:00` }); });
    const f = async (url, opt = {}) => {
        const u = new URL(url);
        calls.push({ path: u.pathname, search: decodeURIComponent(u.search), method: opt.method || 'GET', body: opt.body, headers: opt.headers || {} });
        const json = (b, ok = true, status = 200) => ({ ok, status, json: async () => b, text: async () => JSON.stringify(b) });
        if (u.hostname === 'api.telegram.org') return json({ ok: tgOk }, tgOk, tgOk ? 200 : 401);
        const t = u.pathname.split('/').pop(), q = decodeURIComponent(u.search);
        if (t === 'malls') return json(MALLS);
        if (t === 'brands') return json(BRANDS);
        if (t === 'sync_log') {
            const mk = q.match(/type=(?:in\.\("|eq\.)([^:]+):/)[1];
            const rows = (logs[mk] || []).slice().sort((a, b) => b.run_at.localeCompare(a.run_at));
            return json(q.includes('result=eq.ok') ? rows.filter(r => r.result === 'ok' && r.type.endsWith(':pull_orders')).slice(0, 1) : rows);
        }
        if (t === 'channel_orders') return json(opt.headers?.Range?.startsWith('0-') ? orders : []);
        if (t === 'order_alert_log') {
            if (opt.method === 'POST') {
                if (!claimOk) return json({ message: 'x' }, false, 500);
                const fresh = JSON.parse(opt.body).filter(x => !store.some(y => y.day === x.day && y.mall_key === x.mall_key && y.rule === x.rule));
                store.push(...fresh);
                return json(fresh.map(({ day, mall_key, rule }) => ({ day, mall_key, rule })), true, 201);
            }
            if (opt.method === 'DELETE') {
                if (!delOk) return json({ message: 'x' }, false, 500);
                const day = q.match(/day=eq\.([\d-]+)/)[1];
                const pairs = [...q.matchAll(/mall_key\.eq\.([^,)]+),rule\.eq\.(\w+)/g)].map(m => m[1] + '|' + m[2]);
                for (let i = store.length - 1; i >= 0; i--) if (store[i].day === day && pairs.includes(store[i].mall_key + '|' + store[i].rule)) store.splice(i, 1);
                return json(null, true, 204);
            }
            return json(store);
        }
        return json({ message: 'unknown ' + t }, false, 404);
    };
    return { f, calls, store };
}
const quiet = { log() {} };

test('드라이런 — 표만 찍고 텔레그램·기록 둘 다 안 한다', async () => {
    const { f, calls } = fakeServer({ logs: { '29cm': failing, smartstore: healthy } });
    const out = [];
    const r = await run({ url: 'https://x.supabase.co', key: 'k', dryRun: true, fetch: f, now: NOW, log: { log: s => out.push(s) } });
    assert.equal(r.alerts.length, 2); assert.equal(r.sentNow, 0);
    assert.equal(calls.filter(c => c.method === 'POST').length, 0);
    assert.match(out.join('\n'), /\| 29CM 하이헤이호 \| 🔴끊김 \| 2 \|/);
    assert.match(table(r), /\| 스마트스토어 \(하이헤이호\) \| 정상 \| 0 \|.*\| 3\.0 \| 0·0 \| zero \|/);
});
//  반려1 ③ 기본은 드라이런
test('dryRun 을 안 주면 드라이런 — 텔레그램 토큰이 있어도 안 보낸다', async () => {
    const { f, calls } = fakeServer({ logs: { '29cm': failing, smartstore: healthy } });
    const r = await run({ url: 'https://x.supabase.co', key: 'k', botToken: 'T', chatId: 'C', fetch: f, now: NOW, log: quiet });
    assert.equal(r.sentNow, 0); assert.equal(calls.filter(c => c.method !== 'GET').length, 0);
});
test('CLI 도 기본 드라이런 — --send 가 있어야 보낸다(워크플로는 예약·수집 뒤에만 --send)', () => {
    const src = readFileSync(new URL('../channel-bots/telegram/order-alert.mjs', import.meta.url), 'utf8');
    assert.match(src, /const dryRun = !process\.argv\.includes\('--send'\)/);
    const yml = readFileSync(new URL('../.github/workflows/order-alert.yml', import.meta.url), 'utf8');
    assert.match(yml, /\(github\.event_name != 'workflow_dispatch' \|\| !inputs\.dry_run\) && '--send' \|\| ''/);
});
//  반려1 ④ 먼저 잡고 보낸다
test('보내기 — order_alert_log 를 먼저 잡고 텔레그램 1번. 다음 실행은 잡을 게 없어 안 보낸다', async () => {
    const s1 = fakeServer({ logs: { '29cm': failing, smartstore: healthy } });
    const r1 = await run({ url: 'https://x.supabase.co', key: 'k', botToken: 'T', chatId: 'C', dryRun: false, fetch: s1.f, now: NOW, log: quiet });
    assert.equal(r1.sentNow, 2);
    const posts = s1.calls.filter(c => c.method === 'POST');
    assert.deepEqual(posts.map(c => c.path.split('/').pop()), ['order_alert_log', 'sendMessage']);
    assert.deepEqual(JSON.parse(posts[0].body).map(x => [x.day, x.mall_key, x.rule]), [[TODAY, '29cm', 'fail'], [TODAY, 'smartstore', 'zero']]);
    assert.match(posts[0].headers.Prefer, /ignore-duplicates,return=representation/);
    const s2 = fakeServer({ logs: { '29cm': failing, smartstore: healthy }, sent: s1.store });
    const r2 = await run({ url: 'https://x.supabase.co', key: 'k', botToken: 'T', chatId: 'C', dryRun: false, fetch: s2.f, now: NOW, log: quiet });
    assert.equal(r2.sentNow, 0); assert.equal(s2.calls.filter(c => c.path.endsWith('sendMessage')).length, 0);
});
test('동시 실행 — 평가 뒤 다른 실행이 먼저 잡은 건은 빼고, 잡은 것만 보낸다', async () => {
    const s = fakeServer({ logs: { '29cm': failing, smartstore: healthy } });
    const f = async (url, opt = {}) => {   // 잡기 직전에 다른 실행이 29cm 를 먼저 잡음
        if (opt.method === 'POST' && url.includes('order_alert_log')) s.store.push({ day: TODAY, mall_key: '29cm', rule: 'fail' });
        return s.f(url, opt);
    };
    const r = await run({ url: 'https://x.supabase.co', key: 'k', botToken: 'T', chatId: 'C', dryRun: false, fetch: f, now: NOW, log: quiet });
    assert.equal(r.sentNow, 1);
    const msg = JSON.parse(s.calls.find(c => c.path.endsWith('sendMessage')).body).text;
    assert.match(msg, /스마트스토어/); assert.doesNotMatch(msg, /29CM/);
});
test('잡기 실패 → 안 보낸다', async () => {
    const s = fakeServer({ logs: { '29cm': failing }, claimOk: false });
    await assert.rejects(run({ url: 'https://x.supabase.co', key: 'k', botToken: 'T', chatId: 'C', dryRun: false, fetch: s.f, now: NOW, log: quiet }), /잡기 실패.*안 보냄/);
    assert.equal(s.calls.filter(c => c.path.endsWith('sendMessage')).length, 0);
});
test('텔레그램 실패 → 잡은 것을 풀어 다음 실행이 다시 보낸다 · 토큰은 에러에 안 나온다', async () => {
    const s = fakeServer({ logs: { '29cm': failing }, tgOk: false });
    await assert.rejects(run({ url: 'https://x.supabase.co', key: 'k', botToken: 'SECRET123', chatId: 'C', dryRun: false, fetch: s.f, now: NOW, log: quiet }),
        e => /텔레그램 전송 실패 401.*풀었음/.test(e.message) && !e.message.includes('SECRET123'));
    assert.equal(s.store.length, 0);
    const again = fakeServer({ logs: { '29cm': failing }, sent: s.store });
    const r = await run({ url: 'https://x.supabase.co', key: 'k', botToken: 'T', chatId: 'C', dryRun: false, fetch: again.f, now: NOW, log: quiet });
    assert.equal(r.sentNow, 1);
});
test('텔레그램 실패 + 풀기도 실패 → 실패로 끝내고 그날은 다시 안 보낸다(중복 없음)', async () => {
    const s = fakeServer({ logs: { '29cm': failing }, tgOk: false, delOk: false });
    await assert.rejects(run({ url: 'https://x.supabase.co', key: 'k', botToken: 'T', chatId: 'C', dryRun: false, fetch: s.f, now: NOW, log: quiet }), /풀기도 실패/);
    assert.equal(s.store.length, 1);
});
test('조회 범위 — 주문은 직전 9일(11-08 00:00 KST ~ 11-17 00:00 KST), sync_log 는 몰마다 pull_orders·error 두 type', async () => {
    const { f, calls } = fakeServer({ logs: { '29cm': failing, smartstore: healthy } });
    await run({ url: 'https://x.supabase.co', key: 'k', dryRun: true, fetch: f, now: NOW, log: quiet });
    const oc = calls.find(c => c.path.endsWith('channel_orders'));
    assert.match(oc.search, /order_date=gte\.2026-11-08T00:00:00\+09:00&order_date=lt\.2026-11-17T00:00:00\+09:00/);
    assert.ok(calls.some(c => c.search.includes('type=in.("29cm:pull_orders","29cm:error")')));
    assert.ok(!calls.some(c => c.search.includes('old:')), '닫은 몰은 조회도 안 한다');
});

//  111 마이그레이션 — PGlite 에 깔아 본다(PGLITE_PATH 없으면 건너뜀)
test('111 DB: 알림 기록 PK 로 하루 1번 · alert_enabled 기본 true, 스마트스토어·키디키디만 false · 재실행·되돌리기', { skip: !process.env.PGLITE_PATH && 'PGLITE_PATH 없음' }, async () => {
    const { PGlite } = await import(pathToFileURL(process.env.PGLITE_PATH).href);
    const db = new PGlite(); const q = async (x, p = []) => (await db.query(x, p)).rows;
    const rd = n => readFileSync(new URL('../supabase/' + n, import.meta.url), 'utf8');
    await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
        create function public.is_staff() returns boolean language sql stable as $$ select true $$;
        create table public.malls (mall_key text primary key, channel text);
        insert into public.malls values ('hiheiho','cafe24'),('29cm','29cm'),('smartstore','naver'),('kidikidi','eland');`);
    await db.exec(rd('migrations/111_order_alert_log.sql')); await db.exec(rd('migrations/111_order_alert_log.sql'));
    assert.deepEqual((await q(`select mall_key, alert_enabled from malls order by mall_key`)).map(r => [r.mall_key, r.alert_enabled]),
        [['29cm', true], ['hiheiho', true], ['kidikidi', false], ['smartstore', false]]);
    const ins = `insert into order_alert_log (day, mall_key, rule) values ('2026-11-17','29cm','fail') on conflict do nothing returning mall_key`;
    assert.equal((await q(ins)).length, 1); assert.equal((await q(ins)).length, 0);
    await assert.rejects(q(`insert into order_alert_log (day, mall_key, rule) values ('2026-11-17','29cm','oops')`));
    await db.exec(rd('rollbacks/111_order_alert_log.down.sql'));
    assert.equal((await q(`select to_regclass('public.order_alert_log') as t`))[0].t, null);
    assert.equal((await q(`select count(*)::int as n from information_schema.columns where table_name='malls' and column_name='alert_enabled'`))[0].n, 0);
});
