// ============================================================
//  스마트스토어(네이버 커머스) 주문 수집 — 공식 API (봇/OTP 불필요)
//  https://api.commerce.naver.com/external
//
//  인증: client_id + client_secret(bcrypt salt) → 서명 → access_token(2h)
//  주문: last-changed-statuses(변경분 ID) → product-orders/query(상세) → Supabase 저장
//
//  환경변수(GitHub Actions Secrets / .env):
//    NAVER_CLIENT_ID, NAVER_CLIENT_SECRET   : 커머스API 애플리케이션
//    SUPABASE_URL, SUPABASE_SERVICE_KEY
// ============================================================
import bcrypt from 'bcryptjs';
import { createClient } from '@supabase/supabase-js';

const {
  NAVER_CLIENT_ID, NAVER_CLIENT_SECRET,
  SUPABASE_URL, SUPABASE_SERVICE_KEY,
} = process.env;

const BASE = 'https://api.commerce.naver.com/external';
const MALL_KEY = 'smartstore';
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

// 1) 전자서명 → access_token 발급
async function getToken() {
  const ts = Date.now();
  const pw = `${NAVER_CLIENT_ID}_${ts}`;
  const hashed = bcrypt.hashSync(pw, NAVER_CLIENT_SECRET);          // client_secret = bcrypt salt
  const sign = Buffer.from(hashed, 'utf-8').toString('base64');
  const body = new URLSearchParams({
    client_id: NAVER_CLIENT_ID, timestamp: String(ts),
    grant_type: 'client_credentials', client_secret_sign: sign, type: 'SELF',
  });
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  });
  if (!res.ok) throw new Error(`토큰 실패 ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).access_token;
}

// 2) 최근 변경된 주문 ID 목록 (신규결제/발주 등)
async function lastChangedIds(token, fromISO) {
  const url = `${BASE}/v1/pay-order/seller/product-orders/last-changed-statuses?lastChangedFrom=${encodeURIComponent(fromISO)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`변경분 조회 실패 ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const arr = data?.data?.lastChangeStatuses ?? data?.data ?? [];
  return [...new Set(arr.map(x => x.productOrderId).filter(Boolean))];
}

// 3) 주문 상세 조회
async function queryOrders(token, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 300) {           // API 배치 상한 대응
    const chunk = ids.slice(i, i + 300);
    const res = await fetch(`${BASE}/v1/pay-order/seller/product-orders/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ productOrderIds: chunk }),
    });
    if (!res.ok) throw new Error(`상세 조회 실패 ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    out.push(...(data?.data ?? []));
  }
  return out;
}

// 4) 네이버 주문 → channel_orders 매핑
//    상세 응답: { order:{...}, productOrder:{...} } 형태
function mapOrder(row) {
  const o = row.order ?? {};
  const po = row.productOrder ?? row;
  const ship = po.shippingAddress ?? {};
  return {
    channel: 'naver',
    mall_key: MALL_KEY,
    order_id: String(po.productOrderId ?? o.orderId),
    order_date: o.orderDate ?? po.orderDate ?? null,
    buyer_name: o.ordererName ?? null,
    receiver_name: ship.name ?? null,
    receiver_phone: ship.tel1 ?? ship.tel2 ?? null,
    receiver_zipcode: ship.zipCode ?? null,
    receiver_address: [ship.baseAddress, ship.detailedAddress].filter(Boolean).join(' ') || null,
    pay_amount: Number(po.totalPaymentAmount ?? po.totalProductAmount ?? 0),
    channel_status: po.productOrderStatus ?? null,
    status: 'new',
    raw: row,
  };
}

async function ensureMall() {
  const { data: existing } = await db.from('malls').select('mall_key').eq('mall_key', MALL_KEY).maybeSingle();
  if (existing) return;
  await db.from('malls').upsert({
    mall_key: MALL_KEY, label: '스마트스토어', channel: 'naver',
    brand_id: null, active: true, connected: true,
  }, { onConflict: 'mall_key' });
  console.log('[smartstore] malls 등록: smartstore');
}

async function run() {
  await ensureMall();
  const token = await getToken();
  const from = new Date(Date.now() - 24 * 3600 * 1000).toISOString();  // 최근 24h 변경분
  const ids = await lastChangedIds(token, from);
  console.log(`[smartstore] 변경 주문 ${ids.length}건`);
  if (!ids.length) return;
  const details = await queryOrders(token, ids);
  const rows = details.map(mapOrder).filter(r => r.order_id && r.order_id !== 'undefined');
  const { error } = await db.from('channel_orders')
    .upsert(rows, { onConflict: 'mall_key,order_id', ignoreDuplicates: false });
  if (error) throw error;
  console.log(`[smartstore] Supabase 저장 완료 ${rows.length}건`);
}

run().catch(e => { console.error('[smartstore] 실패:', e); process.exit(1); });
