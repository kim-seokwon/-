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

// 자격증명 미설정이면 조용히 skip(성공 종료) — GitHub Secrets 넣으면 자동 작동
if (!ELAND_ID || !ELAND_PW || !ELAND_TOTP_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.log('[kidikidi] 자격증명(Secrets) 미설정 — 수집 건너뜀. (ELAND_ID/PW/TOTP_SECRET, SUPABASE_* 설정 시 자동 시작)');
  process.exit(0);
}

const BASE = 'https://po.elandbo.co.kr';
const MALL_KEY = 'kidikidi';
// 주문상태 코드: 신규~배송준비 (역추적한 orderCodes). 필요시 조정.
const ORDER_CODES = '1010,1020,1030,1040,1050,1060';

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

function ymd(d) { return d.toISOString().slice(0, 10); }

// 1) 로그인 → 세션쿠키가 담긴 Playwright context 반환
//    로그인 페이지 셀렉터는 실제 DOM에서 확정함(2026-07):
//    #userId, #pwd, a#login(로그인하기) → TOTP: #otp_num, a#otp_certify(인증하기)
async function login(browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });

  await page.fill('#userId', ELAND_ID);
  await page.fill('#pwd', ELAND_PW);
  await page.click('a#login');

  // 2차 인증: TOTP 6자리 — 설정키로 자체 생성 (문자/이메일 OTP 아님)
  //   로그인 후 OTP 입력창(#otp_num)이 노출되면 채우고 '인증하기' 클릭
  await page.waitForSelector('#otp_num', { state: 'visible', timeout: 15000 }).catch(() => {});
  if (await page.locator('#otp_num').isVisible().catch(() => false)) {
    const code = authenticator.generate(ELAND_TOTP_SECRET);
    await page.fill('#otp_num', code);
    await page.click('a#otp_certify');
  }
  // 로그인 완료 대기: /main 진입 or 네트워크 안정
  await page.waitForURL(/\/main/, { timeout: 20000 }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  if (/\/login/.test(page.url())) {
    throw new Error('로그인 실패(여전히 /login). 아이디/비번/TOTP 설정키 확인');
  }
  return { ctx, page };
}

// 2) 내부 주문 API 호출 (세션쿠키 자동 포함)
//    실제 UI가 200 주는 요청을 그대로 재현(파라미터 누락 시 503). d=on 필수.
function orderUrl(fromDate, toDate) {
  const p = new URLSearchParams({
    d: 'on',
    fromSearchDate: fromDate, toSearchDate: toDate,
    ordPsnInfoCondition: 'cellphone', receiverInfoCondition: 'name',
    ordMediaKcodes: '10,20,30,40,50,60,70',
    orderCodes: ORDER_CODES,
    cancelCodes: '2010,2020,2030',
    takebackCodes: '3010,3020,3030,3040,3045,3050,3060',
    exchangeCodes: '4010,4020,4030,4040,4050,4045',
    selStandardCategory1: '', selStandardCategory2: '',
    selStandardCategory3: '', selStandardCategory4: '', standardCategoryNo: '',
    page: '1', searchOrderStatus: 'true', size: '200', _: String(Date.now()),
  });
  return `${BASE}/o/order/lookup/orders?${p.toString()}`;
}

async function fetchOrders(page, fromDate, toDate) {
  const res = await page.request.get(orderUrl(fromDate, toDate), {
    headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
  });
  if (!res.ok()) throw new Error(`주문 API 실패 ${res.status()}: ${(await res.text()).slice(0, 300)}`);
  const body = await res.json();
  // 응답은 envelope: { resultCode, resultMessage, ... }. 400 → 로그인 만료
  if (body && String(body.resultCode) === '400') {
    throw new Error(`세션 만료(${body.resultMessage}). 재로그인 필요`);
  }
  return body;
}

