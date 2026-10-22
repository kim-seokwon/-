// ============================================================
//  29CM · 무신사(통합 파트너) 주문 수집 봇 — 이메일 OTP 자동
//  로그인(ID/PW) → 이메일 2차인증 코드를 Gmail IMAP으로 자동 읽기 → 주문 API 응답 가로채기 → Supabase
//
//  로그인: partner-sso.one.musinsa.com/oauth/login?clientId=E9_PARTNER
//    2FA: OTP(구글 인증기) 또는 이메일. 봇은 '이메일' 탭 선택 → 코드가 Gmail로 옴 → IMAP으로 읽음.
//  29CM 주문 API(역추적): GET commerce-admin-api.29cm.co.kr/partner-admin/v4/orders
//    인증=메모리 Bearer → page.on('response')로 주문응답 가로채기.
//
//  환경변수(GitHub Secrets):
//    CM29_ID, CM29_PW (+ CM29_TOTP_SECRET, CM29_OTP_TO)          : 하이헤이호 → mall_key 29cm
//    CM29_ID_2, CM29_PW_2 (+ CM29_TOTP_SECRET_2, CM29_OTP_TO_2)  : 로하이스튜디오 → mall_key 29cm-rohi (없으면 건너뜀)
//    GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN : 이메일 OTP 읽기(TOTP 없는 계정만 씀)
//    SUPABASE_URL, SUPABASE_SERVICE_KEY
//  계정은 하나씩 차례로 — 한 계정이 실패해도 다음 계정은 돈다. 하나라도 실패하면 끝에 exit 1(Actions 에 빨간불).
// ============================================================
import { chromium } from 'playwright';
import { google } from 'googleapis';
import { authenticator } from 'otplib';
import { createClient } from '@supabase/supabase-js';
import { accountsFromEnv, otpNotBefore, pollOtp, orderKey, mapOrder, runAccounts } from './accounts.mjs';

const {
  GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN,
  SUPABASE_URL, SUPABASE_SERVICE_KEY,
} = process.env;

const HAS_GMAIL = !!(GMAIL_CLIENT_ID && GMAIL_CLIENT_SECRET && GMAIL_REFRESH_TOKEN);
const { run: ACCOUNTS, skip: SKIPPED } = accountsFromEnv(process.env, HAS_GMAIL);
for (const s of SKIPPED) console.log(`[29cm:${s.brand}] 건너뜀 — ${s.why}`);
if (!ACCOUNTS.length || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.log('[29cm] 돌릴 계정 없음(또는 SUPABASE_* 없음) — 수집 건너뜀.');
  process.exit(0);
}

const LOGIN_URL = 'https://partner-sso.one.musinsa.com/oauth/login?clientId=E9_PARTNER&platform=29cm&redirectUri=https%3A%2F%2Fpartner-auth.29cm.co.kr%2F';
const ORDER_PAGE = 'https://partner-order.29cm.co.kr/list';
const ORDER_API_RE = /commerce-admin-api\.29cm\.co\.kr\/partner-admin\/v4\/orders/;
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const ymd = d => d.toISOString().slice(0, 10);

// Gmail API로 최근 29CM/무신사 인증코드(6자리) 읽기
function gmailClient() {
  const o = new google.auth.OAuth2(GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET);
  o.setCredentials({ refresh_token: GMAIL_REFRESH_TOKEN });
  return google.gmail({ version: 'v1', auth: o });
}
//  usedIds = 이번 실행에서 이미 쓴 메일 id(다른 계정 코드 재사용 금지) · to = 그 계정 인증 메일 받는 주소(선택)
//  돌려줌 { code, id, receivedAt }. 폴링·쿼터 백오프는 accounts.mjs pollOtp
const readEmailOtp = (opts = {}) => pollOtp(gmailClient(), { notBeforeMs: Date.now() - 5 * 60_000, ...opts });

//  이번 실행에서 쓴 OTP 메일 — 다음 계정이 같은 메일(앞 계정 코드)을 집지 않게
const usedOtpIds = new Set();
let lastOtpAt = 0;

async function newCtx(browser) {
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
    locale: 'ko-KR',
  });
  // 자동화 탐지 우회(navigator.webdriver 숨김)
  await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
  return ctx;
}

