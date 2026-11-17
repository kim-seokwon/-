// 주문 수집 끊김·0건 알림 — 규칙은 저장소 뿌리 orderAlerts.js(화면과 같이 씀).
//  GitHub Actions(order-alert.yml)가 주문 수집 워크플로가 끝날 때마다 + 하루 1번 돌린다.
//  하루 1번(halt 판매 멈춤은 주 1번): 보내기 '전에' order_alert_log(111)에 (날짜, 몰, 규칙)을 먼저 잡고(claim), 잡힌 것만 보낸다.
//   전송이 실패하면 잡은 것을 풀어 다음 실행이 다시 보낸다. 풀기도 실패하면 그날은 안 간다(중복보다 누락을 택함, 실패로 끝나 눈에 띔).
//  기본은 드라이런 — 몰별 판정 표와 보낼 글만 찍는다(안 보냄·안 씀·TELEGRAM 값 불필요). --send 를 줘야 실제로 보낸다.
//  load()/run() 은 fetch 를 받아서 쓴다 — 테스트(tests/order-alert.test.mjs)가 네트워크 없이 돌린다.
import { pathToFileURL } from 'node:url';
import { evaluate, alertMessage, dailyCounts, kstDay, addDays, kstShortAt, COUNT_DAYS, HALT_EVERY } from '../../orderAlerts.js';
import { md } from './report.mjs';

const LOG_ROWS = 30;   // 몰마다 최근 기록 수 — 연속 실패를 세기에 충분(카페24 10분 × 30 = 5시간)

export async function load({ url, key, fetch: f = globalThis.fetch, now = Date.now() }) {
    async function rest(path, { range } = {}) {
        //  새 sb_secret 키는 apikey 헤더만 (report.mjs 와 같음)
        const headers = { apikey: key };
        if (range) Object.assign(headers, { 'Range-Unit': 'items', Range: range });
        const r = await f(`${url}/rest/v1/${path}`, { headers });
        if (!r.ok) throw new Error(`${path.split('?')[0]} → ${r.status} ${(await r.text()).slice(0, 120)}`);
        return r.json();
    }
    const today = kstDay(now);
    const [malls, brands] = await Promise.all([
        rest('malls?select=mall_key,label,channel,brand_id,active,alert_enabled'),
        rest('brands?select=id,name'),
    ]);
    const live = malls.filter(m => m.active !== false);
    const logsByMall = {}, lastOkByMall = {};
    await Promise.all(live.map(async m => {
        const q = s => encodeURIComponent(`"${s}"`);   // in.(…) 안 값은 따옴표로 — 몰 키에 쉼표·점이 와도 안 깨지게
        const [logs, ok] = await Promise.all([
            rest(`sync_log?select=run_at,type,result,detail&type=in.(${q(m.mall_key + ':pull_orders')},${q(m.mall_key + ':error')})&order=run_at.desc&limit=${LOG_ROWS}`),
            rest(`sync_log?select=run_at&type=eq.${encodeURIComponent(m.mall_key + ':pull_orders')}&result=eq.ok&order=run_at.desc&limit=1`),
        ]);
        logsByMall[m.mall_key] = logs;
        lastOkByMall[m.mall_key] = ok[0]?.run_at || null;
    }));
    //  주문 — 판정에 필요한 기간만(②는 9일, ③ 판매 멈춤은 37일). 1000건씩 끊어 받는다.
    const from = encodeURIComponent(`${addDays(today, -COUNT_DAYS)}T00:00:00+09:00`);
    const to = encodeURIComponent(`${today}T00:00:00+09:00`);
    const orders = [];
    for (let i = 0; i < 100; i++) {
        const page = await rest(`channel_orders?select=mall_key,order_date&order_date=gte.${from}&order_date=lt.${to}&order=order_date.asc`, { range: `${i * 1000}-${i * 1000 + 999}` });
        orders.push(...page);
        if (page.length < 1000) break;
    }
    //  보낸 기록 — 오늘(하루 1번) + halt 주 1회를 보려고 최근 7일
    const sent = await rest(`order_alert_log?select=day,mall_key,rule&day=gte.${addDays(today, -(HALT_EVERY - 1))}`);
    return { malls, brands, logsByMall, lastOkByMall, countsByMall: dailyCounts(orders), sent, now };
}