// envelope 안에서 주문 배열 추출 (성공 응답 구조는 첫 실주문에서 최종 확정)
function extractList(body) {
  if (Array.isArray(body)) return body;
  const data = body?.data ?? body?.result ?? body?.resultData ?? body;
  for (const k of ['content', 'list', 'orders', 'items', 'rows', 'resultList']) {
    if (Array.isArray(data?.[k])) return data[k];
  }
  // envelope 바로 아래에서도 탐색
  for (const k of Object.keys(body || {})) {
    if (Array.isArray(body[k])) return body[k];
  }
  return [];
}

// 3) 응답 → channel_orders 매핑 — 실 응답 필드명 확정(2026-07, 실주문 50건 실측)
//    성공 응답: { resultCode:"200", resultMessage:"success", data:{ list:[ {ordNo, ordPsnName, ...} ] } }
//    주의: 목록 API엔 수령인/주소/연락처가 없음(상세조회 필요) → 우선 null. raw에 전체 보존.
function parseTs(v) {
  if (!v) return null;
  const s = String(v);
  // 'YYYY-MM-DD HH:mm:ss' → ISO. 'YYYYMMDDHHmmss' → 분해. 그 외 null.
  if (/^\d{4}-\d\d-\d\d/.test(s)) return s.replace(' ', 'T');
  const m = s.match(/^(\d{4})(\d\d)(\d\d)(\d\d)?(\d\d)?(\d\d)?$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4] || '00'}:${m[5] || '00'}:${m[6] || '00'}`;
  return null;
}
function mapOrder(o) {
  return {
    channel: 'eland',
    mall_key: MALL_KEY,
    order_id: String(o.ordNo),
    order_date: parseTs(o.ordTs),
    buyer_name: o.ordPsnName ?? null,
    receiver_name: null,      // 목록엔 마스킹/부재 → 배송관리 상세 API에서 채움(TODO)
    receiver_phone: null,
    receiver_address: null,
    pay_amount: Number(o.sellAmount ?? o.sellPrice ?? 0),
    channel_status: o.ordChangeScode != null ? String(o.ordChangeScode) : null,
    status: 'new',            // 조회 orderCodes 1010~1060 = 배송준비 이하 → new
    raw: o,
  };
}

// 0) kidikidi 몰 레지스트리 보장 — mall_key는 malls FK라 먼저 존재해야 upsert 됨.
//    하이헤이호 브랜드에 매핑(키디키디=하이헤이호 판매채널).
async function ensureMall() {
  const { data: existing } = await db.from('malls').select('mall_key').eq('mall_key', MALL_KEY).maybeSingle();
  if (existing) return;
  const { data: brand } = await db.from('brands').select('id')
    .or('name.ilike.%하이헤이호%,name.ilike.%hiheyho%,name.ilike.%hiheiho%').maybeSingle();
  const { error } = await db.from('malls').upsert({
    mall_key: MALL_KEY, label: '키디키디(하이헤이호)', channel: 'eland',
    brand_id: brand?.id ?? null, active: true, connected: true,
  }, { onConflict: 'mall_key' });
  if (error) console.warn('[kidikidi] malls 등록 경고:', error.message);
  else console.log(`[kidikidi] malls 등록: kidikidi → brand ${brand?.id ?? '(미매핑)'}`);
}

async function run() {
  const to = new Date();
  const from = new Date(Date.now() - 30 * 864e5); // 최근 30일
  const browser = await chromium.launch({ headless: true });
  try {
    await ensureMall();
    const { page } = await login(browser);
    const data = await fetchOrders(page, ymd(from), ymd(to));
    const list = extractList(data);
    console.log(`[kidikidi] 주문 ${list.length}건 수집`);
    if (list.length) {
      const rows = list.map(mapOrder);
      // 유니크 제약은 (mall_key, order_id) — 005 마이그레이션에서 (channel,order_id) 대체됨
      const { error } = await db.from('channel_orders')
        .upsert(rows, { onConflict: 'mall_key,order_id', ignoreDuplicates: false });
      if (error) throw error;
      console.log(`[kidikidi] Supabase 저장 완료 ${rows.length}건`);
    }
  } finally {
    await browser.close();
  }
}

run().catch(e => { console.error('[kidikidi] 실패:', e); process.exit(1); });