async function login(page, acct) {
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });

  // 실측 셀렉터: 아이디=name=id / 비번=name=password / 로그인=button[type=submit]
  await page.fill('input[name="id"], input[type="text"]', acct.id);
  await page.fill('input[name="password"]', acct.pw);
  console.log(`[29cm:${acct.brand}] 로그인 폼 입력 완료 → 제출`);
  await page.click('button[type="submit"]');

  // 2차 인증 화면 대기: 인증코드 입력칸(항상 존재)이 뜰 때까지
  const codeInput = page.locator('input[name="code"], input[placeholder*="인증코드"]');
  try {
    await codeInput.waitFor({ state: 'visible', timeout: 30000 });
  } catch (e) {
    const title = await page.title().catch(() => '');
    const bodyTxt = (await page.evaluate(() => document.body.innerText).catch(() => '')).slice(0, 400);
    console.error(`[29cm] 2차인증 화면 미도달. title="${title}" body="${bodyTxt.replace(/\n/g, ' ')}"`);
    throw new Error('로그인 후 2차인증 화면에 도달하지 못함');
  }
  console.log('[29cm] 2차인증 화면 도달');

  let code;
  if (acct.totp) {
    //  OTP 탭(첫 라디오) — 설정키로 6자리 자체 생성. 30초 경계에 걸리면 새 창으로 넘어간 뒤 만든다.
    await page.locator('input[type="radio"]').nth(0).check().catch(() => {});
    await page.waitForTimeout(500);
    if (authenticator.timeRemaining() < 5) await page.waitForTimeout(authenticator.timeRemaining() * 1000 + 500);
    code = authenticator.generate(acct.totp);
    console.log('[29cm] 2차인증 = 구글 OTP(TOTP) 자체 생성');
  } else {
  // '이메일' 탭 라디오 선택(기본 선택이지만 안전하게)
  await page.locator('input[type="radio"]').nth(1).check().catch(() => {});
  await page.waitForTimeout(500);
  // 2차 인증 화면 진입 시 첫 메일은 자동 발송되는 경우가 있다.
  // 재요청 버튼이 비활성인 동안 기다렸다 강제 클릭하면 쿨다운이 긴 계정에서 계속 실패하므로,
  // 활성일 때만 새 메일을 요청하고 아니면 이미 발송된 최신 메일을 바로 읽는다.
  const reqBtn = page.getByRole('button', { name: /인증번호 받기|인증번호 재요청/ }).first();
  await reqBtn.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
  const requested = await reqBtn.isEnabled().catch(() => false);
  const notBeforeMs = otpNotBefore({ now: Date.now(), requested, floor: lastOtpAt });
  if (requested) {
    await reqBtn.click({ timeout: 10000 });
    console.log(`[29cm] 인증번호 새 발송 요청 (${new Date().toISOString()}) → 메일 대기`);
  } else {
    console.log('[29cm] 인증번호가 이미 발송됨(재요청 쿨다운) → 최신 메일 바로 확인');
  }

  try {
    const hit = await readEmailOtp({ notBeforeMs, usedIds: usedOtpIds, to: acct.otpTo });
    usedOtpIds.add(hit.id); lastOtpAt = Math.max(lastOtpAt, hit.receivedAt || 0);
    code = hit.code;
  } catch (e) {
    //  invalid_grant = Gmail 재동의 필요(구글 OAuth 앱이 '테스트' 상태면 7일마다 만료). 원인을 한 줄로 남긴다.
    if (/invalid_grant/.test(String(e && (e.message || e)))) console.error('[29cm] 판정: Gmail refresh_token 만료/철회(invalid_grant) → CM29_TOTP_SECRET 으로 전환하거나 Gmail 재동의');
    throw e;
  }
  }
  console.log('[29cm] OTP 코드 수신 → 입력');
  await page.fill('input[name="code"], input[placeholder*="인증코드"]', code);
  await page.getByRole('button', { name: /인증하기/ }).click();
  await page.waitForURL(/29cm\.co\.kr|partner-connect|partner-order/, { timeout: 30000 }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  if (/partner-sso\.one\.musinsa\.com/.test(page.url())) {
    const bodyTxt = (await page.evaluate(() => document.body.innerText).catch(() => '')).slice(0, 300).replace(/\n/g, ' ');
    console.error(`[29cm] 2차인증 후에도 로그인 화면. body="${bodyTxt}"`);
    throw new Error('2차인증 실패(코드 틀림/만료 가능)');
  }
  console.log(`[29cm:${acct.brand}] 로그인 완료`);
}

