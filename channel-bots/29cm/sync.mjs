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
//    MUSINSA_ID, MUSINSA_PW              : 통합 파트너 로그인
//    GMAIL_USER, GMAIL_APP_PASSWORD      : OTP 메일 수신 Gmail + 앱 비밀번호(16자, 2FA 계정에서 생성)
//    SUPABASE_URL, SUPABASE_SERVICE_KEY
// ============================================================
import { chromium } from 'playwright';
import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';

const {
  CM29_ID, CM29_PW,
  GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN,
  SUPABASE_URL, SUPABASE_SERVICE_KEY,
} = process.env;

if (!CM29_ID || !CM29_PW || !GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.log('[29cm] 자격증명 미설정 — 수집 건너뜀. (CM29_ID/PW, GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN, SUPABASE_* 필요)');
  process.exit(0);
}

const LOGIN_URL = 'https://partner-sso.one.musinsa.com/oauth/login?clientId=E9_PARTNER&platform=29cm&redirectUri=https%3A%2F%2Fpartner-auth.29cm.co.kr%2F';
const ORDER_PAGE = 'https://partner-order.29cm.co.kr/list';
const ORDER_API_RE = /commerce-admin-api\.29cm\.co\.kr\/partner-admin\/v4\/orders/;
const MALL_KEY = '29cm';
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const ymd = d => d.toISOString().slice(0, 10);

// Gmail API로 최근 29CM/무신사 인증코드(6자리) 읽기
function gmailClient() {
  const o = new google.auth.OAuth2(GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET);
  o.setCredentials({ refresh_token: GMAIL_REFRESH_TOKEN });
  return google.gmail({ version: 'v1', auth: o });
}
async function readEmailOtp({ afterEpochSec = Math.floor(Date.now() / 1000) - 180, timeoutMs = 90000 } = {}) {
  const gmail = gmailClient();
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const q = `(from:29cm.co.kr OR from:musinsa.com OR subject:인증) after:${afterEpochSec}`;
    const list = await gmail.users.messages.list({ userId: 'me', q, maxResults: 8 });
    for (const m of (list.data.messages || [])) {
      const msg = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'full' });
      const parts = [];
      const walk = p => { if (p.body?.data) parts.push(Buffer.from(p.body.data, 'base64').toString('utf-8')); (p.parts || []).forEach(walk); };
      walk(msg.data.payload || {});
      const code = (parts.join('\n').match(/\b(\d{6})\b/) || [])[1];
      if (code) return code;
    }
    await new Promise(r => setTimeout(r, 4000));
  }
  throw new Error('OTP 메일에서 인증번호를 못 찾음');
}

async function login(browser) {
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
    locale: 'ko-KR',
  });
  // 자동화 탐지 우회(navigator.webdriver 숨김)
  await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
  const page = await ctx.newPage();
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });

  // 실측 셀렉터: 아이디=name=id / 비번=name=password / 로그인=button[type=submit]
  await page.fill('input[name="id"], input[type="text"]', CM29_ID);
  await page.fill('input[name="password"]', CM29_PW);
  console.log('[29cm] 로그인 폼 입력 완료 → 제출');
  await page.click('button[type="submit"]');

  // 2차 인증 화면 대기: '인증번호 받기' 버튼(이메일 탭 기본선택)이 뜰 때까지
  const requestBtn = page.getByRole('button', { name: /인증번호 받기|인증번호 재요청/ });
  try {
    await requestBtn.waitFor({ state: 'visible', timeout: 30000 });
  } catch (e) {
    // 2차인증에 도달 못함 → 로그인 실패/봇탐지 가능. 현재 페이지 상태를 로그로 남김
    const title = await page.title().catch(() => '');
    const bodyTxt = (await page.evaluate(() => document.body.innerText).catch(() => '')).slice(0, 400);
    console.error(`[29cm] 2차인증 화면 미도달. title="${title}" body="${bodyTxt.replace(/\n/g, ' ')}"`);
    throw new Error('로그인 후 2차인증 화면에 도달하지 못함');
  }

  // '이메일' 탭 라디오 명시적 선택(기본 선택이지만 안전하게), 이후 '인증번호 받기'
  const emailRadio = page.locator('input[type="radio"]').nth(1);
  await emailRadio.check().catch(() => {});
  await page.waitForTimeout(500);
  await requestBtn.click();
  const sentEpochSec = Math.floor(Date.now() / 1000); // 이 시점 이후 도착한 메일만 읽음
  console.log('[29cm] 인증번호 받기 클릭 → 메일 대기');
  await page.waitForTimeout(1500);

  const code = await readEmailOtp({ afterEpochSec: sentEpochSec });
  console.log('[29cm] OTP 코드 수신 → 입력');
  await page.fill('input[name="code"], input[placeholder*="인증코드"]', code);
  await page.getByRole('button', { name: /인증하기/ }).click();
  await page.waitForURL(/29cm\.co\.kr|partner-connect|partner-order/, { timeout: 30000 }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  console.log('[29cm] 로그인 완료');
  return { ctx, page };
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

function mapOrder(o) {
  return {
    channel: '29cm', mall_key: MALL_KEY,
    order_id: String(o.orderNumber ?? o.orderNo ?? o.orderId ?? o.id),
    order_date: o.orderedAt ?? o.orderDate ?? o.paymentCompletedAt ?? null,
    buyer_name: o.ordererName ?? o.buyerName ?? null,
    receiver_name: o.receiverName ?? o.recipientName ?? null,
    receiver_phone: o.receiverPhone ?? null, receiver_address: o.receiverAddress ?? null,
    pay_amount: Number(o.actualSalePrice ?? o.realSalePrice ?? o.salePrice ?? o.paymentAmount ?? 0),
    channel_status: o.orderStatus ?? o.status ?? null, status: 'new', raw: o,
  };
}

async function ensureMall() {
  const { data } = await db.from('malls').select('mall_key').eq('mall_key', MALL_KEY).maybeSingle();
  if (data) return;
  const { data: brand } = await db.from('brands').select('id').or('name.ilike.%하이헤이호%,name.ilike.%hiheyho%').maybeSingle();
  await db.from('malls').upsert({ mall_key: MALL_KEY, label: '29CM', channel: '29cm', brand_id: brand?.id ?? null, active: true, connected: true }, { onConflict: 'mall_key' });
}

async function run() {
  await ensureMall();
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });
  try {
    const { page } = await login(browser);
    // 최근 400일을 88일 창으로 청킹
    const all = [];
    const end = Date.now(), CH = 88 * 864e5;
    for (let ws = end - 400 * 864e5; ws <= end; ws += CH + 864e5) {
      const we = Math.min(ws + CH, end);
      all.push(...await fetchWindow(page, ymd(new Date(ws)), ymd(new Date(we))));
    }
    const byId = {};
    for (const o of all) { const k = String(o.orderNumber ?? o.orderNo ?? o.orderId ?? o.id); if (k) byId[k] = o; }
    const rows = Object.values(byId).map(mapOrder).filter(r => r.order_id && r.order_id !== 'undefined');
    console.log(`[29cm] 주문 ${rows.length}건`);
    if (rows.length) {
      const { error } = await db.from('channel_orders').upsert(rows, { onConflict: 'mall_key,order_id' });
      if (error) throw error;
      console.log(`[29cm] Supabase 저장 ${rows.length}건`);
    }
  } finally { await browser.close(); }
}

run().catch(e => { console.error('[29cm] 실패:', e); process.exit(1); });
