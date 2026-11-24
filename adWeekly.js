//  광고 주간 소재 — 광고세트(소재)별로 주(월~일, KST)마다 '인스타 팔로워 1명당 비용'을 내고 판정을 쌓는다.
//   데이터: ad_links(세트명·썸네일) × ad_daily(광고×날짜 지출·팔로우) + ad_weekly_verdicts(142 — 끝난 주의 확정 기록, 불변).
//   주차 계약: 월~일(KST). 확정 기록이 있는 주는 그 기록만 쓴다(소급 수정·판정선 변경에도 과거 판정이 안 바뀜).
//    확정 기록이 없는 주(진행 중·아직 안 찍힘)는 ad_daily 로 계산하고 '잠정'으로 표시한다. 계산식은 142 snapshot_ad_weekly 와 같다.
//   판정선: 사장님 2026-11-21 "500원 이하 50% 증액 700원 이하 20% 증액 900원 이하 유지 1000원 이상 중단" — 세 브랜드 공통.
//    900~1,000 구간은 미지정이라 유지로 본다. DB(ad_report_rules)에 +50% 칸이 아직 없어 여기 한 곳에만 둔다.
import { kstDay, addDays } from './adReport.js';

const num = v => Number(v) || 0;
export const WEEKLY_TIERS = { up50: 500, up20: 700, stop: 1000 };
export const WEEKLY_VERDICT = {
    up50: { label: '+50% 증액', short: '+50%', tone: 'up' },
    up20: { label: '+20% 증액', short: '+20%', tone: 'up' },
    keep: { label: '유지', short: '유지', tone: 'keep' },
    stop: { label: '중단', short: '중단', tone: 'stop' },
    few: { label: '표본 부족', short: '부족', tone: 'none' },
    idle: { label: '집행 없음', short: '—', tone: 'idle' },
    nodata: { label: '수집 전', short: '—', tone: 'idle' },
    failed: { label: '확정 기록 못 불러옴', short: '?', tone: 'idle' },
};
const cpfOf = (spend, follows) => num(follows) > 0 ? Math.round(num(spend) / num(follows)) : null;

//  팔로우 0: 이미 중단선만큼 썼으면 중단(1명당 무한대), 덜 썼으면 아직 모른다(표본 부족).
export function weeklyVerdict(spend, follows, t = WEEKLY_TIERS) {
    if (num(spend) <= 0) return 'idle';
    const cpf = cpfOf(spend, follows);
    if (cpf == null) return num(spend) >= t.stop ? 'stop' : 'few';
    if (cpf <= t.up50) return 'up50';
    if (cpf <= t.up20) return 'up20';
    if (cpf < t.stop) return 'keep';
    return 'stop';
}

//  PostgREST 는 한 번에 1000행까지만 준다 — range 로 끝까지 받는다. make(from, to) → { data, error }
export async function fetchAllPages(make, size = 1000, maxPages = 500) {
    const out = [];
    for (let i = 0; i < maxPages; i++) {
        const { data, error } = await make(i * size, i * size + size - 1);
        if (error) return { data: null, error };
        out.push(...(data || []));
        if (!data || data.length < size) return { data: out, error: null };
    }
    return { data: null, error: new Error('광고 일별 기록이 너무 많습니다(페이지 한도 초과)') };
}

//  확정 기록(142) 조회 결과 → 'ok' | 'notready'(표 미적용: 42P01·PostgREST PGRST205) | 'error'(네트워크·권한 등).
//  'error' 를 빈 목록으로 삼으면 확정된 과거 주가 바뀔 수 있는 ad_daily 잠정값으로 조용히 바뀐다(반려2-2) → 따로 다룬다.
export function snapsLoadState(error) {
    if (!error) return 'ok';
    const code = String(error.code || '');
    return code === '42P01' || code === 'PGRST205' ? 'notready' : 'error';
}

//  그 날짜가 속한 주의 월요일(YYYY-MM-DD)
export function weekStart(day) {
    const dow = new Date(day + 'T00:00:00Z').getUTCDay();   // 일=0
    return addDays(day, -((dow + 6) % 7));
}