// 주문조회 페이지 진입 → 인증된 orders API 응답 가로채기 (3개월 청킹)
async function fetchWindow(page, fromDate, toDate) {
  const captured = [];
  const handler = async (res) => { if (ORDER_API_RE.test(res.url())) { try { captured.push(await res.json()); } catch {} } };
  page.on('response', handler);
  await page.goto(`${ORDER_PAGE}?fromDate=${fromDate}&toDate=${toDate}&dateConditionType=ORDERED_AT&page=1&size=100`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  page.off('response', handler);
  const body = captured.find(b => b?.data);
  return (body?.data?.content || body?.data?.list || []);
}

//  계정의 몰이 없으면 만든다(있으면 안 건드림) — 브랜드는 이름으로 찾고, 못 찾으면 비워 두고 알린다
async function ensureMall(acct) {
  const { data, error: selErr } = await db.from('malls').select('mall_key').eq('mall_key', acct.mallKey).maybeSingle();
  if (selErr) throw selErr;   // 조회가 실패했는데 '없다'로 보고 upsert 하면 있던 몰의 브랜드 연결을 지운다
  if (data) return;
  const { data: brand } = await db.from('brands').select('id').or(acct.brandMatch.map(n => `name.ilike.%${n}%`).join(',')).limit(1).maybeSingle();
  if (!brand) console.warn(`[29cm:${acct.brand}] 브랜드를 못 찾음 — 몰 ${acct.mallKey} 를 브랜드 없이 만든다(설정에서 연결)`);
  const { error } = await db.from('malls').upsert({ mall_key: acct.mallKey, label: acct.mallLabel, channel: '29cm', brand_id: brand?.id ?? null, active: true, connected: true }, { onConflict: 'mall_key' });
  if (error) throw error;
}

//  계정 하나 = 로그인 창 하나. 끝나면 그 창을 닫는다(다음 계정과 세션이 섞이지 않게)
async function syncAccount(browser, acct) {
  await ensureMall(acct);
  const ctx = await newCtx(browser);   // 로그인이 실패해도 finally 에서 닫힌다
  try {
    const page = await ctx.newPage();
    await login(page, acct);
    // 최근 400일을 88일 창으로 청킹
    const all = [];
    const end = Date.now(), CH = 88 * 864e5;
    for (let ws = end - 400 * 864e5; ws <= end; ws += CH + 864e5) {
      const we = Math.min(ws + CH, end);
      all.push(...await fetchWindow(page, ymd(new Date(ws)), ymd(new Date(we))));
    }
    const byId = {};
    for (const o of all) { const k = orderKey(o); if (k) byId[k] = o; }
    const rows = Object.values(byId).map(o => mapOrder(o, acct.mallKey)).filter(r => r.order_id && r.order_id !== 'undefined');
    console.log(`[29cm:${acct.brand}] 주문 ${rows.length}건`);
    if (rows.length) {
      const { error } = await db.from('channel_orders').upsert(rows, { onConflict: 'mall_key,order_id' });
      if (error) throw error;
      console.log(`[29cm:${acct.brand}] Supabase 저장 ${rows.length}건 (${acct.mallKey})`);
    }
    return rows.length;
  } finally { await ctx.close().catch(() => {}); }
}

async function run() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });
  let results;
  try { results = await runAccounts(ACCOUNTS, a => syncAccount(browser, a)); }
  finally { await browser.close(); }
  console.log('[29cm] 결과:', results.map(r => `${r.brand} ${r.ok ? `${r.count}건` : '실패'}`).join(' · '));
  if (results.some(r => !r.ok)) process.exit(1);
}

run().catch(e => { console.error('[29cm] 실패:', e); process.exit(1); });
