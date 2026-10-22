//  29CM 봇 2계정(하이헤이호 29cm · 로하이스튜디오 29cm-rohi) — 계정 목록 · OTP 메일 재사용 금지 · 한 계정 실패 격리 · 화면 29CM 합치기
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    accountsFromEnv, otpFromText, otpQueries, otpMailUsable, otpNotBefore, mapOrder, runAccounts, is29cmKey,
    pollOtp, isQuotaError, OTP_POLL_MS, OTP_BACKOFF_MS,
} from '../channel-bots/29cm/accounts.mjs';

const SYNC = readFileSync(new URL('../channel-bots/29cm/sync.mjs', import.meta.url), 'utf8');
const YML = readFileSync(new URL('../.github/workflows/29cm-sync.yml', import.meta.url), 'utf8');
const MAIN = readFileSync(new URL('../main.js', import.meta.url), 'utf8');

test('계정 목록: 2번째 값이 없으면 건너뛰고, 있으면 몰·브랜드가 따로', () => {
    const one = accountsFromEnv({ CM29_ID: 'a', CM29_PW: 'p', CM29_TOTP_SECRET: 'S' }, false);
    assert.deepEqual(one.run.map(a => a.mallKey), ['29cm']);
    assert.equal(one.skip[0].brand, '로하이스튜디오'); assert.match(one.skip[0].why, /CM29_ID_2/);

    const two = accountsFromEnv({ CM29_ID: 'a', CM29_PW: 'p', CM29_ID_2: 'b', CM29_PW_2: 'q', CM29_OTP_TO_2: 'r@x.com' }, true);
    assert.deepEqual(two.run.map(a => [a.mallKey, a.brand, a.id]), [['29cm', '하이헤이호', 'a'], ['29cm-rohi', '로하이스튜디오', 'b']]);
    assert.equal(two.run[1].otpTo, 'r@x.com'); assert.equal(two.run[0].totp, '');

    //  OTP 수단은 계정별 — 1번은 TOTP, 2번은 TOTP·Gmail 둘 다 없으면 2번만 건너뜀
    const noOtp2 = accountsFromEnv({ CM29_ID: 'a', CM29_PW: 'p', CM29_TOTP_SECRET: 'S', CM29_ID_2: 'b', CM29_PW_2: 'q' }, false);
    assert.deepEqual(noOtp2.run.map(a => a.mallKey), ['29cm']);
    assert.match(noOtp2.skip[0].why, /CM29_TOTP_SECRET_2/);
    assert.ok(!JSON.stringify(noOtp2.skip).includes('"q"') && !JSON.stringify(noOtp2.skip).includes('"S"'), '건너뜀 이유에 비밀값 없음');

    assert.equal(accountsFromEnv({}, true).run.length, 0);
});

test('OTP 메일: 앞 계정이 쓴 메일·기준 시각 전 메일은 안 쓴다', () => {
    const used = new Set(['m1']);
    assert.equal(otpMailUsable({ id: 'm1', receivedAt: 2e12 }, { notBeforeMs: 0, usedIds: used }), false, '이미 쓴 메일');
    assert.equal(otpMailUsable({ id: 'm2', receivedAt: 1000 }, { notBeforeMs: 2000, usedIds: used }), false, '기준 전');
    assert.equal(otpMailUsable({ id: 'm2', receivedAt: 3000 }, { notBeforeMs: 2000, usedIds: used }), true);

    //  2번 계정은 1번 계정이 쓴 메일 시각보다 늦은 메일만 — 재요청 쿨다운(이미 발송)이어도
    const now = 10 * 60_000, firstMailAt = now - 30_000;
    assert.equal(otpNotBefore({ now, requested: false }), now - 120_000);
    assert.equal(otpNotBefore({ now, requested: false, floor: firstMailAt }), firstMailAt + 1);
    assert.equal(otpNotBefore({ now, requested: true, floor: firstMailAt }), now - 10_000);

    assert.equal(otpFromText('[29CM] 인증번호는 482913 입니다'), '482913');
    assert.equal(otpFromText('코드 없음'), null);
    assert.match(otpQueries('r@x.com')[0], /\{to:r@x\.com deliveredto:r@x\.com\}/);
    assert.ok(!/to:/.test(otpQueries('')[1]));
});

