//  광고 중단선 알림(G 11-19) — 규칙(adStopAlerts.js)과 스크립트(ad-stop-alert.mjs)를 네트워크 없이 합성 데이터로.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stopTargets, diffAlerts, alertText, DEFAULT_RULE } from '../adStopAlerts.js';
import { run } from '../channel-bots/telegram/ad-stop-alert.mjs';

const NOW = Date.parse('2026-11-19T01:00:00Z');   // 11-19 10:00 KST → 판정 기간 11-16~11-18
const B1 = 'b-hi', B2 = 'b-toby';
const brands = [{ id: B1, name: '하이헤이호' }, { id: B2, name: '토비' }];
const rules = [{ brand_id: B1, up_max: 800, stop_over: 1300 }];   // B2 는 행 없음 → 기본값(1600)
const link = (ad, set, brand, status, extra = {}) => ({ ad_id: ad, adset_id: set, adset_name: set + '_PV', adset_status: status, effective_status: status, brand_id: brand, ...extra });
const links = [
    link('a1', 'S1', B1, 'ACTIVE'),                     // 3일 30,000 / 10명 = 3,000 > 1,300 → 중단 + 켜짐 → 대상
    link('a2', 'S2', B1, 'PAUSED'),                     // 중단이지만 꺼짐 → 아님
    link('a3', 'S3', B1, 'ACTIVE'),                     // 900원 → 유지/증액 → 아님
    link('a4', 'S4', B2, 'ACTIVE'),                     // 팔로우 0 → 중단 + 켜짐 → 대상(기본 중단선 1,600)
    link('a5', 'S5', B1, 'ACTIVE', { excluded: true }), // 제외 세트 → 아님
    link('a6', 'S6', B2, 'ACTIVE'),                     // 1,500 < 1,600 → 유지 → 아님
    //  세트 ACTIVE + 광고 전부 PAUSED(광고만 끔) → 아님 (팀장 반려 11-19 오탐 7건 재현)
    link('a7', 'S7', B1, 'ACTIVE', { effective_status: 'PAUSED' }), link('a8', 'S7', B1, 'ACTIVE', { effective_status: 'PAUSED' }),
    //  세트 ACTIVE + 광고 하나만 켜짐 → 대상
    link('a9', 'S8', B2, 'ACTIVE', { effective_status: 'PAUSED' }), link('a10', 'S8', B2, 'ACTIVE'),
];
const d = (ad, day, spend, follows) => ({ ad_id: ad, day, spend, follows });
const daily = [
    d('a1', '2026-11-16', 10000, 4), d('a1', '2026-11-17', 10000, 3), d('a1', '2026-11-18', 10000, 3),
    d('a1', '2026-11-19', 50000, 100),                  // 오늘(진행 중)은 판정에 안 넣는다
    d('a2', '2026-11-17', 30000, 10),
    d('a3', '2026-11-18', 9000, 10),
    d('a4', '2026-11-17', 8000, 0), d('a4', '2026-11-18', 12000, 0),
    d('a5', '2026-11-18', 90000, 0),
    d('a6', '2026-11-18', 15000, 10),
    d('a7', '2026-11-17', 20000, 5), d('a8', '2026-11-18', 20000, 5),    // 4,000원 → 중단이지만 광고 다 꺼짐
    d('a9', '2026-11-18', 10000, 2), d('a10', '2026-11-18', 10000, 2),   // 5,000원 → 중단 + 광고 1개 켜짐
];
const DATA = { links, daily, rules, brands, now: NOW };

test('보낼 대상 = 판정 중단 + 켜진 광고(effective ACTIVE) 있는 세트만 (꺼진 세트·광고만 끈 세트·제외·유지/증액·오늘 지출 제외)', () => {
    const t = stopTargets(DATA);
    assert.deepEqual(t.map(x => x.adset_id).sort(), ['S1', 'S4', 'S8']);
    assert.ok(!t.some(x => x.adset_id === 'S7'), '세트 ACTIVE + 광고 전부 PAUSED 는 제외');
    const s1 = t.find(x => x.adset_id === 'S1');
    assert.equal(s1.cpf, 3000); assert.equal(s1.stop_over, 1300); assert.equal(s1.spendYesterday, 10000); assert.equal(s1.brand, '하이헤이호');
    const s4 = t.find(x => x.adset_id === 'S4');
    assert.equal(s4.cpf, null); assert.equal(s4.stop_over, DEFAULT_RULE.stop_over); assert.equal(s4.spend3, 20000);
});

