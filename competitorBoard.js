//  경쟁사 순위판 · 브랜드 한 장 · 조간 '경쟁사 인스타' — 화면 없이 계산만 하는 순수 함수들.
//   글 = news_items kind='competitor_post' (meta.likes · meta.comments · meta.name, competitor_id)
//   지표 = competitor_snapshots (snap_date · followers)
//   LLM 없이 정규식으로만 오픈 일정을 뽑는다.

const DAY = 864e5;
const KST = 9 * 36e5;

export const POST_DAYS = 7;          // 조간·뉴스 '경쟁사 인스타' 칸은 최근 7일
export const POST_TOP = 8;           // 반응 큰 순 상위 몇 개
export const RANK_TOP = 10;          // 순위판 기본 줄 수(나머지는 더보기)
export const SPIKE_X = 2;            // 그 브랜드 평소(중앙값)의 몇 배면 '튄 글'
export const SPIKE_MIN_GAP = 10;     // 작은 계정이 3→7 처럼 튀는 건 빼려고 최소 차이
export const SPIKE_MIN_POSTS = 4;    // 평소를 말하려면 글이 이만큼은 있어야

export const engOf = p => {
    const m = (p && p.meta) || {};
    return (Number(m.likes) || 0) + (Number(m.comments) || 0);
};
const tsOf = p => { const t = Date.parse((p && (p.published_at || p.created_at)) || ''); return Number.isNaN(t) ? null : t; };
const kstYmd = ms => new Date(ms + KST).toISOString().slice(0, 10);
const ymdNum = ymd => Date.parse(ymd + 'T00:00:00Z') / DAY;

//  최근 N일 경쟁사 글을 반응(좋아요+댓글) 큰 순으로
export function topPosts(posts, { days = POST_DAYS, top = POST_TOP, now = Date.now() } = {}) {
    const since = now - days * DAY;
    return (posts || [])
        .filter(p => { const t = tsOf(p); return t != null && t >= since && t <= now + DAY; })
        .sort((a, b) => engOf(b) - engOf(a) || (tsOf(b) - tsOf(a)))
        .slice(0, top);
}

//  글 → 브랜드 이름 (competitors 표 > 글에 적힌 meta.name > 작성자)
export function nameOfPost(p, comps) {
    const c = (comps || []).find(x => x.id === p.competitor_id);
    return (c && c.name) || (p.meta && p.meta.name) || p.author || '';
}

// ── 순위판 ─────────────────────────────────────────────
//  지금 = 가장 최근 스냅샷. 견줄 것 = 7일 전에 가장 가까운 스냅샷(7일 넘은 건 안 쓴다).
//  기록이 7일이 안 되면 있는 만큼(span 일)으로 견주고, 하루치뿐이면 변화 없음(null).
export function followerChange(snaps) {
    const s = (snaps || []).filter(x => x && x.snap_date && x.followers != null)
        .slice().sort((a, b) => String(b.snap_date).localeCompare(String(a.snap_date)));
    if (!s.length) return { followers: null, delta: null, span: 0, since: null };
    const now = s[0], n0 = ymdNum(now.snap_date);
    const base = s.slice(1).filter(x => n0 - ymdNum(x.snap_date) <= 7)
        .sort((a, b) => String(a.snap_date).localeCompare(String(b.snap_date)))[0];
    if (!base) return { followers: now.followers, delta: null, span: 0, since: now.snap_date };
    return { followers: now.followers, delta: now.followers - base.followers,
             span: n0 - ymdNum(base.snap_date), since: base.snap_date };
}

//  변화 큰 순(늘었든 줄었든 크기로) → 변화 없으면 팔로워 많은 순
export function rankCompetitors(comps, snaps) {
    const by = {};
    (snaps || []).forEach(s => { (by[s.competitor_id] = by[s.competitor_id] || []).push(s); });
    return (comps || []).map(c => ({ ...c, ...followerChange(by[c.id]) }))
        .sort((a, b) => {
            const da = a.delta == null ? -1 : Math.abs(a.delta), db = b.delta == null ? -1 : Math.abs(b.delta);
            if (db !== da) return db - da;
            return (b.followers ?? -1) - (a.followers ?? -1) || String(a.name || '').localeCompare(String(b.name || ''), 'ko');
        });
}
//  스냅샷이 처음 쌓인 날 — '기록 시작 10-22' 안내용
export function snapStart(snaps) {
    const d = (snaps || []).map(s => s.snap_date).filter(Boolean).sort()[0];
    return d || null;
}

