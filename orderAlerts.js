//  주문 수집 끊김·0건 알림 규칙 — 알림(channel-bots/telegram/order-alert.mjs)과 화면(main.js 판매>주문 몰별)이 같이 쓴다.
//  배경(11-17): 29CM 이 11-10~11-16 7회 연속 invalid_grant 로 실패했는데 아무도 몰랐다.
//
//  규칙(몰 = 몰×브랜드, mall_key 하나)
//   ① 수집 실패 연속 2회 이상 → 'fail'
//      sync_log 의 '<mall_key>:pull_orders'(ok|error) + 카페24 가 실패 때 남기는 '<mall_key>:error' 를 시간순으로 본다.
//   ①' 실패 기록도 없이 멈춤(크론 자체가 안 돎) → 마지막 성공이 수집 주기 2배를 넘으면 'stale'
//   ② 평소 하루 1건 이상인데 어제·그제 2일 연속 0건 → 'zero'
//      '평소'는 직전 7일을 평일·주말로 나눈 평균 — 0건인 날이 평일이면 평일 평균, 주말이면 주말 평균이 1 이상이어야 한다.
//      수집 상태가 정상(ok)일 때만 본다 — 끊김·주의·기록 없음(워크플로를 끈 몰)은 0건이 당연하거나 믿을 수 없다.
//   malls.alert_enabled = false 인 몰(일부러 수집을 끈 몰)은 알림을 안 낸다(화면 점은 그대로).
//   같은 (날짜, 몰, 규칙)은 하루 1번만 — order_alert_log 에 남긴 것은 다시 안 보낸다.

export const PULL = 'pull_orders';
export const FAIL_STREAK = 2;
export const ZERO_DAYS = 2;
export const BASE_DAYS = 7;
export const MIN_DAILY = 1;

const H = 3600e3, D = 24 * H;
//  수집 주기 — 카페24 는 10분 크론(엣지함수), 나머지(29CM·스마트스토어·키디키디)는 하루 1번 GitHub Actions.
//  GitHub 예약 실행은 1~3시간 늦게 도는 날이 있어(06:17 예약 → 실측 09:30~12:30) 하루 채널은 26시간까지 정상으로 본다.
export const staleMsOf = channel => (channel || 'cafe24') === 'cafe24' ? 2 * H : 26 * H;

//  KST 날짜 'YYYY-MM-DD'
export const kstDay = t => new Date((typeof t === 'number' ? t : Date.parse(t)) + 9 * H).toISOString().slice(0, 10);
export const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * D).toISOString().slice(0, 10);

//  sync_log type → { mall_key, kind } — 주문 수집 기록이 아니면 null
export function parseSyncType(type) {
    const m = String(type || '').match(/^(.+):(pull_orders|error)$/);
    return m ? { mall_key: m[1], kind: m[2] } : null;
}

//  몰 하나의 수집 상태.
//   logs: 그 몰의 sync_log 행들(순서 무관) — pull_orders 의 ok|error, ':error' 행은 실패로 센다. warn·dry_run 등은 건너뛴다.
//   lastOkAt: logs 범위 밖의 마지막 성공(따로 조회한 값, 없으면 null)
//   state: 'ok' 정상 · 'warn' 실패 1회 또는 주기 넘김 · 'down' 끊김(빨간 점) · 'none' 기록 없음
export function syncHealth(logs, { channel, now = Date.now(), lastOkAt = null } = {}) {
    const rows = (logs || [])
        .map(r => ({ ...r, p: parseSyncType(r.type), t: Date.parse(r.run_at) }))
        .filter(r => r.p && Number.isFinite(r.t))
        .map(r => ({ ...r, res: r.p.kind === 'error' ? 'error' : r.result }))
        .filter(r => r.res === 'ok' || r.res === 'error')
        .sort((a, b) => b.t - a.t);
    let failStreak = 0;
    for (const r of rows) { if (r.res === 'error') failStreak++; else break; }
    const okRow = rows.find(r => r.res === 'ok');
    const okT = Math.max(okRow ? okRow.t : 0, lastOkAt ? Date.parse(lastOkAt) || 0 : 0);
    const lastErr = rows.find(r => r.res === 'error') || null;
    const out = {
        failStreak,
        lastOkAt: okT ? new Date(okT).toISOString() : null,
        lastRunAt: rows[0] ? rows[0].run_at : null,
        lastError: failStreak && lastErr ? errorText(lastErr.detail) : '',
        staleMs: staleMsOf(channel),
    };
    const age = okT ? now - okT : Infinity;
    if (!rows.length && !okT) return { ...out, state: 'none', rule: null };
    if (failStreak >= FAIL_STREAK) return { ...out, state: 'down', rule: 'fail' };
    if (age > 2 * out.staleMs) return { ...out, state: 'down', rule: 'stale' };
    if (failStreak || age > out.staleMs) return { ...out, state: 'warn', rule: null };
    return { ...out, state: 'ok', rule: null };
}

//  실패 사유 한 줄 — 숫자열(주문번호·전화·토큰 조각)은 가린다
export function errorText(detail) {
    const e = detail && typeof detail === 'object' ? (detail.error ?? detail.message ?? '') : detail;
    return String(e || '').replace(/[0-9]{4,}/g, '****').replace(/\s+/g, ' ').trim().slice(0, 80);
}