test('중복 억제 — 이미 알린 세트는 판정 바뀔 때까지 안 보내고, 대상에서 빠진 세트 기록은 지운다', () => {
    const t = stopTargets(DATA);
    const r = diffAlerts(t, [{ adset_id: 'S1' }, { adset_id: 'S9' }]);
    assert.deepEqual(r.fresh.map(x => x.adset_id).sort(), ['S4', 'S8']);
    assert.deepEqual(r.already.map(x => x.adset_id), ['S1']);
    assert.deepEqual(r.cleared, ['S9']);
    //  S1 이 유지로 바뀌면(팔로우 늘어남) 기록이 지워지고, 다음에 다시 중단이 되면 또 알린다
    const better = stopTargets({ ...DATA, daily: [...daily, d('a1', '2026-11-18', 0, 30)] });
    const r2 = diffAlerts(better, [{ adset_id: 'S1' }]);
    assert.deepEqual(r2.cleared, ['S1']);
    assert.deepEqual(diffAlerts(t, []).fresh.map(x => x.adset_id).sort(), ['S1', 'S4', 'S8']);
});

test('알림 글 — 브랜드·세트명·팔로워당 비용·중단선·어제 지출, 자동 끄기 안 함 문구', () => {
    const txt = alertText(stopTargets(DATA), '2026-11-18');
    for (const s of ['하이헤이호 · S1_PV', '팔로워당 3,000원', '중단선 1,300원', '어제 지출 10,000원', '토비 · S4_PV', '팔로우 0 (3일 20,000원)', '중단선 1,600원', '자동으로 끄지 않았습니다'])
        assert.ok(txt.includes(s), s);
    assert.equal(alertText([], '2026-11-18'), '');
});

//  가짜 Supabase + 텔레그램 — 조직 2개. 다른 조직(OX) 행은 org_id 필터가 빠지면 섞여 들어온다(코덱스 반려 11-19 회귀).
const ORG = '00000000-0000-4000-8000-000000002179', OX = '00000000-0000-4000-8000-00000000a001';
const XB = 'b-other';
const tag = (rows, org) => rows.map(r => ({ ...r, org_id: org }));
const DB = {
    ad_links: [...tag(links, ORG), ...tag([link('x1', 'SX', XB, 'ACTIVE')], OX)],
    ad_daily: [...tag(daily, ORG), ...tag([d('x1', '2026-11-18', 50000, 0)], OX)],   // 다른 조직: 팔로우 0 → 섞이면 중단 대상
    ad_report_rules: [...tag(rules, ORG), { brand_id: XB, stop_over: 100, org_id: OX }],
    brands: [...tag(brands, ORG), { id: XB, name: '다른회사', org_id: OX }],
};
function fake({ sent = [], noTable = false, tgOk = true, tgThrow = false } = {}) {
    const calls = [];
    const json = (b, status = 200) => ({ ok: status < 300, status, json: async () => b, text: async () => JSON.stringify(b) });
    const f = async (url, opt = {}) => {
        const m = opt.method || 'GET'; calls.push({ m, url, body: opt.body });
        if (url.startsWith('https://api.telegram.org')) {
            if (tgThrow) throw new TypeError(`fetch failed ${url}`);   // 응답 없이 끊김
            return json({ ok: tgOk }, tgOk ? 200 : 400);
        }
        const path = url.split('/rest/v1/')[1];
        const org = (path.match(/org_id=eq\.([0-9a-f-]+)/) || [])[1];
        const mine = rows => org ? rows.filter(r => r.org_id === org) : rows;
        if (path.startsWith('ad_stop_alert')) {
            if (noTable) return json({ code: 'PGRST205' }, 404);
            const sentRows = sent.map(r => ({ org_id: ORG, ...r }));
            if (m === 'GET') return json(mine(sentRows));
            if (m === 'POST') return json(JSON.parse(opt.body).filter(r => !sentRows.some(s => s.adset_id === r.adset_id && s.org_id === r.org_id)).map(r => ({ adset_id: r.adset_id })), 201);
            return json(null, 204);
        }
        for (const t of ['ad_links', 'ad_daily', 'ad_report_rules', 'brands']) if (path.startsWith(t)) {
            const rows = mine(DB[t]);
            return json(t === 'ad_daily' ? rows.filter(x => x.day >= '2026-11-10') : rows);
        }
        throw new Error('예상 못 한 호출 ' + path);
    };
    return { f, calls };
}
const A = { url: 'https://x.supabase.co', key: 'k', orgId: ORG, now: NOW };
const quiet = () => { const out = []; return { out, log: { log: s => out.push(s) } }; };

