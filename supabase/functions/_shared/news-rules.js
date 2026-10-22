// 뉴스 칸 규칙 — 수집기(news-sync · channel-bots/news)와 화면(main.js)이 같이 쓴다.
//  여기 한 곳만 고치면 수집과 화면이 같이 바뀐다. 의존성 없는 순수 함수만 둔다(Deno·Vite 둘 다 읽는다).
//  칸: 고객 반응(review) · 경쟁·유통(trend) · 중고로 올라온 우리 옷(resale). '아동복 소식'(news)은 없앴다.

//  경쟁·유통 키워드 — 사장님 확정 전 임시 목록. 추가는 여기에만.
export const COMPETITORS = ['키디키디', '이랜드', '무신사키즈'];

//  이름만으로는 아동복과 상관없는 기사가 더 많은 경쟁사 — 아래 아동·키즈 낱말이 같이 있어야 한다.
//   '이랜드'는 로엠(여성복)·호카 총판·축구단·외식 기사가 대부분이라 단독으로는 받지 않는다(10-14 검수).
export const NEEDS_KIDS = ['이랜드'];
export const KIDS_CONTEXT = ['키즈', '아동', '유아', '어린이', '아기', '베이비', '주니어', '토들러', '신생아', '키디키디'];

//  경쟁사 이름이 들어가도 우리와 상관없는 섹션(뷰티·리빙·식음 등)
export const OFFTOPIC = [
    '뷰티', '화장품', '코스메틱', '스킨케어', '메이크업', '립스틱', '향수', '올리브영',
    '리빙', '인테리어', '가구', '침구', '주방', '생활용품', '홈데코',
    '외식', '레스토랑', '애슐리', '자연별곡', '이랜드이츠', '식품', '호텔', '리조트', '골프',
    //  '이랜드'로 찾으면 프로축구단(서울 이랜드 FC) 기사가 쏟아진다
    '서울이랜드', '이랜드fc', 'k리그', '축구', '풋살', '레울',
    '복지재단',
];

export const SIMILAR_TITLE = 0.85;     // 제목이 이만큼 닮으면 한 건
export const REVIEW_DAILY_MAX = 3;     // 고객 반응은 하루 최대 3건

const squash = s => String(s || '').replace(/\s+/g, '').toLowerCase();
//  제목 끝 ' - 매체명' 을 떼고 비교한다
const bareTitle = t => String(t || '').replace(/\s+-\s+[^-]{1,30}$/, '');

//  글자 2개씩 묶은 조각의 겹침(Dice). 1 = 같은 제목
export function similarity(a, b) {
    const A = squash(bareTitle(a)), B = squash(bareTitle(b));
    if (!A || !B) return 0;
    if (A === B) return 1;
    const grams = s => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
    const ga = grams(A), gb = grams(B);
    let hit = 0; ga.forEach((n, g) => { hit += Math.min(n, gb.get(g) || 0); });
    const total = Math.max(1, A.length - 1) + Math.max(1, B.length - 1);
    return (2 * hit) / total;
}

//  닮은 제목은 먼저 온 것 하나만 (목록은 최신순으로 넘긴다)
export function dedupeSimilar(list, th = SIMILAR_TITLE) {
    const kept = [];
    for (const x of list) {
        if (!kept.some(y => similarity(x.title, y.title) >= th)) kept.push(x);
    }
    return kept;
}

//  출처가 달라도 같은 기사 — 구글 검색은 '제목 < 섹션 < 기사본문 - 매체', 구글 뉴스는 '제목 - 매체',
//   어떤 매체는 '매체 - 제목' 으로 적는다. 꾸밈을 떼고 글자만 남긴 것이 같으면 한 기사다.
export function titleKey(t) {
    let s = String(t || '').split(/\s<\s/)[0];                     // '< 섹션 < 기사본문' 이하
    //  ' - ' 로 나뉘면 가장 긴 조각이 제목이다(매체명은 짧다 — 앞에 붙든 뒤에 붙든)
    s = s.split(/\s+-\s+/).reduce((a, b) => (b.length > a.length ? b : a), '');
    return s.replace(/\.{2,}|…/g, ' ').replace(/[^0-9a-z가-힣]+/gi, '').toLowerCase();
}
//  같은 기사가 여럿이면 날짜 있는 쪽 하나만(자리는 먼저 온 것 자리). 날짜 없는 사본은 옛 기사가 새 기사로 둔갑한다.
export function mergeSameTitle(list) {
    const at = new Map(), out = [];
    for (const x of list || []) {
        const k = titleKey(x.title);
        if (!k) { out.push(x); continue; }
        if (!at.has(k)) { at.set(k, out.length); out.push(x); continue; }
        const i = at.get(k);
        if (!out[i].published_at && x.published_at) out[i] = x;
    }
    return out;
}
//  경쟁·유통 칸 — 같은 기사 합친 뒤 날짜 없는 기사는 뺀다(수집일을 기사 날짜로 쓰면 2년 전 기사가 '이번 주'가 된다)
export function datedOnly(list) {
    return mergeSameTitle(list).filter(x => !!x.published_at);
}

