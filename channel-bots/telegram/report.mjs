// 매일 아침 텔레그램으로 오는 운영 보고서.
//  GitHub Actions 가 정해진 시각에 이 파일을 돌린다. 브라우저가 아니라 서버라
//  service_role 키로 RLS 를 지나 전체를 본다 — 키는 저장소에 없고 Actions 비밀값으로만 들어온다.
const {
  SUPABASE_URL, SUPABASE_SERVICE_KEY,
  TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID,
} = process.env;

for (const [k, v] of Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID })) {
  if (!v) { console.error(`빠진 값: ${k}`); process.exit(1); }
}

const KST = (d = new Date()) => new Date(d.getTime() + 9 * 3600e3);
const ymd = (d = new Date()) => KST(d).toISOString().slice(0, 10);
const today = ymd();
const yest = ymd(new Date(Date.now() - 864e5));

async function rest(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, Prefer: 'count=exact' },
  });
  if (!r.ok) throw new Error(`${path} → ${r.status} ${await r.text()}`);
  const total = Number((r.headers.get('content-range') || '').split('/')[1] || 0);
  return { rows: await r.json(), total };
}
const won = n => (n || 0).toLocaleString('ko-KR');

async function build() {
  const L = [];
  L.push(`*2179 운영 보고* · ${today}`);

  // 어제 주문
  try {
    const { rows, total } = await rest(`channel_orders?select=order_id,mall_key,total_amount&order_date=gte.${yest}&order_date=lt.${today}&limit=500`);
    const amt = rows.reduce((s, o) => s + (o.total_amount || 0), 0);
    L.push(`\n🧾 *어제 주문* ${total}건 · ${won(amt)}원`);
    const byMall = {};
    rows.forEach(o => { byMall[o.mall_key || '기타'] = (byMall[o.mall_key || '기타'] || 0) + 1; });
    Object.entries(byMall).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .forEach(([m, n]) => L.push(`  · ${m} ${n}건`));
  } catch (e) { L.push(`\n🧾 주문: 못 읽음 (${e.message.slice(0, 60)})`); }

  // 출고 대기
  try {
    const { total } = await rest(`channel_orders?select=order_id&status=in.(new,ready)&limit=1`);
    L.push(`\n📦 *출고 대기* ${total}건`);
  } catch (_e) {}

  // 오늘 마감 할 일
  try {
    const { rows } = await rest(`reminders?select=title,due_date,assignee&done=is.false&due_date=lte.${today}&order=due_date.asc&limit=10`);
    L.push(`\n✅ *오늘까지 할 일* ${rows.length}건`);
    rows.slice(0, 8).forEach(r => L.push(`  · ${r.title}${r.due_date < today ? ' ⚠️지연' : ''}`));
  } catch (_e) {}

  // CS 진행 중
  try {
    const { total } = await rest(`cs_tickets?select=id&status=neq.완료&limit=1`);
    if (total) L.push(`\n🔁 *CS 진행 중* ${total}건`);
  } catch (_e) {}

  // 수집이 멈췄는지
  try {
    const { rows } = await rest(`sync_log?select=run_at,job,ok&order=run_at.desc&limit=1`);
    const last = rows[0];
    if (last) {
      const mins = Math.round((Date.now() - new Date(last.run_at).getTime()) / 60000);
      L.push(`\n🔌 마지막 수집 ${mins}분 전 (${last.job || '-'})${mins > 60 ? ' ⚠️ 멈춘 듯' : ''}`);
    }
  } catch (_e) {}

  L.push(`\nhttps://bhas-blue.vercel.app`);
  return L.join('\n');
}

const text = await build();
const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'Markdown', disable_web_page_preview: true }),
});
if (!r.ok) { console.error('텔레그램 전송 실패', r.status, await r.text()); process.exit(1); }
console.log('보냈습니다\n' + text);
