// ============================================================
//  무신사 · 29CM(통합 파트너) 주문 수집 봇
//  통합 SSO 로그인(ID/PW + 이메일 OTP) → 파트너 내부 API → Supabase 저장
//
//  무신사가 29CM 인수 → 통합 파트너센터 하나로 로그인:
//    https://partner-sso.one.musinsa.com/oauth/login?clientId=E9_PARTNER
//  2FA = 이메일 인증번호(TOTP 아님) → Gmail API로 코드 자동 읽기(googleapis).
//
//  환경변수(GitHub Actions Secrets / .env):
//    MUSINSA_ID, MUSINSA_PW                : 통합 파트너 로그인
//    GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN : OTP 메일 읽기용
//    SUPABASE_URL, SUPABASE_SERVICE_KEY
//
//  ⚠️ 미확정(캡처 세션 필요 — 키디키디와 동일 절차):
//    - 로그인 폼 셀렉터, OTP 입력 셀렉터
//    - 주문 조회 내부 API(엔드포인트/파라미터/응답 필드)
//    - 몰 구분(무신사 vs 29CM) 필드
// ============================================================
import { chromium } from 'playwright';
import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';

const {
  MUSINSA_ID, MUSINSA_PW,
  GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN,
  SUPABASE_URL, SUPABASE_SERVICE_KEY,
} = process.env;

const LOGIN_URL = 'https://partner-sso.one.musinsa.com/oauth/login?clientId=E9_PARTNER';
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

// Gmail에서 최근 무신사 OTP 인증번호 읽기 (봇이 사람 없이 6자리 확보)
async function readEmailOtp({ waitMs = 20000 } = {}) {
  const oauth2 = new google.auth.OAuth2(GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET);
  oauth2.setCredentials({ refresh_token: GMAIL_REFRESH_TOKEN });
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });
  const started = Date.now();
  while (Date.now() - started < waitMs) {
    const list = await gmail.users.messages.list({
      userId: 'me', q: 'from:(musinsa.com OR 29cm.co.kr) newer_than:1h 인증', maxResults: 5,
    });
    for (const m of list.data.messages ?? []) {
      const msg = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'full' });
      const body = decodeMsg(msg.data);
      const code = (body.match(/\b(\d{6})\b/) || [])[1];
      if (code) return code;
    }
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error('OTP 메일에서 인증번호를 찾지 못함');
}
function decodeMsg(data) {
  const parts = [];
  const walk = p => { if (p.body?.data) parts.push(Buffer.from(p.body.data, 'base64').toString('utf-8')); (p.parts || []).forEach(walk); };
  walk(data.payload || {});
  return parts.join('\n');
}

async function login(browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });

  // TODO(캡처): 통합 SSO 실제 셀렉터 확정
  await page.fill('input[name="loginId"], input[type="text"], input[type="email"]', MUSINSA_ID);
  await page.fill('input[name="password"], input[type="password"]', MUSINSA_PW);
  await page.click('button[type="submit"], .btn-login');

  // 이메일 OTP 단계
  await page.waitForTimeout(2000);
  const otpBox = page.locator('input[name="authNo"], input[name="otp"], input[type="tel"]').first();
  if (await otpBox.isVisible().catch(() => false)) {
    const code = await readEmailOtp();
    await otpBox.fill(code);
    await page.click('button:has-text("확인"), button:has-text("인증"), button[type="submit"]');
  }
  await page.waitForLoadState('networkidle').catch(() => {});
  return { ctx, page };
}

// TODO(캡처): 주문 조회 내부 API. 키디키디처럼 파트너센터 네트워크 로그에서 확정.
async function fetchOrders(/* page, from, to */) {
  throw new Error('주문 API 미확정 — 캡처 세션에서 엔드포인트/파라미터/응답 필드 확정 필요');
}

// TODO(캡처): 실제 응답 필드에 맞춰 조정. mall_key는 무신사/29cm 구분.
function mapOrder(o, mallKey) {
  return {
    channel: 'musinsa',
    mall_key: mallKey,                 // 'musinsa' | '29cm'
    order_id: String(o.orderNo ?? o.orderId),
    order_date: o.orderedAt ?? o.orderDate ?? null,
    buyer_name: o.ordererName ?? null,
    receiver_name: o.receiverName ?? null,
    receiver_phone: o.receiverPhone ?? null,
    receiver_address: o.receiverAddress ?? null,
    pay_amount: Number(o.payAmount ?? o.totalAmount ?? 0),
    channel_status: o.status ?? null,
    status: 'new',
    raw: o,
  };
}

async function ensureMalls() {
  for (const [key, label] of [['musinsa', '무신사'], ['29cm', '29CM']]) {
    const { data } = await db.from('malls').select('mall_key').eq('mall_key', key).maybeSingle();
    if (!data) await db.from('malls').upsert({ mall_key: key, label, channel: 'musinsa', brand_id: null, active: true, connected: true }, { onConflict: 'mall_key' });
  }
}

async function run() {
  await ensureMalls();
  const browser = await chromium.launch({ headless: true });
  try {
    const { page } = await login(browser);
    const list = await fetchOrders(page);          // 미확정 — 캡처 후 구현
    const rows = list.map(o => mapOrder(o, o.mallKey || 'musinsa'));
    if (rows.length) {
      const { error } = await db.from('channel_orders').upsert(rows, { onConflict: 'mall_key,order_id' });
      if (error) throw error;
      console.log(`[musinsa-29cm] 저장 ${rows.length}건`);
    }
  } finally {
    await browser.close();
  }
}

run().catch(e => { console.error('[musinsa-29cm] 실패:', e); process.exit(1); });
