// 광고 중단선 알림 — 규칙은 저장소 뿌리 adStopAlerts.js(판정은 화면과 같은 adPanel.buildPanel).
//  GitHub Actions(ad-stop-alert.yml)가 하루 1번 09:30 KST 에 돌린다. 광고를 끄지 않는다(알림만).
//  중복 억제: 보내기 '전에' ad_stop_alert(121)에 세트를 먼저 잡고(claim), 새로 잡힌 것만 보낸다.
//   대상에서 빠진 세트(판정이 바뀌었거나 꺼짐)는 기록을 지운다 → 나중에 다시 중단+켜짐이 되면 또 알린다.
//   전송이 실패하면 잡은 것을 풀어 다음 실행이 다시 보낸다(order-alert.mjs 와 같은 틀).
//  기본은 드라이런 — 대상 표와 보낼 글만 찍는다(안 보냄·안 씀·TELEGRAM 값 불필요). --send 를 줘야 실제로 보낸다.
import { pathToFileURL } from 'node:url';
import { stopTargets, diffAlerts, alertText, kstDay, addDays, DAILY_DAYS } from '../../adStopAlerts.js';
import { md } from './report.mjs';

//  조직 격리(코덱스 반려 11-19): service key 는 RLS 를 건너뛰므로 모든 조회·쓰기에 org_id 를 직접 건다. 기본값 없음 — 없으면 거부.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function needOrg(orgId) {
    if (!UUID.test(String(orgId || ''))) throw new Error('ORG_ID 없음/형식 틀림 — 조직을 정하지 않으면 실행하지 않음');
    return String(orgId).toLowerCase();
}

export async function load({ url, key, orgId, fetch: f = globalThis.fetch, now = Date.now() }) {
    const org = `org_id=eq.${needOrg(orgId)}`;
    async function rest(path, { range } = {}) {
        const headers = { apikey: key };
        if (range) Object.assign(headers, { 'Range-Unit': 'items', Range: range });
        const r = await f(`${url}/rest/v1/${path}`, { headers });
        if (!r.ok) throw new Error(`${path.split('?')[0]} → ${r.status} ${(await r.text()).slice(0, 120)}`);
        return r.json();
    }
    async function all(path) {   // 1000행씩 끊어 받는다
        const out = [];
        for (let i = 0; i < 100; i++) {
            const page = await rest(path, { range: `${i * 1000}-${i * 1000 + 999}` });
            out.push(...page);
            if (page.length < 1000) break;
        }
        return out;
    }
    const since = addDays(kstDay(now), -DAILY_DAYS);
    const [links, rules, brands, daily] = await Promise.all([
        all(`ad_links?select=*&${org}&order=ad_id.asc`),
        rest(`ad_report_rules?select=*&${org}`),
        rest(`brands?select=id,name&${org}`),
        all(`ad_daily?select=ad_id,day,spend,follows&${org}&day=gte.${since}&order=day.asc,ad_id.asc`),
    ]);
    //  121 적용 전이면 기록 표가 없다 — 드라이런은 '보낸 기록 없음'으로 보고, --send 는 멈춘다(run)
    let sent = null;
    try { sent = await all(`ad_stop_alert?select=adset_id,alerted_day&${org}&order=adset_id.asc`); }
    catch (e) { if (!/ad_stop_alert → 404/.test(e.message)) throw e; }
    return { links, daily, rules, brands, sent, now, orgId: needOrg(orgId) };
}

export function evaluate(data) {
    const targets = stopTargets(data);
    return { orgId: data.orgId, day: addDays(kstDay(data.now), -1), today: kstDay(data.now), noLog: data.sent == null, targets, ...diffAlerts(targets, data.sent || []) };
}

const won = n => n == null ? '-' : `${Math.round(n).toLocaleString('ko-KR')}`;
export function table(res) {
    const L = ['| 브랜드 | 세트 | 3일 팔로워당 | 중단선 | 어제 지출 | 알림 |', '|---|---|---|---|---|---|'];
    const fresh = new Set(res.fresh.map(t => t.adset_id));
    res.targets.forEach(t => L.push(`| ${t.brand} | ${t.name} | ${won(t.cpf)} | ${won(t.stop_over)} | ${won(t.spendYesterday)} | ${fresh.has(t.adset_id) ? '새로 알림' : '이미 알림(판정 바뀔 때까지 안 보냄)'} |`));
    if (!res.targets.length) L.push('| - | 중단+진행 세트 없음 | | | | |');
    if (res.cleared.length) L.push('', `대상에서 빠진 세트 ${res.cleared.length}개 — 기록 지움(다시 걸리면 또 알림)`);
    return L.join('\n');
}