//  같은 사건을 매체마다 다르게 적은 보도자료 — 85% 닮지 않아도 같은 이야기다(화면에서만 접는다).
//  제목 낱말(끝 조사 뗀 것)이 짧은 쪽 기준 절반 넘게 겹치면 같은 이야기로 보고 맨 처음 것만 남긴다.
const stem = w => w.replace(/(에서|에게|으로|에|의|은|는|이|가|을|를|로|와|과|도|만|까지|부터)$/, '') || w;
const tokens = t => new Set(String(t || '').toLowerCase().replace(/[^0-9a-z가-힣]+/g, ' ').split(' ')
    .map(stem).filter(w => w.length >= 2));
//  같은 사건(event) — 제목이 달라도 '같은 경쟁사 + 발행일 가까움'이면 한 사건이다.
//   10-12 키디키디 '30여 개 브랜드 캠페인 전개 / 겨울 신상품 릴레이 공개 / 2주간 FW 신상 릴레이 키디런' 은 낱말이 거의 안 겹쳐도 한 보도자료다(10-14 검수).
//   따옴표 속 캠페인명('키디런')이 같으면 릴레이 기간만큼 더 넓게 본다. 해마다 같은 이름으로 여는 캠페인은 날짜가 멀어 따로 남는다.
export const EVENT_DAYS = 3;            // 같은 경쟁사 기사가 이 날수 안이면 한 사건
export const CAMPAIGN_DAYS = 14;        // 캠페인명까지 같으면 이 날수 안
const mainCompetitor = (x, competitors = COMPETITORS) => {
    const h = hay(x);
    const hit = competitors.filter(c => h.includes(squash(c)));
    return hit.find(c => !NEEDS_KIDS.includes(c)) || hit[0] || '';   // '이랜드 키디키디' 는 키디키디로
};
const campaignOf = x => {
    const m = bareTitle(x.title).match(/[‘'"“′「『<]([^’'"”′」』>]{2,20})[’'"”′」』>]/);
    return m ? squash(m[1]) : '';
};
const dayNum = x => { const t = Date.parse(x.published_at || x.at_ts || x.created_at || ''); return Number.isNaN(t) ? null : t / 864e5; };
export function eventKey(x) { return { who: mainCompetitor(x), camp: campaignOf(x), day: dayNum(x) }; }
export function sameEvent(a, b) {
    const A = eventKey(a), B = eventKey(b);
    if (!A.who || A.who !== B.who || A.day === null || B.day === null) return false;
    const gap = Math.abs(A.day - B.day);
    return gap <= EVENT_DAYS || (!!A.camp && A.camp === B.camp && gap <= CAMPAIGN_DAYS);
}
//  화면용 — 같은 이야기(낱말 절반 겹침)나 같은 사건이면 1건만 남긴다. 순서는 넘겨받은 그대로.
//   남기는 건 제목에 경쟁사 이름이 있는 기사 중 최신 — 본문에만 이름이 나오는 블로그·인스타 글이 기사를 덮지 않게.
const nameInTitle = x => COMPETITORS.some(c => squash(x.title).includes(squash(c))) ? 1 : 0;
export function oneStoryEach(list) {
    const newestFirst = list.map((x, i) => ({ x, i })).sort((p, q) =>
        nameInTitle(q.x) - nameInTitle(p.x) || (dayNum(q.x) ?? -1e9) - (dayNum(p.x) ?? -1e9) || p.i - q.i);
    const kept = [], tk = new Map();
    for (const { x } of newestFirst) {
        const a = tokens(bareTitle(x.title));
        const dup = kept.some(y => {
            if (sameEvent(x, y)) return true;
            const b = tk.get(y); if (!a.size || !b || !b.size) return false;
            //  낱말이 겹쳐도 몇 달 떨어진 기사는 다른 이야기다(해마다 같은 이름 캠페인)
            const dx = dayNum(x), dy = dayNum(y);
            if (dx !== null && dy !== null && Math.abs(dx - dy) > CAMPAIGN_DAYS) return false;
            let hit = 0; a.forEach(w => { if (b.has(w)) hit++; });
            return hit / Math.min(a.size, b.size) >= 0.5;
        });
        if (!dup) { tk.set(x, a); kept.push(x); }
    }
    const keep = new Set(kept);
    return list.filter(x => keep.has(x));
}