test('드라이런 — 표·보낼 글만, 쓰기·텔레그램 호출 0', async () => {
    const { f, calls } = fake({ sent: [{ adset_id: 'S1' }] }); const q = quiet();
    const r = await run({ ...A, dryRun: true, fetch: f, log: q.log });
    assert.deepEqual(r.fresh.map(x => x.adset_id).sort(), ['S4', 'S8']);
    assert.ok(calls.every(c => c.m === 'GET' && !c.url.includes('telegram')));
    assert.match(q.out.join('\n'), /이미 알림\(판정 바뀔 때까지 안 보냄\)/);
    assert.match(q.out.join('\n'), /토비 · S4\\_PV/);
});

test('--send — 빠진 세트 기록 지우기 → 새 세트만 잡기 → 1통 보내기', async () => {
    const { f, calls } = fake({ sent: [{ adset_id: 'S1' }, { adset_id: 'S9' }] }); const q = quiet();
    const r = await run({ ...A, botToken: 't', chatId: 'c', dryRun: false, fetch: f, log: q.log });
    assert.equal(r.sentNow, 2);
    const w = calls.filter(c => c.m !== 'GET');
    assert.equal(w[0].m, 'DELETE'); assert.match(decodeURIComponent(w[0].url), /org_id=eq\.[^&]+2179&adset_id=in\.\("S9"\)/);
    assert.match(w[1].url, /on_conflict=org_id,adset_id/);
    assert.ok(JSON.parse(w[1].body).every(x => x.org_id === ORG), 'claim 행에 조직');
    assert.equal(w[1].m, 'POST'); assert.deepEqual(JSON.parse(w[1].body).map(x => x.adset_id).sort(), ['S4', 'S8']);
    assert.ok(w[2].url.startsWith('https://api.telegram.org')); assert.equal(w.length, 3);
    const body = JSON.parse(w[2].body).text;
    assert.ok(body.includes('S4') && !body.includes('S1\\_PV'), '이미 알린 S1 은 안 보냄');
});

test('--send 텔레그램 실패 → 잡은 기록을 푼다 · 표 없음(121 미적용) → 드라이런은 계산, --send 는 멈춤', async () => {
    const a = fake({ tgOk: false });
    await assert.rejects(run({ ...A, botToken: 't', chatId: 'c', dryRun: false, fetch: a.f, log: quiet().log }), /전송 실패 400 — 잡은 기록을 풀었음/);
    assert.equal(a.calls.at(-1).m, 'DELETE');
    //  응답 없이 끊김(fetch reject) — 예외 경로에서도 잡은 기록을 풀고, 토큰은 메시지에 안 남긴다
    const n = fake({ tgThrow: true });
    await assert.rejects(run({ ...A, botToken: 'SECRET123', chatId: 'c', dryRun: false, fetch: n.f, log: quiet().log }),
        e => /텔레그램 연결 실패/.test(e.message) && /잡은 기록을 풀었음/.test(e.message) && !e.message.includes('SECRET123'));
    const last = n.calls.at(-1);
    assert.equal(last.m, 'DELETE'); assert.match(decodeURIComponent(last.url), /org_id=eq\.[^&]+2179&adset_id=in\./);
    assert.deepEqual(decodeURIComponent(last.url).match(/"(S\d)"/g).sort(), ['"S1"', '"S4"', '"S8"'], '잡은 3개 전부 해제');
    const b = fake({ noTable: true }); const q = quiet();
    const r = await run({ ...A, dryRun: true, fetch: b.f, log: q.log });
    assert.equal(r.noLog, true); assert.equal(r.fresh.length, 3); assert.match(q.out.join('\n'), /121 미적용/);
    await assert.rejects(run({ ...A, botToken: 't', chatId: 'c', dryRun: false, fetch: fake({ noTable: true }).f, log: quiet().log }), /121 미적용/);
});

