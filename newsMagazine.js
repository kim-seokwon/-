//  뉴스탭 = 누르지 않고 훑어지는 매거진 한 화면(10-22 사장님 "뉴스탭은 너무 구려. 다시 만들어").
//  여기는 순수 함수만 — 섹션별 재료를 고르고 숫자를 센다. 그리는 건 main.js renderNews.
//  데이터·수집은 그대로 쓴다(loadNews 가 읽어 온 것).
import { openCalendar, topWorked, headOf, ratioWord } from './paperEdition.js';
import { engOf, nameOfPost, rankCompetitors } from './competitorBoard.js';
import { oneStoryEach, isPopupNews, isCompetition } from './supabase/functions/_shared/news-rules.js';

const DAY = 864e5, KST = 9 * 36e5;
const tsOf = x => { const t = Date.parse((x && (x.published_at || x.created_at)) || ''); return Number.isNaN(t) ? null : t; };

//  출처는 원문 코드(bunjang) 말고 한글 이름으로
export const SOURCE_KO = {
    naver_blog: '네이버 블로그', naver_cafe: '네이버 카페', naver_news: '네이버 뉴스',
    google: '구글', google_news: '구글 뉴스', instagram: '인스타그램', datalab: '데이터랩',
    bunjang: '번개장터', daangn: '당근', karrot: '당근', joonggonara: '중고나라', junggonara: '중고나라',
    hellomarket: '헬로마켓', fruitsfamily: '후루츠패밀리', kream: '크림', youtube: '유튜브', threads: '스레드',
};
export const sourceKo = s => SOURCE_KO[s] || (s ? '기타' : '');

export const MAG = { TOP_POSTS: 10, BRANDS: 12, LIST: 6, RESALE: 8, RECENT_THUMBS: 3 };

