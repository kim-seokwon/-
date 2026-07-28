// ============================================================
//  29CM · 무신사(통합 파트너) 주문 수집 봇
//  통합 SSO 로그인(ID/PW + TOTP 자체생성) → 주문 API 응답 가로채기 → Supabase
//
//  로그인: partner-sso.one.musinsa.com/oauth/login?clientId=E9_PARTNER
//    2FA = TOTP(구글 OTP). 최초 등록 QR의 설정키가 시크릿(키디키디와 동일 방식).
//  29CM 주문 API(역추적 확인):
//    GET https://commerce-admin-api.29cm.co.kr/partner-admin/v4/orders
//        ?fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD&dateConditionType=ORDERED_AT&page=1&size=50
//    응답 envelope: { result, data:{...주문 배열...}, errorCode, message }
//    인증 = 메모리 Bearer 토큰 → 스토리지/쿠키에 없음 → Playwright가 로그인 세션에서
//    주문조회 페이지 진입 시 브라우저가 자동 인증하므로, 그 응답을 page.on('response')로 가로챈다.
//
//  환경변수(GitHub Secrets):
//    MUSINSA_ID, MUSINSA_PW, MUSINSA_TOTP_SECRET  (통합 파트너 로그인, TOTP 설정키)
//    SUPABASE_URL, SUPABASE_SERVICE_KEY
//
//  ⚠️ 로그인 폼(ID/PW) 셀렉터는 캡처 세션에서 최종 확정 필요(아래 TODO).
//     주문 응답 실제 필드명도 첫 실주문에서 mapOrder 미세조정.
// ============================================================
import { chromium } from 'playwright';
import { authenticator } from 'otplib';
import { createClient } from '@supabase/supabase-js';

const {
  MUSINSA_ID, MUSINSA_PW, MUSINSA_TOTP_SECRET,
  SUPABASE_URL, SUPABASE_SERVICE_KEY,
} = process.env;

const LOGIN_URL = 'https://partner-sso.one.musinsa.com/oauth/login?clientId=E9_PARTNER&platform=29cm&redirectUri=https%3A%2F%2Fpartner-auth.29cm.co.kr%2F';
const ORDER_PAGE = 'https://partner-order.29cm.co.kr/list';
const ORDER_API_RE = /commerce-admin-api\.29cm\.co\.kr\/partner-admin\/v4\/orders/;
const MALL_KEY = '29cm';
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

function ymd(d) { return d.toISOString().slice(0, 10); }

async function login(browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });

  // TODO(캡처): 통합 SSO ID/PW 실제 셀렉터 확정
  await page.fill('input[name="loginId"], input[type="text"], input[type="email"]', MUSINSA_ID);
  await page.fill('input[name="password"], input[type="password"]', MUSINSA_PW);
  await page.click('button[type="submit"], .btn-login, button:has-text("로그인")');

  // 2FA = TOTP: OTP 입력칸에 자체생성 6자리 → 인증하기
  await page.waitForTimeout(2000);
  const otp = page.locator('input[placeholder*="인증"], input[type="tel"], input[type="text"]').first();
  if (await otp.isVisible().catch(() => false)) {
    await otp.fill(authenticator.generate(MUSINSA_TOTP_SECRET));
    await page.click('button:has-text("인증"), button[type="submit"]');
  }
  await page.waitForURL(/29cm\.co\.kr|partner-connect/, { timeout: 30000 }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  return { ctx, page };
}

// 주문 조회 페이지 진입 → 브라우저가 인증된 orders API 호출 → 그 응답을 가로챈다
async function fetchOrders(page, fromDate, toDate) {
  const captured = new Promise((resolve) => {
    page.on('response', async (res) => {
      if (ORDER_API_RE.test(res.url())) {
        try { resolve(await res.json()); } catch { resolve(null); }
      }
    });
  });
  const url = `${ORDER_PAGE}?fromDate=${fromDate}&toDate=${toDate}&dateConditionType=ORDERED_AT&periodTemplate=31&page=1&size=200`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const body = await Promise.race([
    captured,
    new Promise((r) => setTimeout(() => r(null), 20000)),
  ]);
  if (!body) throw new Error('주문 API 응답 캡처 실패(로그인/셀렉터 확인)');
  return body;
}

function extractList(body) {
  const d = body?.data ?? body;
  if (Array.isArray(d)) return d;
  for (const k of ['content', 'list', 'orders', 'items', 'rows', 'orderList']) {
    if (Array.isArray(d?.[k])) return d[k];
  }
  for (const k of Object.keys(d || {})) if (Array.isArray(d[k])) return d[k];
  return [];
}

// TODO(첫 실주문에서 확정): 29CM orders 응답 실제 필드명. UI 컬럼 기준 추정 매핑.
function mapOrder(o) {
  return {
    channel: '29cm',
    mall_key: MALL_KEY,
    order_id: String(o.orderNumber ?? o.orderNo ?? o.orderId ?? o.id),
    order_date: o.orderedAt ?? o.orderDate ?? o.paymentCompletedAt ?? null,
    buyer_name: o.ordererName ?? o.buyerName ?? null,
    receiver_name: o.receiverName ?? o.recipientName ?? null,
    receiver_phone: o.receiverPhone ?? o.recipientMobile ?? null,
    receiver_address: o.receiverAddress ?? o.address ?? null,
    pay_amount: Number(o.actualSalePrice ?? o.realSalePrice ?? o.salePrice ?? o.paymentAmount ?? 0),
    channel_status: o.orderStatus ?? o.status ?? null,
    status: 'new',
    raw: o,
  };
}

async function ensureMall() {
  const { data } = await db.from('malls').select('mall_key').eq('mall_key', MALL_KEY).maybeSingle();
  if (data) return;
  // 29CM 브랜드(하이헤이호) 매핑
  const { data: brand } = await db.from('brands').select('id').or('name.ilike.%하이헤이호%,name.ilike.%hiheyho%').maybeSingle();
  await db.from('malls').upsert({ mall_key: MALL_KEY, label: '29CM', channel: '29cm', brand_id: brand?.id ?? null, active: true, connected: true }, { onConflict: 'mall_key' });
  console.log('[29cm] malls 등록');
}

async function run() {
  await ensureMall();
  const to = new Date(), from = new Date(Date.now() - 31 * 864e5);
  const browser = await chromium.launch({ headless: true });
  try {
    const { page } = await login(browser);
    const data = await fetchOrders(page, ymd(from), ymd(to));
    const list = extractList(data);
    console.log(`[29cm] 주문 ${list.length}건`);
    if (!list.length) { console.log('[29cm] envelope keys:', JSON.stringify(Object.keys(data || {}))); return; }
    const rows = list.map(mapOrder).filter(r => r.order_id && r.order_id !== 'undefined');
    const { error } = await db.from('channel_orders').upsert(rows, { onConflict: 'mall_key,order_id', ignoreDuplicates: false });
    if (error) throw error;
    console.log(`[29cm] Supabase 저장 ${rows.length}건`);
  } finally {
    await browser.close();
  }
}

run().catch(e => { console.error('[29cm] 실패:', e); process.exit(1); });