//  드라이런 표
export function table(res) {
    const st = { ok: '정상', warn: '주의', down: '🔴끊김', none: '기록없음' };
    const mark = r => r.off ? (r.rule ? `꺼짐(${r.rule})` : '꺼짐') : r.rule ? r.rule + (r.dup ? (r.rule === 'halt' ? ' (이번 주 보냄)' : ' (오늘 보냄)') : '') : '-';
    const L = ['| 몰 | 수집 상태 | 연속 실패 | 마지막 성공 | 직전7일 평균 | 그제·어제 | 최근7일·그앞30일 | 알림 |', '|---|---|---|---|---|---|---|---|'];
    res.rows.forEach(r => L.push(`| ${r.name} | ${r.off ? '꺼짐 · ' : ''}${st[r.state] || r.state} | ${r.failStreak} | ${kstShortAt(r.lastOkAt)} | ${r.avg7.toFixed(1)} | ${r.last2.join('·')} | ${r.recent7}·${r.before30} | ${mark(r)} |`));
    return L.join('\n');
}

export async function run({ url, key, botToken, chatId, dryRun = true, fetch: f = globalThis.fetch, now = Date.now(), log = console }) {
    const res = evaluate(await load({ url, key, fetch: f, now }));
    if (dryRun) {
        const text = alertMessage(res.alerts, res.today, md);
        log.log(table(res));
        log.log(text ? `\n보낼 글(드라이런 — 안 보냄, 보내려면 --send):\n${text}` : '\n보낼 알림 없음');
        return { ...res, sentNow: 0 };
    }
    if (!res.alerts.length) { log.log('보낼 알림 없음'); return { ...res, sentNow: 0 }; }
    const base = `${url}/rest/v1/order_alert_log`;
    //  1) 먼저 잡는다 — 이미 있는 (날짜, 몰, 규칙)은 무시되고, 새로 들어간 행만 돌아온다(동시 실행이 겹쳐도 한쪽만 잡음)
    const c = await f(`${base}?on_conflict=day,mall_key,rule&select=day,mall_key,rule`, {
        method: 'POST',
        headers: { apikey: key, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=representation' },
        body: JSON.stringify(res.alerts.map(a => ({ day: a.day, mall_key: a.mall_key, rule: a.rule, detail: { text: a.text } }))),
    });
    if (!c.ok) throw new Error(`order_alert_log 잡기 실패 ${c.status} — 안 보냄`);
    const got = new Set((await c.json() || []).map(r => `${r.mall_key}|${r.rule}`));
    const mine = res.alerts.filter(a => got.has(`${a.mall_key}|${a.rule}`));
    if (!mine.length) { log.log('다른 실행이 이미 보냄'); return { ...res, sentNow: 0 }; }
    //  2) 잡은 것만 보낸다
    const text = alertMessage(mine, res.today, md);
    const r = await f(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown', disable_web_page_preview: true }),
    });
    if (!r.ok) {
        //  3) 전송 실패 → 잡은 것을 푼다(다음 실행이 다시 보내게)
        const keys = mine.map(a => `and(mall_key.eq.${encodeURIComponent(a.mall_key)},rule.eq.${a.rule})`).join(',');
        const d = await f(`${base}?day=eq.${res.today}&or=(${keys})`, { method: 'DELETE', headers: { apikey: key, Prefer: 'return=minimal' } });
        throw new Error(`텔레그램 전송 실패 ${r.status}${d.ok ? ' — 잡은 기록을 풀었음(다음 실행에 다시 보냄)' : ` — 기록 풀기도 실패 ${d.status}(오늘은 안 감)`}`);
    }
    log.log(`보냈습니다 ${mine.length}건\n${text}`);
    return { ...res, sentNow: mine.length };
}

async function main() {
    const { SUPABASE_URL, SUPABASE_SERVICE_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;
    const dryRun = !process.argv.includes('--send');   // 기본 드라이런
    const need = dryRun ? { SUPABASE_URL, SUPABASE_SERVICE_KEY } : { SUPABASE_URL, SUPABASE_SERVICE_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID };
    for (const [k, v] of Object.entries(need)) if (!v) { console.error(`빠진 값: ${k}`); process.exit(1); }
    await run({ url: SUPABASE_URL, key: SUPABASE_SERVICE_KEY, botToken: TELEGRAM_BOT_TOKEN, chatId: TELEGRAM_CHAT_ID, dryRun });
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main().catch(e => { console.error('[order-alert] 실패:', e.message); process.exit(1); });