//  ② 0건 판정 — counts: { 'YYYY-MM-DD': 건수 } (KST, 없는 날 = 0). today = 오늘 KST(오늘은 덜 끝나서 안 본다)
export const isWeekend = day => [0, 6].includes(new Date(day + 'T00:00:00Z').getUTCDay());
export function zeroDrop(counts, today) {
    const c = d => Number((counts || {})[d]) || 0;
    const zeroDays = Array.from({ length: ZERO_DAYS }, (_, i) => addDays(today, -(i + 1)));
    const baseDays = Array.from({ length: BASE_DAYS }, (_, i) => addDays(today, -(ZERO_DAYS + 1 + i)));
    const mean = ds => ds.length ? ds.reduce((s, d) => s + c(d), 0) / ds.length : 0;
    const avg = mean(baseDays);
    const avgWeekday = mean(baseDays.filter(d => !isWeekend(d)));
    const avgWeekend = mean(baseDays.filter(isWeekend));
    const expect = d => isWeekend(d) ? avgWeekend : avgWeekday;
    const zeros = zeroDays.every(d => c(d) === 0);
    return { hit: zeros && zeroDays.every(d => expect(d) >= MIN_DAILY), avg, avgWeekday, avgWeekend, expected: zeroDays.map(expect).reverse(),
             zeroDays: zeroDays.slice().reverse(), baseFrom: baseDays[baseDays.length - 1], baseTo: baseDays[0], last: zeroDays.map(c).reverse() };
}

//  주문 행 → 몰별 KST 일자 건수 { mall_key: { day: n } }
export function dailyCounts(orders) {
    const out = {};
    (orders || []).forEach(o => {
        if (!o?.mall_key || !o.order_date) return;
        const t = Date.parse(o.order_date);
        if (!Number.isFinite(t)) return;
        const d = kstDay(t), m = (out[o.mall_key] = out[o.mall_key] || {});
        m[d] = (m[d] || 0) + 1;
    });
    return out;
}

const CH_NAME = { cafe24: '카페24', '29cm': '29CM', naver: '스마트스토어', eland: '키디키디' };
//  몰 이름 — 'label (브랜드)' 꼴. label 에 브랜드가 이미 있으면 그대로
export function mallName(mall, brandName) {
    const label = String(mall?.label || '').trim();
    const ch = CH_NAME[mall?.channel] || mall?.channel || '';
    const base = label && label !== '-' ? label : ch || String(mall?.mall_key || '');
    return brandName && !base.includes(brandName) ? `${base} (${brandName})` : base;
}

export const kstShortAt = iso => {
    if (!iso) return '-';
    const d = new Date(Date.parse(iso) + 9 * H);
    if (Number.isNaN(d.getTime())) return '-';
    const p = n => String(n).padStart(2, '0');
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
};

//  전체 판정 — 반환: rows(몰마다 상태, 드라이런 표용) · alerts(보낼 것, 이미 보낸 것 제외)
//   malls: [{ mall_key, label, channel, brand_id, active }]
//   logsByMall: { mall_key: sync_log 행[] } · lastOkByMall: { mall_key: run_at }
//   countsByMall: dailyCounts 결과 · sent: [{ day, mall_key, rule }] (order_alert_log)
export function evaluate({ malls, brands = [], logsByMall = {}, lastOkByMall = {}, countsByMall = {}, sent = [], now = Date.now() }) {
    const today = kstDay(now);
    const bname = id => (brands.find(b => String(b.id) === String(id)) || {}).name || '';
    const sentKey = new Set((sent || []).filter(s => s.day === today).map(s => `${s.mall_key}|${s.rule}`));
    const rows = [], alerts = [];
    (malls || []).filter(m => m && m.mall_key && m.active !== false).forEach(m => {
        const name = mallName(m, bname(m.brand_id));
        const h = syncHealth(logsByMall[m.mall_key], { channel: m.channel, now, lastOkAt: lastOkByMall[m.mall_key] || null });
        const z = zeroDrop(countsByMall[m.mall_key], today);
        let rule = h.rule, text = '';
        if (rule === 'fail') text = `수집 ${h.failStreak}회 연속 실패 · 마지막 성공 ${kstShortAt(h.lastOkAt)}${h.lastError ? ` · ${h.lastError}` : ''}`;
        else if (rule === 'stale') text = `수집 멈춤 · 마지막 성공 ${kstShortAt(h.lastOkAt)} (실패 기록도 없음)`;
        else if (h.state === 'ok' && z.hit) { rule = 'zero'; text = `${z.zeroDays.map(d => d.slice(5)).join('·')} 2일 연속 주문 0건 · 평소 하루 ${z.expected.map(n => n.toFixed(1)).join('·')}건 (수집은 정상)`; }
        const off = m.alert_enabled === false;
        const dup = rule ? sentKey.has(`${m.mall_key}|${rule}`) : false;
        rows.push({ mall_key: m.mall_key, name, channel: m.channel, state: h.state, failStreak: h.failStreak, lastOkAt: h.lastOkAt, avg7: z.avg, last2: z.last, rule, dup, off });
        if (rule && !dup && !off) alerts.push({ day: today, mall_key: m.mall_key, rule, name, text });
    });
    return { today, rows, alerts };
}

//  텔레그램 글 — md: parse_mode Markdown 이스케이프 함수(보고서와 같은 것)
export function alertMessage(alerts, today, md = s => s) {
    if (!alerts.length) return '';
    const icon = { fail: '🔴', stale: '🔴', zero: '🟠' };
    const L = [`🚨 *주문 수집 알림* · ${today}`];
    alerts.forEach(a => L.push(`${icon[a.rule] || '•'} ${md(a.name)} — ${md(a.text)}`));
    L.push('\n판매 > 주문 왼쪽 몰별 목록의 빨간 점이 끊긴 몰입니다.');
    return L.join('\n');
}
