//  29CM 봇 2계정(하이헤이호 29cm · 로하이스튜디오 29cm-rohi) — 계정 목록 · OTP 메일 재사용 금지 · 한 계정 실패 격리 · 화면 29CM 합치기
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    accountsFromEnv, otpFromText, otpQueries, otpMailUsable, otpNotBefore, groupOrders, mapOrder, runAccounts, is29cmKey,
    pollOtp, isQuotaError, OTP_POLL_MS, OTP_BACKOFF_MS, htmlToText, mailText, maskDigits, OTP_VALID_MS, OTP_SKEW_MS, OTP_REQ_BTN_RE, OTP_COOLDOWN_RE, maskPage,
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
    assert.equal(otpNotBefore({ now, requested: false }), now - 240_000, '쿨다운이면 유효 3분+오차 1분 전부터');
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

test('주문 매핑: 실제 API(상품 줄) → 주문번호로 묶기 · 금액 합 · 계정 몰로 저장', () => {
    const lines = [
        { orderItemManageId: 1, orderSerial: 'A1', orderedAt: '2026-10-22T10:00:00', saleAmount: 15000, sellAmount: 18000, orderStatusDescription: '배송완료', orderName: '가' },
        { orderItemManageId: 2, orderSerial: 'A1', orderedAt: '2026-10-22T10:00:00', saleAmount: 5000, sellAmount: 6000, orderStatusDescription: '배송완료' },
        { orderItemManageId: 2, orderSerial: 'A1', saleAmount: 5000 },          // 창 겹침으로 같은 줄 재수신
        { orderItemManageId: 3, orderSerial: 'B2', saleAmount: 7000, orderStatusDescription: '취소' },
        { orderItemManageId: 4, saleAmount: 1 },                                  // 주문번호 없음 → 버림
    ];
    const g = groupOrders(lines);
    assert.equal(g.length, 2);
    const r = mapOrder(g.find(x => x.orderSerial === 'A1'), '29cm-rohi');
    assert.equal(r.mall_key, '29cm-rohi'); assert.equal(r.channel, '29cm'); assert.equal(r.order_id, 'A1');
    assert.equal(r.pay_amount, 20000); assert.equal(r.order_amount, 24000); assert.equal(r.raw.items.length, 2);
    const b = mapOrder(g.find(x => x.orderSerial === 'B2'), '29cm');
    assert.equal(b.channel_status, '2:취소'); assert.equal(b.pay_amount, 0);
    assert.equal(r.channel_status, '1:배송완료');
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
            return { data: { internalDate: String(m.at), payload: a.format === 'full' ? (m.payload ? { headers, ...m.payload } : { headers, body: { data: b64(m.body) } }) : { headers } } };
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

test('Gmail 쿼터 반려1: full 조회가 429 면 같은 메일을 15초 뒤 다시 full 로 읽는다', async () => {
    const c = clock();
    const { gmail, calls } = fakeGmail([{ id: 'otp', at: 1e12, subject: '[29CM] 인증', body: '인증번호는 482913 입니다' }], { quotaAt: [3] });
    const sleeps = []; const sleep = async ms => { sleeps.push(ms); await c.sleep(ms); };
    const hit = await pollOtp(gmail, { notBeforeMs: 1e12 - 5_000, now: c.now, sleep, log: quiet });
    assert.equal(hit.code, '482913');
    assert.deepEqual(sleeps, [15000]);
    assert.equal(calls.filter(x => x[0] === 'get' && x[2] === 'full').length, 2, 'full 429 → 재시도 1번');
});

//  run 39736618139 의 메일 모양 — text/html 만, base64url, 코드가 '인증번호'와 멀리 떨어진 표 칸 안
const MUSINSA_HTML = `<html><head><style>td{color:#333333;font-size:14px}</style></head><body>
<table><tr><td>[무신사 · 29cm 통합계정] 2차인증 인증번호 안내</td></tr>
<tr><td>안녕하세요. 요청하신 <b>2차 인증</b>을 위한 인증번호를 안내드립니다. 아래 번호를 화면에 입력해 주세요.</td></tr>
<tr><td style="font-size:32px;letter-spacing:4px;color:#000000"><strong>&nbsp;482913&nbsp;</strong></td></tr>
<tr><td>발송 2026.10.22 15:58 · 유효시간 3분</td></tr></table></body></html>`;
const b64url = t => Buffer.from(t, 'utf-8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

test('인증번호 추출: HTML 만 있는 메일(base64url·태그 사이·색상코드 섞임)에서 코드를 읽는다', async () => {
    const payload = { mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/html', body: { data: b64url(MUSINSA_HTML) } }] };
    const text = mailText(payload);
    assert.ok(!/<|style|#000000/.test(text), '태그·style 이 걷힘');
    assert.equal(otpFromText(text), '482913');
    assert.equal(htmlToText('a&nbsp;&amp;&#52;&#x32;<br>b'), 'a &42 b');
    assert.equal(otpFromText('주문번호 2026-102215 · 색 #123456 · 15:58'), null, '날짜·색상코드 조각은 코드 아님');

    const c = clock();
    const { gmail } = fakeGmail([{ id: 'm', at: 1e12, subject: '[무신사 · 29cm 통합계정] 2차인증 인증번호 안내 메일입니다.', payload }]);
    const hit = await pollOtp(gmail, { notBeforeMs: 1e12 - 240_000, now: c.now, sleep: c.sleep, log: quiet });
    assert.equal(hit.code, '482913');
});

test('못 찾으면 이유를 남긴다 — 기준 전이면 몇 초 먼저인지, 코드 못 읽으면 본문 앞(숫자 가림)', async () => {
    const c = clock(), errs = [];
    const { gmail } = fakeGmail([
        { id: 'old', at: 1e12 - 340_000, subject: '옛 메일', body: '인증번호 111111' },
        { id: 'x', at: 1e12, subject: '[29CM] 안내', body: '안내 메일 1234567 입니다' },
    ]);
    await assert.rejects(pollOtp(gmail, { timeoutMs: 10_000, notBeforeMs: 1e12 - 240_000, now: c.now, sleep: c.sleep, log: { error: (...x) => errs.push(x.join(' ')) } }), /못 찾음/);
    const last = errs.at(-1);
    assert.match(last, /옛 메일 \[기준보다 100초 먼저 옴/);
    assert.match(last, /\[코드 못 읽음 · 본문 앞: 안내 메일 \*{7} 입니다\]/);
    assert.ok(!/111111|1234567/.test(last), '로그에 숫자 원문 없음');
    assert.equal(maskDigits('a 482913 b 12'), 'a ****** b 12');
});

test('반려2: 쿨다운이어도 유효시간 지난 코드(5분 전)는 안 쓰고, 다음 폴링에 온 새 코드를 쓴다', async () => {
    assert.equal(OTP_VALID_MS + OTP_SKEW_MS, 240_000);
    const c = clock(), now0 = c.now();
    const mails = [{ id: 'stale', at: now0 - 5 * 60_000, subject: '[29CM] 인증', body: '인증번호 111111' }];
    const { gmail, calls } = fakeGmail(mails);
    let rounds = 0;
    const sleep = async ms => { await c.sleep(ms); if (++rounds === 1) mails.unshift({ id: 'fresh', at: c.now(), subject: '[29CM] 인증', body: '인증번호 482913' }); };
    const notBeforeMs = otpNotBefore({ now: now0, requested: false, floor: 0 });   // 첫 계정 · 쿨다운
    const hit = await pollOtp(gmail, { notBeforeMs, now: c.now, sleep, log: quiet });
    assert.equal(hit.code, '482913'); assert.equal(hit.id, 'fresh');
    assert.ok(!calls.some(x => x[1] === 'stale' && x[2] === 'full'), '만료 메일은 본문도 안 엶');
});

test('요청 버튼 미클릭: 버튼 이름·쿨다운 문구로만 판정 · 화면 기록은 가림 · artifact 업로드', () => {
    for (const t of ['인증번호 받기', '인증번호 재요청', '인증요청', '인증번호 발송', '재발송', '인증 코드 전송', '다시 받기']) assert.match(t, OTP_REQ_BTN_RE, t);
    for (const t of ['확인', '로그인', '이메일', '인증하기']) assert.doesNotMatch(t, OTP_REQ_BTN_RE, t);
    for (const t of ['59초 후 재요청 가능', '재발송은 1분 뒤 가능합니다', '남은 시간 02:41', '잠시 후 다시 시도해 주세요']) assert.match(t, OTP_COOLDOWN_RE, t);
    for (const t of ['이메일로 인증번호를 받으세요', '2차 인증이 필요합니다', '인증번호 받기']) assert.doesNotMatch(t, OTP_COOLDOWN_RE, t);
    const m = maskPage('<p>ab.c+1@musinsa.com 로 482913</p><input value="secret">');
    assert.ok(!/musinsa\.com|482913|secret/.test(m), m);

    assert.match(SYNC, /getByLabel\(\/이메일\/\)/, '이메일은 라벨로 고른다');
    assert.match(SYNC, /OTP_COOLDOWN_RE\.test\(bodyText\)/);
    assert.match(SYNC, /if \(found && !on && !cooldown\)/, '문구 없이 비활성이면 풀리길 기다렸다 클릭');
    assert.ok(!/이미 발송됨\(재요청 쿨다운\)/.test(SYNC), '버튼 비활성만으로 쿨다운이라 하지 않음');
    assert.match(SYNC, /snap\(page, acct, '1-도달'\)/);
    assert.match(YML, /actions\/upload-artifact@v4[\s\S]*if: always\(\)[\s\S]*path: channel-bots\/29cm\/debug\//);
});
