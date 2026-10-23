// 매일 아침 텔레그램으로 오는 운영 보고서.
//  GitHub Actions 가 정해진 시각에 이 파일을 돌린다. 브라우저가 아니라 서버라
//  service_role 키로 RLS 를 지나 전체를 본다 — 키는 저장소에 없고 Actions 비밀값으로만 들어온다.
//  build() 는 fetch 를 받아서 쓴다 — 테스트(tests/telegram-report.test.mjs)가 네트워크 없이 돌린다.
import { pathToFileURL } from 'node:url';

const KST = (d = new Date()) => new Date(d.getTime() + 9 * 3600e3);
export const ymd = (d = new Date()) => KST(d).toISOString().slice(0, 10);
const won = n => (n || 0).toLocaleString('ko-KR');
//  금액 — 030 이후 주문금액은 order_amount. 옛 수집분(0·null)만 pay_amount 로 메운다. numeric 은 문자열로 올 수 있다.
export const orderAmount = o => Number(o?.order_amount) || Number(o?.pay_amount) || 0;
//  parse_mode Markdown 에서 _ * ` [ 가 짝이 안 맞으면 텔레그램이 400 으로 통째 거절한다(몰 키 smart_store 등) → DB 값은 이스케이프
export const md = s => String(s ?? '').replace(/([_*`[])/g, '\\$1');
//  order_date 는 timestamptz — 날짜만 넣으면 UTC 자정이라 9시간 밀린다. KST 자정으로 자른다(+ 는 URL 에서 공백이 되니 인코딩)
const kstStart = d => encodeURIComponent(`${d}T00:00:00+09:00`);

export async function build({ url, key, fetch: f = globalThis.fetch, now = new Date() }) {
  const today = ymd(now);
  const yest = ymd(new Date(now.getTime() - 864e5));
  async function rest(path) {
    const r = await f(`${url}/rest/v1/${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact' },
    });
    if (!r.ok) throw new Error(`${path.split('?')[0]} → ${r.status} ${await r.text()}`);
    const total = Number((r.headers.get('content-range') || '').split('/')[1] || 0);
    return { rows: await r.json(), total };
  }

  const L = [];
  L.push(`*2179 운영 보고* · ${today}`);

  // 어제 주문
  try {
    const { rows, total } = await rest(`channel_orders?select=order_id,mall_key,order_amount,pay_amount&order_date=gte.${kstStart(yest)}&order_date=lt.${kstStart(today)}&limit=1000`);
    const amt = rows.reduce((s, o) => s + orderAmount(o), 0);
    L.push(`\n🧾 *어제 주문* ${total}건 · ${won(amt)}원${total > rows.length ? ` (앞 ${rows.length}건 합)` : ''}`);
    const byMall = {};
    rows.forEach(o => { byMall[o.mall_key || '기타'] = (byMall[o.mall_key || '기타'] || 0) + 1; });
    Object.entries(byMall).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .forEach(([m, n]) => L.push(`  · ${md(m)} ${n}건`));
  } catch (e) { L.push(`\n🧾 주문: 못 읽음 (${md(e.message.slice(0, 60))})`); }

  // 출고 대기
  try {
    const { total } = await rest(`channel_orders?select=order_id&status=in.(new,ready)&limit=1`);
    L.push(`\n📦 *출고 대기* ${total}건`);
  } catch (_e) {}

  // 오늘 마감 할 일
  try {
    const { rows } = await rest(`reminders?select=title,due_date,assignee&done=is.false&due_date=lte.${today}&order=due_date.asc&limit=10`);
    L.push(`\n✅ *오늘까지 할 일* ${rows.length}건`);
    rows.slice(0, 8).forEach(r => L.push(`  · ${md(r.title)}${r.due_date < today ? ' ⚠️지연' : ''}`));
  } catch (_e) {}

  // CS 진행 중
  try {
    const { total } = await rest(`cs_tickets?select=id&status=neq.완료&limit=1`);
    if (total) L.push(`\n🔁 *CS 진행 중* ${total}건`);
  } catch (_e) {}

  // 수집이 멈췄는지 — sync_log 칸은 channel·type·result(001). job·ok 칸은 없다.
  try {
    const { rows } = await rest(`sync_log?select=run_at,channel,type,result&order=run_at.desc&limit=1`);
    const last = rows[0];
    if (last) {
      const mins = Math.round((now.getTime() - new Date(last.run_at).getTime()) / 60000);
      const what = [last.channel, last.type].filter(Boolean).join(' ') || '-';
      const bad = last.result && last.result !== 'ok' ? ` · ${md(last.result)}` : '';
      L.push(`\n🔌 마지막 수집 ${mins}분 전 (${md(what)}${bad})${mins > 60 ? ' ⚠️ 멈춘 듯' : ''}`);
    } else L.push(`\n🔌 수집 기록 없음`);
  } catch (e) { L.push(`\n🔌 수집: 못 읽음 (${md(e.message.slice(0, 60))})`); }

  L.push(`\nhttps://bhas-blue.vercel.app`);
  return L.join('\n');
}

async function main() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;
  for (const [k, v] of Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID })) {
    if (!v) { console.error(`빠진 값: ${k}`); process.exit(1); }
  }
  const text = await build({ url: SUPABASE_URL, key: SUPABASE_SERVICE_KEY });
  const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'Markdown', disable_web_page_preview: true }),
  });
  if (!r.ok) { console.error('텔레그램 전송 실패', r.status, await r.text()); process.exit(1); }
  console.log('보냈습니다\n' + text);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();
