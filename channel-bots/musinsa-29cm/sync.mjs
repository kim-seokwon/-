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
  MUSINSA_ID, MUSINSA_PW,
  GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN,
  SUPABASE_URL, SUPABASE_SERVICE_KEY,
} = process.env;

if (!MUSINSA_ID || !MUSINSA_PW || !GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.log('[29cm] 자격증명 미설정 — 수집 건너뜀. (MUSINSA_ID/PW, GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN, SUPABASE_* 필요)');
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
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });

  // ID/PW (통합 SSO — 실측 확정 필요 시 셀렉터 보강)
  await page.fill('input[name="loginId"], input[type="text"], input[type="email"]', MUSINSA_ID);
  await page.fill('input[name="password"], input[type="password"]', MUSINSA_PW);
  await page.click('button:has-text("로그인"), button[type="submit"]');
  await page.waitForTimeout(2500);

  // 2차 인증: '이메일' 탭 선택 → 코드 전송됨 → IMAP으로 읽어 입력
  const emailTab = page.locator('button:has-text("이메일"), [role="tab"]:has-text("이메일")').first();
  if (await emailTab.isVisible().catch(() => false)) await emailTab.click();
  await page.waitForTimeout(1500);
  const sentAt = Date.now() - 60000;
  const code = await readEmailOtp({ sinceMs: sentAt });
  await page.fill('input[placeholder*="인증"], input[type="tel"], input[type="text"]', code);
  await page.click('button:has-text("인증"), button[type="submit"]');
  await page.waitForURL(/29cm\.co\.kr|partner-connect/, { timeout: 30000 }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
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
  const browser = await chromium.launch({ headless: true });
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