const hay = x => squash(`${x.title || ''} ${x.snippet || ''}`);

//  경쟁·유통 한 건으로 쓸 수 있나 — 경쟁사 이름이 제목/요약에 있고, 무관 섹션이 아닐 것.
//   NEEDS_KIDS 경쟁사만 걸렸으면 아동·키즈 맥락 낱말도 있어야 한다.
export function isCompetition(x, competitors = COMPETITORS) {
    const h = hay(x);
    const hit = competitors.filter(c => h.includes(squash(c)));
    if (!hit.length) return false;
    const kids = KIDS_CONTEXT.some(w => h.includes(squash(w)));
    if (!hit.some(c => !NEEDS_KIDS.includes(c) || kids)) return false;
    return !OFFTOPIC.some(w => h.includes(squash(w)));
}

export function competitionList(items, competitors = COMPETITORS) {
    const seenUrl = new Set();
    const ok = items.filter(x => {
        if (!x.url || seenUrl.has(x.url)) return false;
        seenUrl.add(x.url);
        return isCompetition(x, competitors);
    });
    return dedupeSimilar(ok);
}

//  고객 반응 — 남이 우리 얘기를 한 글만
//   own.handles : 우리 공식 계정 아이디들(SNS 탭 ig_accounts.username)
//   own.urls    : 우리 계정이 올린 글 주소(해시태그로 다시 걸려 와도 작성자가 '#태그'로만 남아서 주소로 가린다)
//   own.brands  : 브랜드 이름들(brands.name)
const handleKey = h => String(h || '').trim().toLowerCase().replace(/^@/, '');
export function isOwnPost(x, own) {
    const handles = new Set((own.handles || []).map(handleKey));
    if (x.author && handles.has(handleKey(x.author))) return true;
    return !!(x.url && own.urls && own.urls.has(x.url));
}
export function mentionsUs(x, own) {
    const h = hay(x);
    if ((own.brands || []).some(b => b && h.includes(squash(b)))) return true;
    return (own.handles || []).some(hd => hd && h.includes('@' + handleKey(hd)));
}
const dayOf = x => {
    const t = x.published_at || x.at_ts || x.created_at;
    return t ? new Date(new Date(t).getTime() + 9 * 36e5).toISOString().slice(0, 10) : 'none';
};
export function customerList(items, own, perDay = REVIEW_DAILY_MAX) {
    const seenUrl = new Set(), perDayN = {};
    const out = [];
    for (const x of items) {
        if (!x.url || seenUrl.has(x.url)) continue;
        if (isOwnPost(x, own) || !mentionsUs(x, own)) continue;
        //  같은 글을 주소만 바꿔 다시 올린 것 — 본문이나 첫 줄(제목)이 85% 넘게 닮으면 한 건.
        //   고쳐서 다시 올리면 본문은 조금 달라져도 첫 줄은 그대로라 제목도 본다(짧은 제목은 우연히 닮아 뺀다).
        const body = `${x.title || ''} ${x.snippet || ''}`;
        const longTitle = squash(x.title).length >= 12;
        if (out.some(y => similarity(body, `${y.title || ''} ${y.snippet || ''}`) >= SIMILAR_TITLE
            || (longTitle && similarity(x.title, y.title) >= SIMILAR_TITLE))) continue;
        const d = dayOf(x);
        if ((perDayN[d] || 0) >= perDay) continue;
        seenUrl.add(x.url);
        perDayN[d] = (perDayN[d] || 0) + 1;
        out.push(x);
    }
    return out;
}

//  10-28 판정용: 최근 n일 칸별 유효 건수
export function validCounts(lists, days = 14, now = Date.now()) {
    const from = now - days * 864e5;
    const inWin = x => { const t = x.published_at || x.at_ts || x.created_at; return t && new Date(t).getTime() >= from; };
    const o = {};
    Object.entries(lists).forEach(([k, arr]) => { o[k] = (arr || []).filter(inWin).length; });
    return o;
}