test('한 계정 실패가 다음 계정을 막지 않는다', async () => {
    const seen = [], errs = [];
    const out = await runAccounts(
        [{ brand: '하이헤이호' }, { brand: '로하이스튜디오' }],
        async a => { seen.push(a.brand); if (a.brand === '하이헤이호') throw new Error('2차인증 실패'); return 7; },
        { error: (...x) => errs.push(x.join(' ')) },
    );
    assert.deepEqual(seen, ['하이헤이호', '로하이스튜디오']);
    assert.deepEqual(out, [{ brand: '하이헤이호', ok: false, error: '2차인증 실패' }, { brand: '로하이스튜디오', ok: true, count: 7 }]);
    assert.match(errs[0], /하이헤이호.*2차인증 실패/);
});

test('주문 매핑: 계정 몰로 저장(같은 주문번호도 몰이 다르면 따로)', () => {
    const o = { orderNumber: 123, orderedAt: '2026-10-22', actualSalePrice: '15000', orderStatus: '1' };
    assert.equal(mapOrder(o, '29cm').mall_key, '29cm');
    const r = mapOrder(o, '29cm-rohi');
    assert.equal(r.mall_key, '29cm-rohi'); assert.equal(r.channel, '29cm'); assert.equal(r.order_id, '123'); assert.equal(r.pay_amount, 15000);
});

