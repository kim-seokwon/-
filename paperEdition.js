//  조간 지면 짜기 — 클릭 없이 위에서 아래로 읽히는 신문. 화면 없이 계산만 하는 순수 함수들.
//   1면 머리기사 · 이번주 오픈 달력 · 경쟁사 동향 단락 · 잘 먹힌 글 TOP5 · 이번주 한 줄 요약
//   집계는 코드, 문장은 템플릿 — LLM 없이 같은 입력이면 같은 지면이 나온다.
import { engOf, nameOfPost, reactionStats, extractOpening, upcomingOpenings, followerChange } from './competitorBoard.js';

const DAY = 864e5;
const KST = 9 * 36e5;
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const tsOf = p => { const t = Date.parse((p && (p.published_at || p.created_at)) || ''); return Number.isNaN(t) ? null : t; };
const kstYmd = ms => new Date(ms + KST).toISOString().slice(0, 10);
const dowOfYmd = ymd => DOW[new Date(ymd + 'T00:00:00Z').getUTCDay()];
const md = ymd => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
const n = v => Number(v || 0).toLocaleString('ko-KR');

//  '14:00' → '오후 2시', '10:30' → '오전 10시 30분'
export function hourWord(hhmm) {
    if (!hhmm) return '';
    const [h, m] = hhmm.split(':').map(Number);
    const ap = h < 12 ? '오전' : '오후', h12 = h % 12 || 12;
    return `${ap} ${h12}시${m ? ` ${m}분` : ''}`;
}
//  글 올린 때(KST) — '목 오전 10시'
export function slotOf(p) {
    const t = tsOf(p); if (t == null) return '';
    const k = new Date(t + KST);
    return `${DOW[k.getUTCDay()]} ${hourWord(`${k.getUTCHours()}:00`)}`;
}
//  배수 — 10배 넘으면 정수, 아래면 소수 한 자리
export const ratioWord = r => r == null ? '' : (r >= 10 ? `${Math.round(r)}배` : `${(Math.round(r * 10) / 10)}배`);