export async function run({ url, key, orgId, botToken, chatId, dryRun = true, fetch: f = globalThis.fetch, now = Date.now(), log = console }) {
    const res = evaluate(await load({ url, key, orgId, fetch: f, now }));
    if (dryRun) {
        const text = alertText(res.fresh, res.day, md);
        log.log(table(res));
        if (res.noLog) log.log('\n⚠ ad_stop_alert 표 없음(121 미적용) — 보낸 기록 없이 계산했습니다. --send 전에 121 적용 필요.');
        log.log(text ? `\n보낼 글(드라이런 — 안 보냄·안 씀, 보내려면 --send):\n${text}` : '\n보낼 알림 없음');
        return { ...res, sentNow: 0 };
    }
    if (res.noLog) throw new Error('ad_stop_alert 표 없음(121 미적용) — 중복 억제 없이 보내지 않음');
    const base = `${url}/rest/v1/ad_stop_alert`, org = `org_id=eq.${res.orgId}`;
    const inList = ids => `(${ids.map(id => `"${String(id).replace(/"/g, '')}"`).join(',')})`;
    //  0) 대상에서 빠진 세트는 기록을 지운다(판정이 바뀌면 다음에 다시 알리게)
    if (res.cleared.length) {
        const d = await f(`${base}?${org}&adset_id=in.${encodeURIComponent(inList(res.cleared))}`, { method: 'DELETE', headers: { apikey: key, Prefer: 'return=minimal' } });
        if (!d.ok) throw new Error(`ad_stop_alert 정리 실패 ${d.status}`);
    }
    if (!res.fresh.length) { log.log('보낼 알림 없음'); return { ...res, sentNow: 0 }; }
    //  1) 먼저 잡는다 — 이미 있는 세트는 무시되고 새로 들어간 행만 돌아온다(동시 실행이 겹쳐도 한쪽만)
    const c = await f(`${base}?on_conflict=org_id,adset_id&select=adset_id`, {
        method: 'POST',
        headers: { apikey: key, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=representation' },
        body: JSON.stringify(res.fresh.map(t => ({ org_id: res.orgId, adset_id: t.adset_id, brand_id: t.brand_id, alerted_day: res.today,
            detail: { name: t.name, cpf: t.cpf, stop_over: t.stop_over, spend_yesterday: t.spendYesterday } }))),
    });
    if (!c.ok) throw new Error(`ad_stop_alert 잡기 실패 ${c.status} — 안 보냄`);
    const got = new Set((await c.json() || []).map(r => String(r.adset_id)));
    const mine = res.fresh.filter(t => got.has(t.adset_id));
    if (!mine.length) { log.log('다른 실행이 이미 보냄'); return { ...res, sentNow: 0 }; }
    //  2) 잡은 것만 보낸다
    const text = alertText(mine, res.day, md);
    //  3) 전송 실패(HTTP 오류든 응답 없이 끊김이든) → 잡은 것을 푼다. 안 풀면 판정 바뀔 때까지 영구 미알림.
    const release = async () => {
        try {
            const d = await f(`${base}?${org}&adset_id=in.${encodeURIComponent(inList(mine.map(t => t.adset_id)))}`, { method: 'DELETE', headers: { apikey: key, Prefer: 'return=minimal' } });
            return d.ok ? ' — 잡은 기록을 풀었음(다음 실행에 다시 보냄)' : ` — 기록 풀기도 실패 ${d.status}(판정 바뀔 때까지 안 감)`;
        } catch (e) { return ` — 기록 풀기도 실패 ${e.message}(판정 바뀔 때까지 안 감)`; }
    };
    let r;
    try {
        r = await f(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown', disable_web_page_preview: true }),
        });
    } catch (e) {
        throw new Error(`텔레그램 연결 실패 ${String(e?.message || e).replace(/bot[^/\s]+/g, 'bot***')}${await release()}`);
    }
    if (!r.ok) throw new Error(`텔레그램 전송 실패 ${r.status}${await release()}`);
    log.log(`보냈습니다 ${mine.length}건\n${text}`);
    return { ...res, sentNow: mine.length };
}

async function main() {
    const { SUPABASE_URL, SUPABASE_SERVICE_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, ORG_ID } = process.env;
    const dryRun = !process.argv.includes('--send');
    const need = dryRun ? { SUPABASE_URL, SUPABASE_SERVICE_KEY, ORG_ID } : { SUPABASE_URL, SUPABASE_SERVICE_KEY, ORG_ID, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID };
    for (const [k, v] of Object.entries(need)) if (!v) { console.error(`빠진 값: ${k}`); process.exit(1); }
    await run({ url: SUPABASE_URL, key: SUPABASE_SERVICE_KEY, orgId: ORG_ID, botToken: TELEGRAM_BOT_TOKEN, chatId: TELEGRAM_CHAT_ID, dryRun });
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main().catch(e => { console.error('[ad-stop-alert] 실패:', e.message); process.exit(1); });
