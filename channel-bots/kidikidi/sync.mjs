// ============================================================
//  키디키디(E·LAND 파트너오피스) 주문 수집 봇
//  로그인(ID/PW + TOTP 자체생성) → 세션쿠키 → 내부 주문 API 호출 → Supabase 저장
//
//  E·LAND 파트너오피스는 내부 JSON API를 씀 (역추적 확인):
//    GET https://po.elandbo.co.kr/o/order/lookup/orders?fromSearchDate=..&toSearchDate=..&orderCodes=1010,..&size=100&page=1
//  → 화면 스크래핑 없이 이 API를 세션쿠키로 호출하면 주문이 JSON으로 옴.
//
//  환경변수(GitHub Actions Secrets / .env):
//    ELAND_ID, ELAND_PW           : 파트너오피스 로그인
//    ELAND_TOTP_SECRET            : OTP 재등록 시 나오는 "설정 키"(base32). 봇이 이걸로 6자리 자체생성.
//    SUPABASE_URL, SUPABASE_SERVICE_KEY
// ============================================================
import { chromium } from 'playwright';
import { authenticator } from 'otplib';
import { createClient } from '@supabase/supabase-js';

const {
  ELAND_ID, ELAND_PW, ELAND_TOTP_SECRET,
  SUPABASE_URL, SUPABASE_SERVICE_KEY,
} = process.env;

const BASE = 'https://po.elandbo.co.kr';
const MALL_KEY = 'kidikidi';
// 주문상태 코드: 신규~배송준비 (역추적한 orderCodes). 필요시 조정.
const ORDER_CODES = '1010,1020,1030,1040,1050,1060';

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

function ymd(d) { return d.toISOString().slice(0, 10); }

// 1) 로그인 → 세션쿠키가 담긴 Playwright context 반환
async function login(browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });

  // TODO(셀렉터 확정): 실제 로그인 페이지에서 id/pw input name 확인 후 채우기
  await page.fill('input[name="userId"], #userId, input[type="text"]', ELAND_ID);
  await page.fill('input[name="password"], #password, input[type="password"]', ELAND_PW);
  await page.click('button[type="submit"], .btn-login');

  // 2차 인증: TOTP 6자리 — 시크릿으로 자체 생성 (이메일/문자 필요 없음)
  await page.waitForTimeout(1500);
  if (await page.locator('input').first().isVisible().catch(() => false)) {
    const code = authenticator.generate(ELAND_TOTP_SECRET);
    await page.fill('input[type="text"], input[type="tel"], input[type="number"]', code);
    await page.click('button:has-text("인증"), button[type="submit"], .btn-auth');
  }
  await page.waitForLoadState('networkidle').catch(() => {});
  return { ctx, page };
}

// 2) 내부 주문 API 호출 (세션쿠키 자동 포함)
async function fetchOrders(page, fromDate, toDate) {
  const url = `${BASE}/o/order/lookup/orders?d=on`
    + `&fromSearchDate=${fromDate}&toSearchDate=${toDate}`
    + `&ordPsnInfoCondition=cellphone&receiverInfoCondition=name`
    + `&orderCodes=${encodeURIComponent(ORDER_CODES)}`
    + `&searchOrderStatus=true&size=200&page=1&_=${Date.now()}`;
  const res = await page.request.get(url);
  if (!res.ok()) throw new Error(`주문 API 실패 ${res.status()}: ${await res.text()}`);
  return res.json();
}

// 3) 응답 → channel_orders 매핑 (TODO: 실제 JSON 필드명에 맞춰 조정)
function mapOrder(o) {
  return {
    channel: 'eland',
    mall_key: MALL_KEY,
    order_id: String(o.orderNo ?? o.orderCode ?? o.ordNo),
    order_date: o.orderDate ?? o.ordDt ?? o.paymentDate ?? null,
    buyer_name: o.ordererName ?? o.ordPsnName ?? null,
    receiver_name: o.receiverName ?? o.rcvrName ?? null,
    receiver_phone: o.receiverPhone ?? o.rcvrCellphone ?? null,
    receiver_address: o.receiverAddress ?? o.rcvrAddr ?? null,
    pay_amount: Number(o.payAmount ?? o.salePrice ?? o.ordAmt ?? 0),
    status: 'new',
    raw: o,
  };
}

async function run() {
  const to = new Date();
  const from = new Date(Date.now() - 30 * 864e5); // 최근 30일
  const browser = await chromium.launch({ headless: true });
  try {
    const { page } = await login(browser);
    const data = await fetchOrders(page, ymd(from), ymd(to));
    const list = data.content ?? data.list ?? data.orders ?? data.data ?? [];
    console.log(`[kidikidi] 주문 ${list.length}건 수집`);
    if (list.length) {
      const rows = list.map(mapOrder);
      const { error } = await db.from('channel_orders')
        .upsert(rows, { onConflict: 'channel,order_id', ignoreDuplicates: false });
      if (error) throw error;
      console.log(`[kidikidi] Supabase 저장 완료 ${rows.length}건`);
    }
  } finally {
    await browser.close();
  }
}

run().catch(e => { console.error('[kidikidi] 실패:', e); process.exit(1); });