//  캡션 정리 — 이모지·해시태그·연속 공백을 걷고 첫 문장만
const EMO = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}\u{2B00}-\u{2BFF}]/gu;
export function cleanText(s) {
    return String(s || '').replace(EMO, ' ').replace(/#\S+/g, ' ').replace(/[*_~|]+/g, ' ').replace(/\s+/g, ' ').trim();
}
export function firstSentence(s, max = 90) {
    const t = cleanText(s);
    if (t.length <= max) return t;
    //  max 안에서 마지막 문장 끝(. ! ?)에서 자른다. 너무 짧아지면 그냥 max에서 자른다.
    const head = t.slice(0, max);
    const end = Math.max(...['. ', '! ', '? ', '。'].map(x => head.lastIndexOf(x)));
    return end >= 20 ? head.slice(0, end + 1).trim() : head.slice(0, max - 1).trim() + '…';
}
//  글 제목 — 해시태그만 있으면 해시태그를 낱말로, 그래도 없으면 본문 첫 문장
export function headOf(p, max = 40) {
    const t = cleanText(p.title);
    if (t) return t.length > max ? t.slice(0, max - 1).trim() + '…' : t;
    const tags = String(p.title || '').match(/#(\S+)/g);
    if (tags) return tags.slice(0, 2).map(x => x.slice(1).replace(EMO, '')).filter(Boolean).join(' · ');
    return firstSentence(p.snippet, max) || '제목 없음';
}

// ── 글 형식 태그 (캡션 키워드 + media_type) ─────────────
const TAG_RULES = [
    ['당첨발표', /당첨자?\s*발표/],
    ['댓글이벤트', /댓글\s*(?:이벤트|달아|남겨|참여)|댓글에\s*하트|giveaway|추첨/i],
    ['프리오더', /프리\s?오더|pre[\s-]?order/i],
    ['재입고', /재입고|리스탁|restock/i],
    ['신상', /신상|신제품|new\s?arrival|\bnew\b|컬렉션|collection|\bdrop\b|드롭/i],
    ['할인', /\d{1,2}\s*%|할인|세일|\bsale\b|특가|쿠폰|\boff\b/i],
    ['후기리그램', /후기|리뷰|review|리그램|regram|repost/i],
    ['룩북', /룩북|lookbook|화보/i],
    ['공구·라이브', /공구|공동구매|라이브\s?방송|\blive\b/i],
    ['팝업·협업', /팝업|pop[\s-]?up|콜라보|협업|collab/i],
];
export function postTags(p) {
    const text = `${p.title || ''} ${p.snippet || ''}`;
    const tags = TAG_RULES.filter(([, re]) => re.test(text)).map(([t]) => t);
    if (!tags.includes('프리오더') && extractOpening(p)) tags.splice(tags.includes('댓글이벤트') ? 1 : 0, 0, '오픈공지');
    const mt = String((p.meta || {}).media_type || '').toUpperCase();
    if (mt === 'VIDEO' || mt === 'REELS') tags.push('릴스');
    return tags.length ? tags.slice(0, 3) : ['일반'];
}
const BENEFITS = [
    ['선물', /선물|증정|사은품|기프트|\bgift\b/i],
    ['무료배송', /무료\s?배송|무배/],
    ['적립', /적립금|포인트\s?적립/],
    ['쿠폰', /쿠폰/],
];
export function benefitsOf(p) {
    const text = `${p.title || ''} ${p.snippet || ''}`;
    const out = BENEFITS.filter(([, re]) => re.test(text)).map(([b]) => b);
    const pct = text.match(/(\d{1,2})\s*%\s*(?:할인|off|OFF|세일)?/);
    if (pct && Number(pct[1]) >= 5) out.unshift(`${pct[1]}% 할인`);
    return out.slice(0, 2);
}
const WHY = {
    댓글이벤트: '댓글을 달아야 참여되는 이벤트', 당첨발표: '이벤트 당첨 발표',
    오픈공지: '오픈 날짜·시각을 미리 알림', 프리오더: '오픈 전에 미리 주문을 받음', 재입고: '재입고 알림',
    신상: '신상 첫 공개', 할인: '할인을 앞에 걸음', 후기리그램: '고객 후기를 다시 올림', 룩북: '룩북·화보',
    '공구·라이브': '공구·라이브 안내', '팝업·협업': '팝업·협업 소식', 릴스: '영상(릴스)',
};
//  '왜 먹혔나' — 형식·혜택 키워드로 짐작한 한 줄(추정이다)
export function whyLine(p) {
    const tags = postTags(p), ben = benefitsOf(p);
    const head = tags[0] === '일반' ? '특별한 장치 없이 사진·문구만' : WHY[tags[0]];
    const extra = tags.slice(1).filter(t => t !== '일반').map(t => WHY[t]).filter(Boolean);
    return [head, ...extra.slice(0, 1)].join(' + ') + (ben.length ? ` + 혜택 '${ben.join('·')}'` : '');
}

// ── 브랜드별 평소 반응 ────────────────────────────────
//  평소 = 그 브랜드 최근 글 반응 중앙값(글 4개 이상).
//  평소가 RATIO_MIN_USUAL 미만이면(좋아요 숨긴 계정·아주 작은 계정) '175배' 같은 헛배수가 나와 배수를 말하지 않는다.
export const RATIO_MIN_USUAL = 20;
export function brandStats(posts) {
    const by = {};
    (posts || []).forEach(p => { const k = p.competitor_id || (p.meta || {}).name || p.author; (by[k] = by[k] || []).push(p); });
    const usual = {}, spikes = new Map();
    Object.entries(by).forEach(([k, ps]) => {
        const st = reactionStats(ps); usual[k] = st.usual;
        st.spikes.forEach((v, id) => spikes.set(id, v));
    });
    const keyOf = p => p.competitor_id || (p.meta || {}).name || p.author;
    const ratioOf = p => { const u = usual[keyOf(p)]; return u != null && u >= RATIO_MIN_USUAL ? engOf(p) / u : null; };
    return { usual, spikes, ratioOf, usualOf: p => usual[keyOf(p)] ?? null };
}

//  반응 한 줄 — '♥ 1,156 · 댓글 1,269 (평소 10배)'
export function reactWord(p, ratio) {
    const m = p.meta || {};
    const base = `♥ ${n(m.likes)} · 댓글 ${n(m.comments)}`;
    return ratio != null && ratio >= 1.5 ? `${base} (평소 ${ratioWord(ratio)})` : base;
}

// ── ① 1면 머리기사 ──────────────────────────────────
//  지난 24시간 경쟁사 글 중: 평소 대비 가장 튄 글 → 없으면 가장 가까운 오픈 예고 → 없으면 반응 최대.
//  24시간 안에 글이 없으면 3일로 넓히고 그렇게 적는다.
export function leadStory(posts, comps, { now = Date.now() } = {}) {
    const st = brandStats(posts);
    for (const hours of [24, 72]) {
        const win = (posts || []).filter(p => { const t = tsOf(p); return t != null && t >= now - hours * 36e5 && t <= now + 36e5; });
        if (!win.length) continue;
        const range = hours === 24 ? '지난 24시간' : '지난 3일';
        const spike = win.filter(p => st.spikes.has(p.id) && st.ratioOf(p) != null)
            .sort((a, b) => st.ratioOf(b) - st.ratioOf(a))[0];
        const today = kstYmd(now);
        const open = win.map(p => ({ p, o: extractOpening(p) })).filter(x => x.o && x.o.date >= today)
            .sort((a, b) => a.o.date.localeCompare(b.o.date) || engOf(b.p) - engOf(a.p))[0];
        const top = win.slice().sort((a, b) => engOf(b) - engOf(a))[0];
        const pick = spike ? { kind: 'spike', p: spike } : open ? { kind: 'open', p: open.p, o: open.o } : { kind: 'top', p: top };
        const p = pick.p, name = nameOfPost(p, comps), r = st.ratioOf(p), tags = postTags(p);
        const o = pick.o || extractOpening(p);
        const headline = pick.kind === 'spike' ? `${name}, '${tags[0]}' 글에 반응 평소 ${ratioWord(r)}`
            : pick.kind === 'open' ? `${name}, ${md(o.date)}(${dowOfYmd(o.date)}) ${o.time ? hourWord(o.time) + ' ' : ''}${o.kind} 예고`
            : `${name}, ${reactWord(p)} — ${range} 가장 큰 반응`;
        const ben = benefitsOf(p);
        const lines = [
            `${firstSentence(`${p.title || ''} ${p.snippet || ''}`, 110) || headOf(p)}`,
            `${reactWord(p, r)}${st.usualOf(p) ? ` · 평소 글 하나 ${n(Math.round(st.usualOf(p)))}` : ''}${o && pick.kind !== 'open' && o.date >= today ? ` · ${md(o.date)} ${o.time ? hourWord(o.time) + ' ' : ''}${o.kind} 예고` : ''}`,
            `형식: ${tags.join('+')}${ben.length ? ` · 혜택: ${ben.join('·')}` : ''} · 올린 때: ${slotOf(p)}`,
        ];
        return { kind: pick.kind, range, name, headline, lines, ratio: r, tags, post: p, thumb: p.thumb || null, url: p.url };
    }
    return null;
}

// ── ② 이번주 오픈 달력 ─────────────────────────────
//  오늘부터 7일을 날마다 한 줄씩. 오픈이 없는 날도 줄은 남긴다(달력이니까).
export function openCalendar(posts, comps, { days = 7, now = Date.now() } = {}) {
    const ups = upcomingOpenings(posts, comps, { days, now });
    const byId = new Map((posts || []).map(p => [p.id, p]));
    const t0 = Date.parse(kstYmd(now) + 'T00:00:00Z');
    return Array.from({ length: days }, (_, i) => {
        const ymd = new Date(t0 + i * DAY).toISOString().slice(0, 10);
        const items = ups.filter(o => o.date === ymd).map(o => {
            const p = byId.get(o.post_id) || {};
            return { time: o.time, when: o.time ? hourWord(o.time) : '시각 미정', name: o.name, kind: o.kind,
                     what: headOf(p.title ? p : { title: o.title, snippet: '' }, 36),
                     caption: firstSentence(p.snippet, 64), url: o.url };
        });
        return { date: ymd, label: `${md(ymd)} (${dowOfYmd(ymd)})`, today: i === 0, items };
    });
}
//  경쟁사들이 몇 시·무슨 요일에 여나 — 최근 글에서 뽑은 오픈(지난 것 포함) 기준
export function openPattern(posts) {
    const seen = new Set(), list = [];
    (posts || []).forEach(p => {
        const o = extractOpening(p); if (!o) return;
        const k = `${p.competitor_id || p.author}|${o.date}`; if (seen.has(k)) return; seen.add(k);
        list.push(o);
    });
    const mode = arr => {
        const c = {}; arr.forEach(x => { c[x] = (c[x] || 0) + 1; });
        const top = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
        return top ? { v: top[0], k: top[1] } : null;
    };
    const timed = list.filter(o => o.time);
    //  '주로'라고 말하려면 셋 중 하나(30%) 이상은 그 시각·요일이어야 한다
    const often = (m, total) => m && m.k / total >= 0.3 ? m : null;
    const h = timed.length >= 3 ? often(mode(timed.map(o => o.time.slice(0, 2))), timed.length) : null;
    const d = list.length >= 3 ? often(mode(list.map(o => dowOfYmd(o.date))), list.length) : null;
    return { count: list.length, timed: timed.length,
             hour: h ? hourWord(`${h.v}:00`) : null, hourShare: h ? `${h.k}/${timed.length}` : null,
             dow: d ? `${d.v}요일` : null, dowShare: d ? `${d.k}/${list.length}` : null };
}

// ── ④ 잘 먹힌 글 TOP5 ──────────────────────────────
//  7일 글을 '그 브랜드 평소 대비' 배수로 줄 세운다(큰 계정이 늘 이기지 않게).
//  평소를 모르는 글은 배수 있는 글 뒤에 반응 순으로.
export function topWorked(posts, comps, { days = 7, top = 5, now = Date.now() } = {}) {
    const st = brandStats(posts);
    return (posts || []).filter(p => { const t = tsOf(p); return t != null && t >= now - days * DAY && t <= now + DAY; })
        .filter(p => engOf(p) > 0)
        .map(p => ({ p, r: st.ratioOf(p) }))
        .sort((a, b) => (b.r != null) - (a.r != null) || (b.r ?? 0) - (a.r ?? 0) || engOf(b.p) - engOf(a.p))
        .slice(0, top)
        .map(({ p, r }) => ({ post: p, name: nameOfPost(p, comps), head: headOf(p), tags: postTags(p), slot: slotOf(p),
                              react: reactWord(p, r), ratio: r, why: whyLine(p), thumb: p.thumb || null, url: p.url }));
}

// ── ③ 경쟁사 동향 — 어제부터 움직인 브랜드마다 한 단락 ──────
//  움직임 = 어제 0시(KST) 이후 글. 글 없는 브랜드는 쓰지 않는다.
export function brandMoves(posts, comps, snaps, { now = Date.now() } = {}) {
    const st = brandStats(posts);
    const from = Date.parse(kstYmd(now - DAY) + 'T00:00:00Z') - KST;
    const today = kstYmd(now);
    const snapBy = {};
    (snaps || []).forEach(s => { (snapBy[s.competitor_id] = snapBy[s.competitor_id] || []).push(s); });
    const by = new Map();
    (posts || []).forEach(p => {
        const t = tsOf(p); if (t == null || t < from || t > now + 36e5) return;
        const k = p.competitor_id || nameOfPost(p, comps);
        if (!by.has(k)) by.set(k, []); by.get(k).push(p);
    });
    return [...by.entries()].map(([k, ps]) => {
        ps.sort((a, b) => engOf(b) - engOf(a));
        const best = ps[0], name = nameOfPost(best, comps), r = st.ratioOf(best);
        const opens = ps.map(extractOpening).filter(o => o && o.date >= today)
            .filter((o, i, a) => a.findIndex(x => x.date === o.date) === i);
        const fc = followerChange(snapBy[k]);
        const tags = [...new Set(ps.flatMap(postTags))].filter(t => t !== '일반').slice(0, 3);
        const ben = [...new Set(ps.flatMap(benefitsOf))].slice(0, 2);
        const parts = [
            ...opens.slice(0, 2).map(o => `${md(o.date)} ${o.time ? hourWord(o.time) + ' ' : ''}${o.kind} 예고`),
            `'${headOf(best, 24)}' 글 ${reactWord(best, r)}`,
            ps.length > 1 ? `글 ${ps.length}개 올림` : '',
            fc.delta ? `팔로워 ${fc.delta > 0 ? '+' : ''}${n(fc.delta)}(${fc.span}일)` : '',
        ].filter(Boolean);
        const fm = [...tags.filter(t => !(t === '할인' && ben.some(b => b.endsWith('할인')))), ...ben];
        const text = `${parts.join('. ')}.${fm.length ? ` 형식: ${fm.join('+')}` : ''}`;
        const score = (opens.length ? 1000 : 0) + (r || 0) * 10 + Math.min(engOf(best), 5000) / 100;
        return { competitor_id: best.competitor_id || null, name, text, opens: opens.length, ratio: r, count: ps.length,
                 //  카드뉴스용 낱개 값(문단 text 와 같은 재료)
                 openWords: opens.slice(0, 2).map(o => `${md(o.date)} ${o.time ? hourWord(o.time) + ' ' : ''}${o.kind} 예고`),
                 bestHead: headOf(best, 24), fmt: fm, follow: fc.delta ? `팔로워 ${fc.delta > 0 ? '+' : ''}${n(fc.delta)}(${fc.span}일)` : '',
                 post: best, thumb: best.thumb || null, url: best.url, score };
    }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'ko'));
}

// ── 이번주 한 줄 요약 ───────────────────────────────
//  '이번주: 오픈 6건(목요일 4건 · 오전 10시 3건이 가장 많음) · 반응 좋은 형식 = 댓글이벤트'
//  시각·요일도 오픈 수와 같은 '이번 7일 달력'에서만 센다 — 최근 2주 패턴(openPattern)과 섞지 않는다(반려1)
export function weekSummary(calendar, worked) {
    const items = calendar.flatMap(d => d.items.map(i => ({ ...i, dow: d.label.match(/\((.)\)/)?.[1] })));
    const opens = items.length;
    const top = arr => {
        const c = {}; arr.forEach(x => { c[x] = (c[x] || 0) + 1; });
        const t = Object.entries(c).sort((a, b) => b[1] - a[1]);
        //  3건 이상이고, 1등이 30% 이상이며 2등과 동률이 아닐 때만 '가장 많음'
        return t.length && arr.length >= 3 && t[0][1] / arr.length >= 0.3 && !(t[1] && t[1][1] === t[0][1]) ? t[0] : null;
    };
    const d = top(items.map(i => i.dow).filter(Boolean));
    const h = top(items.filter(i => i.time).map(i => i.time.slice(0, 2)));
    const often = [d && `${d[0]}요일 ${d[1]}건`, h && `${hourWord(`${h[0]}:00`)} ${h[1]}건`].filter(Boolean).join(' · ');
    const c = {};
    worked.forEach(w => w.tags.filter(t => t !== '일반').forEach(t => { c[t] = (c[t] || 0) + 1; }));
    const best = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
    return `이번주: 오픈 ${opens}건${often ? `(${often}이 가장 많음)` : opens >= 3 ? '(요일·시각은 제각각)' : ''}`
        + (best ? ` · 반응 좋은 형식 = ${best[0]}` : '');
}