test('워크플로 — 09:30 KST 하루 1번, TELEGRAM_READY 스위치, 기본 드라이런 · 121 마이그레이션·되돌리기 있음', () => {
    const y = readFileSync(new URL('../.github/workflows/ad-stop-alert.yml', import.meta.url), 'utf8');
    assert.match(y, /cron: '30 0 \* \* \*'/);
    assert.match(y, /vars\.TELEGRAM_READY == 'true'/);
    assert.match(y, /ad-stop-alert\.mjs \$\{\{ \(github\.event_name != 'workflow_dispatch' \|\| !inputs\.dry_run\) && '--send' \|\| '' \}\}/);
    const m = readFileSync(new URL('../supabase/migrations/121_ad_stop_alert.sql', import.meta.url), 'utf8');
    assert.match(m, /create table if not exists public\.ad_stop_alert/);
    assert.match(m, /revoke all on table public\.ad_stop_alert from anon, authenticated/);
    assert.match(m, /org_id\s+uuid not null/); assert.match(m, /primary key \(org_id, adset_id\)/);
    assert.match(m, /using \(public\.ad_stop_alert_can_read\(org_id\)\)/); assert.doesNotMatch(m, /is_staff\(\)/);
    assert.match(y, /ORG_ID: \$\{\{ vars\.AD_ALERT_ORG_ID \}\}/); assert.doesNotMatch(y, /2179/, '조직 기본값 금지');
    assert.ok(readFileSync(new URL('../supabase/rollbacks/121_ad_stop_alert.down.sql', import.meta.url), 'utf8').includes('drop table if exists public.ad_stop_alert'));
});

test('조직 격리 — 다른 조직 광고·판정선·기록은 안 읽고 안 건드린다, ORG_ID 없으면 거부', async () => {
    const { f, calls } = fake({ sent: [{ adset_id: 'SX', org_id: OX }] }); const q = quiet();
    const r = await run({ ...A, botToken: 't', chatId: 'c', dryRun: false, fetch: f, log: q.log });
    assert.deepEqual(r.targets.map(x => x.adset_id).sort(), ['S1', 'S4', 'S8'], '다른 조직 SX 안 섞임');
    assert.ok(!r.cleared.includes('SX'), '다른 조직 기록은 지울 대상 아님');
    for (const c of calls.filter(c => !c.url.includes('telegram') && c.m !== 'POST')) assert.match(c.url, /org_id=eq\.00000000-0000-4000-8000-000000002179/, c.url);
    assert.ok(!JSON.parse(calls.find(c => c.url.includes('telegram')).body).text.includes('다른회사'));
    //  필터가 빠진 경우를 가정하면 섞인다는 것도 확인(시험이 진짜 격리를 보는지)
    assert.ok(stopTargets({ links: DB.ad_links, daily: DB.ad_daily, rules: DB.ad_report_rules, brands: DB.brands, now: NOW }).some(x => x.adset_id === 'SX'));
    for (const bad of [undefined, '', 'abc'])
        await assert.rejects(run({ ...A, orgId: bad, fetch: fake().f, log: quiet().log }), /ORG_ID 없음/);
});
