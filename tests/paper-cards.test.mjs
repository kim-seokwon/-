import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cardDeck, statsOf, moveTitle, MAX_MOVE_CARDS } from '../paperCards.js';
import { leadStory, openCalendar, topWorked, brandMoves, weekSummary } from '../paperEdition.js';

const NOW = Date.parse('2026-10-22T00:30:00Z');
const P = (id, cid, at, likes, comments, title = '', snippet = '') => ({ id, competitor_id: cid, kind: 'competitor_post',
    source: 'instagram', title, snippet, published_at: at, url: `u/${id}`, thumb: `t/${id}`, meta: { likes, comments, media_type: 'IMAGE' } });
const COMPS = 'abcdefgh'.split('').map(c => ({ id: c, name: `브랜드${c}` }));
const base = (cid, eng) => Array.from({ length: 4 }, (_, i) => P(`${cid}${i}`, cid, '2026-10-17T03:00:00Z', eng, 0, `평소 ${i}`));
const POSTS = [...'abcdefgh'.split('').flatMap(c => base(c, 50)),
    P('ev', 'a', '2026-10-21T11:00:00Z', 1156, 1269, '#댓글이벤트', '댓글 남겨주세요. 선물드려요'),
    P('op', 'b', '2026-10-21T11:37:00Z', 52, 1, '10월 28일(수) 오전 10시', '턱받이 오픈됩니다!'),
    ...'cdefgh'.split('').map((c, i) => P(`m${c}`, c, '2026-10-21T12:00:00Z', 60 + i, 2, `새 글 ${c}`))];
const edOf = posts => {
    const cal = openCalendar(posts, COMPS, { now: NOW }), worked = topWorked(posts, COMPS, { now: NOW });
    return { lead: leadStory(posts, COMPS, { now: NOW }), cal, worked, moves: brandMoves(posts, COMPS, [], { now: NOW }), summary: weekSummary(cal, worked) };
};

test('카드 순서: 표지 → 머리기사 → 이번주 오픈 → 동향(최대 6) → 나머지 압축 → TOP5 → 이슈 → 고객·중고 → 끝', () => {
    const deck = cardDeck(edOf(POSTS), { issues: [1, 2, 3, 4].map(i => ({ title: `기사${i}`, by: '구글', url: `i${i}` })),
        customer: [{ title: '후기', url: 'c' }], date: '2026년 10월 22일 목요일' });
    const types = deck.map(c => c.type);
    assert.deepEqual([...new Set(types)], ['cover', 'lead', 'open', 'move', 'rest', 'top', 'issue', 'ours', 'end']);
    assert.equal(types.filter(t => t === 'move').length, MAX_MOVE_CARDS);      // 8곳 움직였어도 6장
    assert.equal(deck[0].count, deck.length - 2);                               // '오늘 볼 것 N장' = 표지·끝 제외
    assert.equal(deck.find(c => c.type === 'issue').rows.length, 3);
    assert.equal(deck[0].title, deck[1].title);                                 // 표지 제목 = 머리기사 제목
});
test('반려1 회귀: 동향 8곳이면 주요 6장 + 나머지 2곳 압축 카드(이름·글 수), 6곳 이하면 안내·압축 카드 없음', () => {
    const mv = k => Array.from({ length: k }, (_, i) => ({ name: `곳${i + 1}`, count: i + 1, bestHead: '글', fmt: [], follow: '', openWords: [], ratio: null,
        post: { meta: { likes: 10, comments: 1 } }, thumb: null, url: `m${i}` }));
    const d8 = cardDeck({ moves: mv(8) });
    const mv8 = d8.filter(c => c.type === 'move'), rest8 = d8.filter(c => c.type === 'rest');
    assert.equal(mv8.length, 6);
    assert.ok(mv8.every(c => c.kicker.includes('어제 움직인 8곳 중 주요 6곳')), mv8[0].kicker);
    assert.equal(rest8.length, 1);
    assert.equal(rest8[0].title, '그 밖에 움직인 2곳');
    assert.deepEqual(rest8[0].rows.map(r => [r.name, r.count]), [['곳7', 7], ['곳8', 8]]);
    assert.equal(d8.indexOf(rest8[0]), d8.indexOf(mv8[5]) + 1, '압축 카드는 마지막 동향 카드 바로 뒤');
    const d6 = cardDeck({ moves: mv(6) });
    assert.equal(d6.filter(c => c.type === 'move').length, 6);
    assert.ok(!d6.some(c => c.type === 'rest'));
    assert.ok(d6.filter(c => c.type === 'move').every(c => !c.kicker.includes('주요')), '6곳 이하엔 불필요 안내 없음');
    //  아주 많아도 조용히 사라지지 않는다 — 18줄 + '외 N곳'
    const r40 = cardDeck({ moves: mv(40) }).find(c => c.type === 'rest');
    assert.equal(r40.rows.length + r40.more, 34);
    const src = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    assert.ok(src.includes("c.type === 'rest'") && src.includes('외 ${c.more}곳'), '압축 카드를 실제로 그린다');
});
test('내용 없는 장은 뺀다', () => {
    const old = base('a', 50).map(p => ({ ...p, published_at: '2026-10-01T03:00:00Z' }));   // 2주 넘은 글뿐
    const deck = cardDeck(edOf(old), {});
    assert.deepEqual(deck.map(c => c.type), ['cover', 'end']);
    assert.equal(deck[0].count, 0);
    assert.equal(deck[0].title, '아직 들어온 소식이 없습니다');
});
test('한 장 = 큰 제목 + 사진 + 핵심 2~3줄 + 숫자', () => {
    const deck = cardDeck(edOf(POSTS), {});
    const lead = deck.find(c => c.type === 'lead');
    assert.equal(lead.title, "브랜드a, '댓글이벤트' 글에 반응 평소 49배");
    assert.deepEqual(lead.stats.map(s => s.v), ['1,156', '1,269', '49배']);
    assert.ok(lead.img && lead.lines.length >= 1 && lead.lines.length <= 3);
    const mvs = deck.filter(c => c.type === 'move');
    assert.equal(mvs[0].title, '브랜드b, 10/28 오전 10시 오픈 예고');        // 오픈 예고가 맨 앞
    for (const c of deck) for (const l of c.lines || []) assert.ok(l.length <= 120, l);
});
test('숫자 칸: 좋아요 숨긴 계정은 ♥ 빼고, 배수는 1.5배 이상만', () => {
    assert.deepEqual(statsOf({ meta: { likes: 0, comments: 12 } }, null).map(s => s.k), ['댓글']);
    assert.deepEqual(statsOf({ meta: { likes: 0, comments: 0 } }, null), []);
    assert.deepEqual(statsOf({ meta: { likes: 80, comments: 3 } }, 1.2).map(s => s.k), ['좋아요', '댓글']);
    assert.equal(moveTitle({ name: 'X', openWords: [], ratio: 3.4, count: 2 }), 'X, 반응 평소 3.4배');
    assert.equal(moveTitle({ name: 'X', openWords: [], ratio: null, count: 2 }), 'X, 새 글 2개');
});
test('카드 CSS: 정사각 · 가로 스냅 · 모바일 폭', () => {
    const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    assert.match(css, /\.pc-card\{flex:0 0 100%;aspect-ratio:1\/1;scroll-snap-align:start/);
    assert.match(css, /scroll-snap-type:x mandatory/);
    assert.match(css, /--cw:min\(560px,calc\(100vw - 32px\)/);
});