//  '오늘'·'어제'·'3일 전'·'10/12' — 빈 날짜는 빈칸(— 를 찍지 않는다)
export function whenWord(t, now = Date.now()) {
    const ms = Date.parse(t || ''); if (Number.isNaN(ms)) return '';
    const day = x => Math.floor((x + KST) / DAY);
    const a = day(now) - day(ms);
    if (a <= 0) return '오늘';
    if (a === 1) return '어제';
    if (a < 7) return `${a}일 전`;
    const d = new Date(ms + KST);
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

export const kNum = n => n == null ? '' : (n >= 10000 ? `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)}만` : Number(n).toLocaleString('ko-KR'));

//  찾기 — 제목·본문·작성자·브랜드에 낱말이 들었나
export const matches = (q, ...xs) => !q || xs.some(x => String(x || '').toLowerCase().includes(q));

//  C = { review, trend, resale, competitor } (loadNews 결과) · comps · snaps
export function magazine(C, comps, snaps, { now = Date.now(), q = '' } = {}) {
    const query = String(q || '').trim().toLowerCase();
    const posts = (C && C.competitor) || [];
    const yStart = Date.parse(new Date(now + KST - DAY).toISOString().slice(0, 10) + 'T00:00:00Z') - KST;   // 어제 0시(KST)
    const day14 = now - 14 * DAY;

    //  이번주 오픈 — 오늘부터 7일, 글에서 뽑은 날짜
    const opens = openCalendar(posts, comps, { now })
        .flatMap(d => d.items.map(i => ({ day: d.label, today: d.today, ...i })))
        .filter(o => matches(query, o.name, o.what, o.kind));

    //  잘 먹힌 글 — 최근 7일, 평소 대비 큰 순(조간 TOP5 와 같은 기준). 배수는 1.5배 넘을 때만 적는다.
    const top = topWorked(posts, comps, { now, top: 60 })
        .map(w => ({ id: w.post.id, url: w.url, thumb: w.thumb, brand: w.name, head: w.head,
            likes: (w.post.meta || {}).likes, comments: (w.post.meta || {}).comments,
            hot: w.ratio != null && w.ratio >= 1.5 ? `평소 ${ratioWord(w.ratio)}` : '', when: whenWord(w.post.published_at, now) }))
        .filter(x => matches(query, x.brand, x.head));

    //  지켜보는 곳 — 브랜드 카드: 최근 글 썸네일 3장 + 팔로워(있을 때만) + 7일 변화(기록 있을 때만)
    const byComp = {};
    posts.forEach(p => { if (p.competitor_id) (byComp[p.competitor_id] = byComp[p.competitor_id] || []).push(p); });
    const brands = rankCompetitors(comps, snaps).map(r => {
        const ps = (byComp[r.id] || []).slice().sort((a, b) => (tsOf(b) || 0) - (tsOf(a) || 0));
        const last = ps[0] ? tsOf(ps[0]) : null;
        return { id: r.id, name: r.name, handle: r.handle, followers: r.followers ?? null, delta: r.delta ?? null, span: r.span,
            recent: ps.slice(0, MAG.RECENT_THUMBS).filter(p => p.thumb).map(p => ({ thumb: p.thumb, url: p.url })),
            newCount: ps.filter(p => (tsOf(p) || 0) >= yStart).length,
            week: ps.filter(p => (tsOf(p) || 0) >= now - 7 * DAY).length,
            lastWhen: last ? whenWord(ps[0].published_at, now) : '', last: last || 0 };
    })
        //  지금 움직이는 곳이 먼저 — 어제부터 새 글 → 최근 글 시각 → 팔로워 변화 순
        .sort((a, b) => b.newCount - a.newCount || b.last - a.last || Math.abs(b.delta || 0) - Math.abs(a.delta || 0))
        .filter(b => matches(query, b.name, b.handle));

    const item = x => ({ id: x.id, url: x.url, title: x.title || '', snippet: x.snippet || '', source: sourceKo(x.source),
        author: x.author && !String(x.author).startsWith('#') ? x.author : '', thumb: x.thumb || (x.meta && x.meta.thumb) || null,
        when: whenWord(x.published_at, now), price: x.meta && x.meta.price ? Number(x.meta.price) : null,
        likes: x.meta && x.meta.likes != null ? x.meta.likes : null, comments: x.meta && x.meta.comments != null ? x.meta.comments : null,
        //  경쟁사 이름 없이 팝업 규칙으로 들어온 기사 — 카드에 '팝업' 꼬리표
        popup: !isCompetition(x) && isPopupNews(x) });
    const pick = list => (list || []).map(item).filter(x => matches(query, x.title, x.snippet, x.author, x.source));
    //  경쟁·유통은 같은 보도자료 재탕을 한 건으로
    const customer = pick(C && C.review), trend = pick(oneStoryEach((C && C.trend) || [])), resale = pick(C && C.resale);

    //  오늘 요약 띠 — 숫자만, 누르면 그 섹션으로
    const in14 = list => (list || []).filter(x => (tsOf(x) || 0) >= day14).length;
    const summary = [
        { key: 'customer', label: '고객 반응', value: in14(C && C.review), note: '최근 14일' },
        { key: 'brands', label: '경쟁사 새 글', value: posts.filter(p => (tsOf(p) || 0) >= yStart).length, note: '어제부터' },
        { key: 'opens', label: '오픈 예정', value: openCalendar(posts, comps, { now }).reduce((n, d) => n + d.items.length, 0), note: '앞으로 7일' },
        { key: 'resale', label: '중고 매물', value: ((C && C.resale) || []).length, note: '모인 매물' },   // 중고는 드물다 — 아래 칸과 같은 수
    ];
    return { summary, opens, top, brands, customer, trend, resale, empty: !opens.length && !top.length && !brands.length && !customer.length && !trend.length && !resale.length };
}

//  썸네일 반응 숫자 — 좋아요를 숨긴 계정(0)은 ♥ 를 빼고 댓글만
export function reactBits(likes, comments) {
    return [likes ? `♥ ${kNum(likes)}` : '', comments ? `댓글 ${kNum(comments)}` : ''].filter(Boolean);
}
export { engOf, headOf, nameOfPost };
