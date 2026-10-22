//  조간 카드뉴스(2860 형식 확정) — 지면 재료(paperEdition)를 '한 장에 한 메시지' 카드 목록으로 바꾼다.
//  순수 함수만 둔다. 문장은 코드 템플릿(AI 아님), 그리는 건 main.js 가 한다.
import { ratioWord } from './paperEdition.js';

const n = v => Number(v || 0).toLocaleString('ko-KR');
export const MAX_MOVE_CARDS = 6;
export const MAX_OPEN_ROWS = 7;
export const MAX_REST_ROWS = 18;

//  큰 숫자 칸: ♥ · 댓글 · 평소 대비 N배. 좋아요를 숨긴 계정(0)은 ♥ 칸을 빼고, 배수는 1.5배 이상일 때만.
export function statsOf(post, ratio) {
    const m = (post && post.meta) || {};
    return [
        m.likes ? { v: n(m.likes), k: '좋아요' } : null,
        m.comments != null && (m.comments || m.likes) ? { v: n(m.comments), k: '댓글' } : null,
        ratio != null && ratio >= 1.5 ? { v: ratioWord(ratio), k: '평소 대비' } : null,
    ].filter(Boolean);
}

//  경쟁사 동향 한 장의 제목 — 오픈 예고 > 튄 반응 > 글 수
export function moveTitle(m) {
    if (m.openWords && m.openWords.length) return `${m.name}, ${m.openWords[0]}`;
    if (m.ratio != null && m.ratio >= 1.5) return `${m.name}, 반응 평소 ${ratioWord(m.ratio)}`;
    return `${m.name}, 새 글 ${m.count}개`;
}

//  ed = { lead, cal, worked, moves, summary } (paperEdition 결과)
//  issues = [{ title, by, url }] · customer / resale = [{ title, url }]
export function cardDeck(ed, { issues = [], customer = [], resale = [], date = '' } = {}) {
    const E = ed || {}, body = [];
    const L = E.lead;
    if (L) body.push({ type: 'lead', kicker: `${L.range} · 경쟁사 최대 이슈`, title: L.headline, img: L.thumb,
        lines: [L.lines[0], L.lines[2]].filter(Boolean), stats: statsOf(L.post, L.ratio), url: L.url });

    const opens = (E.cal || []).flatMap(d => d.items.map(i => ({ day: d.label.replace(/[()]/g, ''), today: d.today, ...i })));
    if (opens.length) body.push({ type: 'open', kicker: '오늘부터 7일 · 경쟁사 글에서 뽑음', title: `이번주 오픈 ${opens.length}건`,
        rows: opens.slice(0, MAX_OPEN_ROWS).map(o => ({ day: o.day, today: o.today, when: o.when, name: o.name, kind: o.kind, what: o.what, url: o.url })),
        more: Math.max(0, opens.length - MAX_OPEN_ROWS) });

    //  6장까지만 카드로 — 넘치면 '어제 움직인 N곳 중 주요 6곳'이라 밝히고, 나머지 이름·글 수는 압축 카드 한 장에 남긴다(반려1)
    const moves = E.moves || [], shown = moves.slice(0, MAX_MOVE_CARDS), rest = moves.slice(MAX_MOVE_CARDS);
    shown.forEach((m, i) => body.push({ type: 'move',
        kicker: `경쟁사 동향 ${i + 1}/${shown.length} · ${rest.length ? `어제 움직인 ${moves.length}곳 중 주요 ${shown.length}곳` : '어제부터'}`,
        title: moveTitle(m), img: m.thumb,
        lines: [
            `'${m.bestHead}' 글이 가장 반응 좋음${m.count > 1 ? ` · 글 ${m.count}개 올림` : ''}`,
            [m.fmt && m.fmt.length ? `형식: ${m.fmt.join('+')}` : '', m.follow].filter(Boolean).join(' · '),
        ].filter(Boolean),
        stats: statsOf(m.post, m.ratio), url: m.url }));
    if (rest.length) body.push({ type: 'rest', kicker: `경쟁사 동향 · 어제 움직인 ${moves.length}곳 중 나머지`,
        title: `그 밖에 움직인 ${rest.length}곳`,
        rows: rest.slice(0, MAX_REST_ROWS).map(r => ({ name: r.name, count: r.count, url: r.url })),
        more: Math.max(0, rest.length - MAX_REST_ROWS) });

    const W = E.worked || [];
    //  '왜'는 캡션에서 보이는 장치를 짐작한 것 — 원인 분석이 아님을 머리줄에 박는다(2860 반려1)
    if (W.length) body.push({ type: 'top', kicker: '최근 7일 · 평소 대비 큰 순 · 장치는 캡션에서 추정(원인 분석 아님)', title: '잘 먹힌 글 TOP5',
        rows: W.slice(0, 5).map((w, i) => ({ rank: i + 1, img: w.thumb, name: w.name, tags: w.tags, slot: w.slot,
            react: w.react, why: w.why, url: w.url })) });

    if (issues.length) body.push({ type: 'issue', kicker: '최근 3주 · 같은 기사는 하나로', title: '업계 이슈',
        rows: issues.slice(0, 3) });

    if (customer.length || resale.length) body.push({ type: 'ours', kicker: '고객 반응 2주 · 중고 7일', title: '우리 고객 반응 · 중고',
        cols: [{ label: '고객 반응', count: customer.length, rows: customer.slice(0, 2) },
               { label: '중고로 올라온 우리 옷', count: resale.length, rows: resale.slice(0, 2) }] });

    const cover = { type: 'cover', date, count: body.length,
        title: L ? L.headline : (body.length ? '오늘의 경쟁사 소식' : '아직 들어온 소식이 없습니다'), summary: E.summary || '' };
    return [cover, ...body, { type: 'end', summary: E.summary || '' }];
}