// ── 고객 반응 · 튄 글 ─────────────────────────────────
export function median(nums) {
    const a = nums.slice().sort((x, y) => x - y);
    if (!a.length) return null;
    return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
}
//  한 브랜드 글들의 평소(중앙값)와 튄 글 표시. 글이 적으면 평소를 말하지 않는다.
export function reactionStats(posts) {
    const engs = (posts || []).map(engOf);
    const usual = engs.length >= SPIKE_MIN_POSTS ? median(engs) : null;
    const spikes = new Map();
    if (usual != null) (posts || []).forEach(p => {
        const e = engOf(p);
        if (e >= usual * SPIKE_X && e - usual >= SPIKE_MIN_GAP) spikes.set(p.id, usual > 0 ? e / usual : null);
    });
    const avg = engs.length ? engs.reduce((s, x) => s + x, 0) / engs.length : null;
    return { usual, avg, count: engs.length, spikes };
}

// ── 이슈: 브랜드 이름이 든 기사 ────────────────────────
//  '오유(OU)' 처럼 괄호 붙은 이름은 앞 이름으로 찾는다. 두 글자 미만이면 엉뚱한 게 걸려 찾지 않는다.
export function searchName(name) {
    const n = String(name || '').replace(/\(.*?\)/g, ' ').replace(/[%,()*\\.:"]/g, ' ').replace(/\s+/g, ' ').trim();
    return n.length >= 2 ? n : '';
}
export function brandIssues(items, name) {
    const n = searchName(name).replace(/\s+/g, '').toLowerCase();
    if (!n) return [];
    const seen = new Set();
    return (items || []).filter(x => x.kind !== 'competitor_post' && x.kind !== 'own')
        .filter(x => String(`${x.title || ''} ${x.snippet || ''}`).replace(/\s+/g, '').toLowerCase().includes(n))
        .filter(x => { const k = x.url || x.id; if (seen.has(k)) return false; seen.add(k); return true; })
        .sort((a, b) => (tsOf(b) || 0) - (tsOf(a) || 0));
}

// ── 오픈 일정 (정규식) ───────────────────────────────
const KIND_RE = [
    ['프리오더', /프리\s?오더|pre[\s-]?order/i],
    ['드롭', /드롭|\bdrop\b/i],
    ['발매', /발매|출시|런칭|launch/i],
    ['오픈', /오픈|\bopen\b|판매\s?시작/i],
];
const ANY_KIND = /프리\s?오더|pre[\s-]?order|드롭|\bdrop\b|발매|출시|런칭|launch|오픈|\bopen\b|판매\s?시작/ig;
//  10/22 · 10.22 · 10월 22일 (뒤에 '만'·'%'·숫자가 붙으면 날짜 아님)
const DATE_RE = /(?<![\d.])(1[0-2]|0?[1-9])\s*(?:[./]|월\s*)\s*(3[01]|[12]\d|0?[1-9])(?:\s*일)?(?![\d만%])/g;
const REL_RE = /(오늘|금일|잠시\s?후|이따|내일|명일|모레)/g;
const REL_DAYS = { 오늘: 0, 금일: 0, 잠시후: 0, '잠시 후': 0, 이따: 0, 내일: 1, 명일: 1, 모레: 2 };
//  오후 2시 · 밤 11시 · 2pm · 12:00 pm · 10:00 AM · 8PM · 11:00
const TIME_RE = /(오전|오후|낮|밤|저녁|새벽|아침)?\s*(\d{1,2})(?:\s*:\s*(\d{2}))?\s*(?:(시)(?:\s*(\d{1,2})\s*분|\s*반)?|\s*(am|pm)\b)?/ig;

function pickTime(text) {
    TIME_RE.lastIndex = 0;
    let m;
    while ((m = TIME_RE.exec(text))) {
        const [, ap, hh, mm, si, mm2, ampm] = m;
        if (!si && !ampm && mm == null) continue;           // 숫자만 덩그러니면 시각 아님
        let h = Number(hh), min = Number(mm ?? mm2 ?? (/반$/.test(m[0]) ? 30 : 0));
        if (h > 24 || min > 59) continue;
        const pm = (ampm && ampm.toLowerCase() === 'pm') || ['오후', '저녁'].includes(ap) || (ap === '밤' && h < 12) || (ap === '낮' && h < 6);
        if (pm && h < 12) h += 12;
        if ((ampm && ampm.toLowerCase() === 'am' || ap === '오전' || ap === '새벽') && h === 12) h = 0;
        return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    }
    return null;
}
const kindAt = (text) => (KIND_RE.find(([, re]) => re.test(text)) || ['오픈'])[0];

//  글 하나에서 다가오는 오픈 일정 한 건. 날짜는 글 올린 날(KST)을 기준으로 해석하고
//  그날보다 이른 날짜(이미 지난 행사 기간 등)는 버린다.
export function extractOpening(post) {
    const text = `${post.title || ''} ${post.snippet || ''}`.replace(/\s+/g, ' ');
    const t0 = tsOf(post); if (t0 == null) return null;
    const postYmd = kstYmd(t0), [py, pm] = postYmd.split('-').map(Number);
    //  '오픈했어요·오픈되었습니다' 처럼 이미 지난 말은 일정이 아니다
    const kws = [...text.matchAll(ANY_KIND)]
        .filter(m => !/^[은는을를이가에도]?\s*(했|되었|됐|하고|잘|못|함께|없|에도|에 함께)/.test(text.slice(m.index + m[0].length, m.index + m[0].length + 8))
                  && !/종료|마감/.test(text.slice(m.index, m.index + m[0].length + 14)))
        .map(m => m.index);
    if (!kws.length) return null;
    const near = i => kws.some(k => Math.abs(k - i) <= 60);
    const cands = [];
    for (const m of text.matchAll(DATE_RE)) {
        const mo = Number(m[1]), d = Number(m[2]);
        const y = mo < pm - 6 ? py + 1 : py;
        const ymd = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        if (Number.isNaN(Date.parse(ymd + 'T00:00:00Z'))) continue;
        cands.push({ i: m.index, end: m.index + m[0].length, ymd });
    }
    for (const m of text.matchAll(REL_RE)) {
        const off = REL_DAYS[m[1]] ?? REL_DAYS[m[1].replace(/\s/g, '')] ?? 0;
        cands.push({ rel: true, i: m.index, end: m.index + m[0].length, ymd: new Date(Date.parse(postYmd + 'T00:00:00Z') + off * DAY).toISOString().slice(0, 10) });
    }
    //  '10.19 - 10.25' 같은 기간의 끝 날짜는 따로 보지 않는다(시작일이 지났으면 이미 연 것)
    const rangeEnd = c => cands.some(o => o !== c && o.end <= c.i && c.i - o.end <= 16 && /[-~–]/.test(text.slice(o.end, c.i)));
    //  마감·출고·발송 날짜는 오픈이 아니다
    const closing = c => /마감|종료|출고|발송|배송|까지/.test(text.slice(Math.max(0, c.i - 12), c.end + 20));
    const ok = cands.filter(c => !rangeEnd(c) && !closing(c) && near(c.i) && ymdNum(c.ymd) >= ymdNum(postYmd) && ymdNum(c.ymd) - ymdNum(postYmd) <= 60)
        .sort((a, b) => (a.rel ? 1 : 0) - (b.rel ? 1 : 0) || a.i - b.i);   // 적힌 날짜가 '내일'보다 확실하다
    if (!ok.length) return null;
    const c = ok[0];
    const after = text.slice(c.end, c.end + 30).replace(/^\s*\(?[월화수목금토일]\)?\s*/, '')
        .replace(/^\s*\(?(mon|tue|wed|thu|fri|sat|sun)[a-z]*\)?[,\s]*/i, '');
    const time = pickTime(after.slice(0, 22));
    const k = kws.reduce((best, i) => Math.abs(i - c.i) < Math.abs(best - c.i) ? i : best, kws[0]);
    const kind = kindAt(text.slice(Math.max(0, k - 2), k + 12));
    const [, mo, d] = c.ymd.split('-').map(Number);
    return { date: c.ymd, time, kind, label: `${mo}/${d}${time ? ' ' + time : ''} ${kind}`, post_id: post.id };
}

//  여러 글에서 오늘~N일 안 오픈만, 브랜드·날짜가 같으면 한 건(시각 있는 쪽)으로
export function upcomingOpenings(posts, comps, { days = POST_DAYS, now = Date.now() } = {}) {
    const today = ymdNum(kstYmd(now));
    const by = new Map();
    (posts || []).forEach(p => {
        const o = extractOpening(p); if (!o) return;
        const n = ymdNum(o.date); if (n < today || n >= today + days) return;
        const name = nameOfPost(p, comps);
        const key = `${p.competitor_id || name}|${o.date}`;
        const prev = by.get(key);
        if (!prev || (!prev.time && o.time)) by.set(key, { ...o, name, competitor_id: p.competitor_id || null, url: p.url, title: p.title });
    });
    return [...by.values()].sort((a, b) => a.date.localeCompare(b.date) || String(a.time || '99').localeCompare(String(b.time || '99')));
}