test('sync.mjs·yml 연결: 계정 반복 · 계정별 창 닫기 · 실패 있으면 exit 1 · 2계정 env', () => {
    assert.match(SYNC, /runAccounts\(ACCOUNTS, a => syncAccount\(browser, a\)\)/);
    assert.match(SYNC, /finally \{ await ctx\.close\(\)/);
    assert.match(SYNC, /if \(results\.some\(r => !r\.ok\)\) process\.exit\(1\)/);
    assert.match(SYNC, /usedOtpIds\.add\(hit\.id\)/);
    assert.match(SYNC, /if \(selErr\) throw selErr;/, '몰 조회 실패면 upsert 안 함(브랜드 연결 보호)');
    assert.ok(!/MALL_KEY|process\.env\.CM29_ID\b|\bCM29_ID,/.test(SYNC.replace(/^\/\/.*$/gm, '')), '옛 단일 계정 상수 없음');
    for (const k of ['CM29_ID_2', 'CM29_PW_2', 'CM29_TOTP_SECRET_2', 'CM29_OTP_TO_2']) assert.match(YML, new RegExp(`${k}: \\$\\{\\{ secrets\\.${k} \\}\\}`));
});

test('화면: 29cm-rohi 도 29CM 채널로 합친다', () => {
    assert.ok(is29cmKey('29cm') && is29cmKey('29CM-rohi') && is29cmKey('29cm-x'));
    assert.ok(!is29cmKey('29cmx') && !is29cmKey('musinsa') && !is29cmKey(null));
    assert.match(MAIN, /import \{ is29cmKey \} from '\.\/channel-bots\/29cm\/accounts\.mjs'/);
    assert.ok(!/mk === '29cm'/.test(MAIN), "mall_key === '29cm' 하드코딩이 남지 않음");
    assert.match(MAIN, /const pk = is29cmKey\(r\.platform\) \? '29cm' : r\.platform/);
    assert.match(MAIN, /chKey === '29cm' && is29cmKey\(m\.mall_key\)/);
});

//  가짜 Gmail — 호출을 기록하고, quotaAt 번째(1부터) 호출에서 429 를 던진다
function fakeGmail(mails, { quotaAt = [] } = {}) {
    const calls = [];
    const b64 = t => Buffer.from(t, 'utf-8').toString('base64');
    const hit = () => { if (quotaAt.includes(calls.length)) { const e = new Error("Quota exceeded for quota metric 'Queries' … Units per minute per user"); e.code = 429; throw e; } };
    const gmail = { users: { messages: {
        list: async (a) => { calls.push(['list', a.q]); hit(); return { data: { messages: mails.map(m => ({ id: m.id })) } }; },
        get: async (a) => {
            calls.push(['get', a.id, a.format]); hit();
            const m = mails.find(x => x.id === a.id);
            const headers = [{ name: 'Subject', value: m.subject }, { name: 'From', value: '29CM' }];
            return { data: { internalDate: String(m.at), payload: a.format === 'full' ? { headers, body: { data: b64(m.body) } } : { headers } } };
        },
    } } };
    return { gmail, calls };
}
const clock = () => { let t = 1e12; return { now: () => t, sleep: async ms => { t += ms; } }; };
const quiet = { error() {} };

test('Gmail 쿼터: 본 메일은 다시 안 읽고, 기준 전 메일은 full 로 안 연다 · 폴링 6초', async () => {
    assert.equal(OTP_POLL_MS, 6000); assert.equal(OTP_BACKOFF_MS, 15000);
    const c = clock(), nb = 1e12;
    const { gmail, calls } = fakeGmail([{ id: 'old', at: nb - 60_000, subject: '[29CM] 인증', body: '인증번호 111111' }]);
    const sleeps = []; const sleep = async ms => { sleeps.push(ms); await c.sleep(ms); };
    await assert.rejects(pollOtp(gmail, { timeoutMs: 20_000, notBeforeMs: nb, now: c.now, sleep, log: quiet }), /못 찾음/);
    const gets = calls.filter(x => x[0] === 'get');
    assert.deepEqual(gets, [['get', 'old', 'metadata']], '같은 메일은 metadata 한 번만, full 은 0번');
    assert.ok(sleeps.length >= 2 && sleeps.every(ms => ms === 6000));
});

test('Gmail 쿼터: 429 면 15초 쉬고 계속해서 코드를 찾는다 · 쓴 메일은 건너뜀', async () => {
    const c = clock(), nb = 1e12 - 5_000;
    const mails = [
        { id: 'used', at: 1e12, subject: '[29CM] 인증', body: '인증번호 222222' },
        { id: 'new', at: 1e12, subject: '[29CM] 인증', body: '인증번호는 482913 입니다' },
    ];
    const { gmail, calls } = fakeGmail(mails, { quotaAt: [1, 3] });
    const sleeps = []; const sleep = async ms => { sleeps.push(ms); await c.sleep(ms); };
    const hit = await pollOtp(gmail, { notBeforeMs: nb, usedIds: new Set(['used']), now: c.now, sleep, log: quiet });
    assert.deepEqual(hit, { code: '482913', id: 'new', receivedAt: 1e12 });
    assert.deepEqual(sleeps, [15000, 15000]);
    assert.ok(!calls.some(x => x[1] === 'used' && x[0] === 'get'), '앞 계정이 쓴 메일은 get 안 함');
    assert.equal(calls.filter(x => x[0] === 'get' && x[2] === 'full').length, 1);
});

test('Gmail 쿼터: 쿼터 오류만 쉬고, 다른 오류는 바로 실패', async () => {
    assert.ok(isQuotaError({ code: 429 }));
    assert.ok(isQuotaError({ code: 403, message: 'Quota exceeded for quota metric ... Units per minute per user' }));
    assert.ok(isQuotaError({ code: 403, errors: [{ reason: 'rateLimitExceeded' }] }));
    assert.ok(!isQuotaError({ code: 401, message: 'invalid_grant' }));
    const gmail = { users: { messages: { list: async () => { const e = new Error('invalid_grant'); e.code = 400; throw e; } } } };
    const c = clock();
    await assert.rejects(pollOtp(gmail, { now: c.now, sleep: c.sleep, log: quiet }), /invalid_grant/);
    assert.match(SYNC, /pollOtp\(gmailClient\(\)/);
    assert.ok(!/format: 'full'/.test(SYNC), 'sync.mjs 에 옛 full 반복 get 이 남지 않음');
});