//  brandOf(link) → brand_id. weeks = 최근 몇 주를 볼지(이번 주 포함). 오늘(집계 중)은 넣지 않는다.
//  반환: { weeks: [{ key, start, end, partial }] (최신 먼저), rows: [{ adset_id, name, brand_id, thumb, permalink, status, budget,
//          w: { [key]: { spend, follows, cpf, kind } }, total: { spend, follows, cpf }, tally: { up, keep, stop } }] }
//  snaps = ad_weekly_verdicts 행(142). 있는 주는 week.locked = true, 그 주 칸은 기록값(cell.locked) — ad_daily 계산은 버린다.
//  snapsState = snapsLoadState(조회 오류). 'error' 면 끝난 주는 week.failed = true 로 비운다(잠정값으로 대신 보이지 않는다) — 진행 중 주만 계산.
//  org = 활성 조직. 주면 org_id 가 정확히 같은 행만 남긴다(서버 조회도 org 로 거르지만 한 번 더 — 같은 adset_id 가 두 조직에 있어도 안 섞이게).
//   org 를 아예 안 넘기면(undefined) 거르지 않는다(순수 계산 시험용). null 을 넘기면 조직 미확인 → 빈 모델(fail-closed, 반려3).
export function buildWeekly({ links = [], daily = [], snaps = [], snapsState = 'ok', org, brandOf = l => l.brand_id || null, weeks = 8, now = Date.now(), tiers = WEEKLY_TIERS } = {}) {
    if (org === null || org === '') { links = []; daily = []; snaps = []; }
    else if (org !== undefined) {
        const mine = x => String(x.org_id) === String(org);
        links = links.filter(mine); daily = daily.filter(mine); snaps = snaps.filter(x => String(x.org_id) === String(org));
    }
    if (snapsState !== 'ok') snaps = [];
    const yday = addDays(kstDay(now), -1);
    const cur = weekStart(yday);
    const ws = Array.from({ length: weeks }, (_, i) => {
        const start = addDays(cur, -7 * i), end = addDays(start, 6);
        return { key: start, start, end: end > yday ? yday : end, partial: end > yday, locked: false };
    });
    const wkeys = new Set(ws.map(w => w.key));
    const first = ws.at(-1).start;
    const sets = new Map(), adSet = new Map(), skip = new Set();
    for (const l of links) {
        const id = String(l.adset_id || 'ad:' + l.ad_id);
        if (l.excluded) { skip.add(id); continue; }
        adSet.set(String(l.ad_id), id);
        const s = sets.get(id) || { adset_id: id, name: l.adset_name || l.ad_name || String(l.ad_id), brand_id: null, thumb: null, permalink: null,
            status: null, budget: null, w: {} };
        const st = l.adset_status || l.effective_status;
        if (!s.status || st === 'ACTIVE') s.status = st || null;
        s.budget ??= l.daily_budget ?? null;
        s.brand_id ??= brandOf(l);
        s.thumb ??= l.thumb_url || l.thumbnail_url || null;
        s.permalink ??= l.permalink || null;
        sets.set(id, s);
    }
    for (const id of skip) sets.delete(id);
    for (const d of daily) {
        if (!d.day || d.day > yday || d.day < first) continue;
        const s = sets.get(adSet.get(String(d.ad_id)));
        if (!s) continue;
        const k = weekStart(d.day);
        const c = s.w[k] || (s.w[k] = { spend: 0, follows: 0 });
        c.spend += num(d.spend); c.follows += num(d.follows);
    }
    //  확정 기록 — 그 주는 기록만 믿는다
    //  수집 시작일 — 그보다 앞선 주는 '수집 전', 걸친 주는 '일부'(그 주 판정을 믿으면 안 된다)
    const firstDay = daily.reduce((m, d) => d.day && d.day <= yday && (!m || d.day < m) ? d.day : m, null);
    const lockedKeys = new Set(snaps.filter(r => wkeys.has(String(r.week_start))).map(r => String(r.week_start)));
    for (const w of ws) {
        w.locked = lockedKeys.has(w.key);
        w.nodata = !w.locked && (!firstDay || w.end < firstDay);
        w.cut = !w.locked && !!firstDay && w.start < firstDay && firstDay <= w.end ? firstDay : null;
        w.failed = snapsState === 'error' && !w.partial && !w.nodata;
    }
    for (const s of sets.values()) for (const w of ws) if (lockedKeys.has(w.key) || w.failed) delete s.w[w.key];
    for (const r of snaps) {
        const k = String(r.week_start); if (!lockedKeys.has(k)) continue;
        const id = String(r.adset_id); if (skip.has(id)) continue;
        let s = sets.get(id);
        if (!s) { s = { adset_id: id, name: r.adset_name || id, brand_id: r.brand_id || brandOf({ brand_id: r.brand_id, adset_name: r.adset_name }), thumb: null, permalink: null, status: null, budget: null, w: {} }; sets.set(id, s); }
        s.w[k] = { spend: num(r.spend), follows: num(r.follows), cpf: r.cpf == null ? null : num(r.cpf), kind: r.verdict, locked: true,
            tiers: { up50: r.tier_up50, up20: r.tier_up20, stop: r.tier_stop } };
    }
    const rows = [];
    for (const s of sets.values()) {
        const cells = Object.values(s.w);
        if (!cells.some(c => c.spend > 0)) continue;                 // 보는 기간에 한 번도 집행 안 한 세트는 뺀다
        const tally = { up: 0, keep: 0, stop: 0 };
        for (const c of cells) {
            if (!c.locked) { c.cpf = cpfOf(c.spend, c.follows); c.kind = weeklyVerdict(c.spend, c.follows, tiers); }
            if (c.kind === 'up50' || c.kind === 'up20') tally.up++; else if (c.kind === 'keep') tally.keep++; else if (c.kind === 'stop') tally.stop++;
        }
        const spend = cells.reduce((n, c) => n + c.spend, 0), follows = cells.reduce((n, c) => n + c.follows, 0);
        rows.push({ ...s, total: { spend, follows, cpf: cpfOf(spend, follows) }, tally });
    }
    return { weeks: ws, rows, firstDay };
}

//  그 주에 집행한 세트만, 1명당 좋은 순(팔로우 0 은 지출 큰 순으로 뒤). prev = 직전 주 칸.
export function weekRows(model, key) {
    const i = model.weeks.findIndex(w => w.key === key);
    const prevKey = i >= 0 ? model.weeks[i + 1]?.key : null;
    const order = c => c.cpf == null ? [1, -c.spend] : [0, c.cpf];
    return model.rows.filter(r => r.w[key]?.spend > 0).map(r => ({ ...r, cell: r.w[key], prev: prevKey ? r.w[prevKey] || null : null }))
        .sort((a, b) => { const x = order(a.cell), y = order(b.cell); return x[0] - y[0] || x[1] - y[1] || String(a.name).localeCompare(String(b.name)); });
}
