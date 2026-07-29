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
function orderUrl(fromDate, toDate, pageNo) {
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
    page: String(pageNo), searchOrderStatus: 'true', size: '200', _: String(Date.now()),
  });
  return `${BASE}/o/order/lookup/orders?${p.toString()}`;
}

// 한 날짜창의 모든 페이지 수집 (200줄씩 페이지네이션)
async function fetchWindow(page, fromDate, toDate) {
  const acc = [];
  for (let pageNo = 1; pageNo <= 100; pageNo++) {
    const res = await page.request.get(orderUrl(fromDate, toDate, pageNo), {
      headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    });
    if (!res.ok()) throw new Error(`주문 API 실패 ${res.status()}: ${(await res.text()).slice(0, 300)}`);
    const body = await res.json();
    if (body && String(body.resultCode) === '400') throw new Error(`세션 만료(${body.resultMessage}). 재로그인 필요`);
    const list = extractList(body);
    acc.push(...list);
    if (list.length < 200) break;   // 마지막 페이지
    await page.waitForTimeout(400);  // 연타 방지(E·LAND 봇감지)
  }
  return acc;
}

// 전체 기간을 90일 창으로 청킹 + 각 창 페이지네이션
async function fetchOrders(page, fromDate, toDate) {
  const CHUNK = 89 * 864e5;
  const startMs = new Date(fromDate).getTime(), endMs = new Date(toDate).getTime();
  const all = [];
  for (let ws = startMs; ws <= endMs; ws += CHUNK + 864e5) {
    const we = Math.min(ws + CHUNK, endMs);
    const win = await fetchWindow(page, ymd(new Date(ws)), ymd(new Date(we)));
    all.push(...win);
  }
  return all;
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

// 진단: 로그인 후 배송/송장 관련 메뉴·API 엔드포인트 캡처(송장등록 API 역추적용)
async function diag() {
  const browser = await chromium.launch({ headless: true });
  try {
    const { ctx, page } = await login(browser);
    const seen = new Set();
    ctx.on('request', r => { const u = r.url(); if (/\/o\/|\/api\/|ajax|json|deliv|invoice|송장|ship/i.test(u)) seen.add(`${r.method()} ${u.split('?')[0]}`); });
    console.log('[diag] 로그인 완료, url=', page.url());
    // 메인 진입 후 메뉴 링크 덤프
    await page.goto(`${BASE}/main`, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(1500);
    const links = await page.evaluate(() => [...document.querySelectorAll('a')]
      .map(a => ({ t: (a.innerText || '').trim().slice(0, 20), href: a.getAttribute('href') || '' }))
      .filter(x => x.t && /배송|발송|출고|송장|운송장|주문|deliv|invoice|order/i.test(x.t + x.href)));
    console.log('[diag] 배송/주문 메뉴 링크:', JSON.stringify(links.slice(0, 40)));
    // 배송/발송 관련 링크 최대 3개 방문하며 API 캡처
    const cand = links.filter(x => /배송|발송|출고|송장|deliv|ship/i.test(x.t + x.href) && x.href && x.href !== '#').slice(0, 3);
    for (const c of cand) {
      const url = c.href.startsWith('http') ? c.href : `${BASE}${c.href.startsWith('/') ? '' : '/'}${c.href}`;
      await page.goto(url, { waitUntil: 'networkidle' }).catch(() => {});
      await page.waitForTimeout(2000);
      console.log(`[diag] 방문 "${c.t}" → ${url}`);
    }
    console.log('[diag] 캡처된 API 엔드포인트:\n' + [...seen].join('\n'));
    // 최근 주문 1건의 전체 필드(배송/송장 필드 확인)
    const to = new Date(), from = new Date(Date.now() - 30 * 864e5);
    const res = await page.request.get(orderUrl(ymd(from), ymd(to), 1), { headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' } });
    const body = await res.json().catch(() => ({}));
    const first = (extractList(body) || [])[0];
    console.log('[diag] 주문객체 필드:', first ? JSON.stringify(Object.keys(first)) : '(주문없음)');
    if (first) console.log('[diag] 주문객체 샘플:', JSON.stringify(first).slice(0, 1200));
  } finally { await browser.close(); }
}

async function run() {
  if (process.env.DIAG === '1') return diag();
  // 조회 기간: 기본 400일(전체 이력 확보). 정기 실행은 upsert 멱등이라 재조회 안전.
  const LOOKBACK = Number(process.env.LOOKBACK_DAYS || 400);
  const to = new Date();
  const from = new Date(Date.now() - LOOKBACK * 864e5);
  const browser = await chromium.launch({ headless: true });
  try {
    await ensureMall();
    const { page } = await login(browser);
    const list = await fetchOrders(page, ymd(from), ymd(to));  // 전체 페이지·창 수집된 배열
    // 주문번호 단위 중복 제거(품목별 여러 줄 → 대표 1건, 금액 합산)
    const byOrd = {};
    for (const o of list) { const k = String(o.ordNo); if (!byOrd[k]) { byOrd[k] = mapOrder(o); byOrd[k].pay_amount = 0; } byOrd[k].pay_amount += Number(o.sellAmount ?? o.sellPrice ?? 0); }
    const deduped = Object.values(byOrd);
    console.log(`[kidikidi] 주문 라인 ${list.length} → 주문 ${deduped.length}건`);
    if (deduped.length) {
      const rows = deduped;
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
