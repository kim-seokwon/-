import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    hourWord, slotOf, ratioWord, firstSentence, headOf, postTags, benefitsOf, whyLine, brandStats,
    leadStory, openCalendar, openPattern, topWorked, brandMoves, weekSummary, RATIO_MIN_USUAL,
} from '../paperEdition.js';

const NOW = Date.parse('2026-10-22T00:30:00Z');   // 10-22(목) 09:30 KST
const P = (id, cid, at, likes, comments, title = '', snippet = '', mt = 'IMAGE') => ({ id, competitor_id: cid, kind: 'competitor_post',
    source: 'instagram', title, snippet, published_at: at, url: `u/${id}`, thumb: `t/${id}`, meta: { likes, comments, media_type: mt } });
const COMPS = [{ id: 'a', name: '코코하니' }, { id: 'b', name: '베베소유' }, { id: 'c', name: '작은계정' }];
//  브랜드 평소 반응을 만드는 바탕 글(5일 전)
const base = (cid, eng, k = 4) => Array.from({ length: k }, (_, i) => P(`${cid}${i}`, cid, '2026-10-17T03:00:00Z', eng, 0, `평소 글 ${i}`));

test('시각·배수 말투', () => {
    assert.equal(hourWord('14:00'), '오후 2시');
    assert.equal(hourWord('10:30'), '오전 10시 30분');
    assert.equal(hourWord('00:00'), '오전 12시');
    assert.equal(slotOf({ published_at: '2026-10-21T11:00:00Z' }), '수 오후 8시');
    assert.equal(ratioWord(21.6), '22배');
    assert.equal(ratioWord(3.44), '3.4배');
});
test('캡션 정리: 이모지·해시태그 걷고 문장 끝에서 자른다, 해시태그뿐인 제목은 낱말로', () => {
    assert.equal(firstSentence('🎁 신상 나왔어요! #신상 #아동복', 90), '신상 나왔어요!');
    const long = '첫 문장은 충분히 길게 써서 스무 자를 넘깁니다. 두 번째 문장은 잘려야 합니다 잘려야 합니다 잘려야 합니다';
    assert.equal(firstSentence(long, 40), '첫 문장은 충분히 길게 써서 스무 자를 넘깁니다.');
    assert.equal(headOf({ title: '#댓글이벤트 #댓글에하트❤️💜', snippet: '' }), '댓글이벤트 · 댓글에하트');
});
test('글 형식 태그와 혜택(캡션 낱말 + media_type)', () => {
    assert.deepEqual(postTags(P('x', 'a', '', 0, 0, '#댓글이벤트', '댓글 남겨주시면 추첨해 선물드려요')), ['댓글이벤트']);
    assert.deepEqual(benefitsOf(P('x', 'a', '', 0, 0, '#EVENT', '5분께 선물드릴게요')), ['선물']);
    assert.ok(postTags(P('x', 'a', '2026-10-21T00:00:00Z', 0, 0, '10/28 오전 10시 오픈', '신상 턱받이')).includes('오픈공지'));
    assert.ok(postTags(P('x', 'a', '', 0, 0, '겨울 룩', '', 'VIDEO')).includes('릴스'));
    assert.deepEqual(postTags(P('x', 'a', '', 0, 0, '오늘의 하늘', '')), ['일반']);
    assert.deepEqual(benefitsOf(P('x', 'a', '', 0, 0, '가을 SALE', '전 상품 30% 할인 · 무료배송')), ['30% 할인', '무료배송']);
    assert.match(whyLine(P('x', 'a', '', 0, 0, '#댓글이벤트', '댓글 달면 선물')), /댓글을 달아야 참여되는 이벤트 \+ 혜택 '선물'/);
});
test(`배수는 평소가 ${RATIO_MIN_USUAL} 이상일 때만 — 좋아요 숨긴 작은 계정의 '175배' 헛배수를 막는다`, () => {
    const st = brandStats([...base('a', 50), ...base('c', 2), P('big', 'c', '2026-10-21T00:00:00Z', 350, 0)]);
    assert.equal(st.ratioOf(P('z', 'a', '', 500, 0)), 10);
    assert.equal(st.ratioOf(P('big', 'c', '', 350, 0)), null);
});

const POSTS = [
    ...base('a', 50), ...base('b', 100), ...base('c', 2),
    P('ev', 'a', '2026-10-21T11:00:00Z', 1156, 1269, '#댓글이벤트 #댓글에하트', '댓글 남겨주세요. 선물드려요'),     // 어제 저녁, 평소(중앙값) 50 → 2425/50 = 48.5 → 49배
    P('open', 'a', '2026-10-21T11:37:00Z', 52, 1, '10월 28일(수) 오전 10시', '테리 턱받이가 오픈됩니다!'),
    P('bb', 'b', '2026-10-21T12:00:00Z', 150, 10, '겨울 신상', ''),                                           // 1.6배 — 튄 글 아님
    P('cc', 'c', '2026-10-21T13:00:00Z', 300, 0, '작은계정 글', ''),                                           // 평소 2 → 배수 안 씀
];
test('1면: 지난 24시간에서 평소 대비 가장 튄 글, 3줄 본문', () => {
    const L = leadStory(POSTS, COMPS, { now: NOW });
    assert.equal(L.kind, 'spike'); assert.equal(L.range, '지난 24시간'); assert.equal(L.post.id, 'ev');
    assert.equal(L.headline, "코코하니, '댓글이벤트' 글에 반응 평소 49배");
    assert.equal(L.lines.length, 3);
    assert.match(L.lines[1], /♥ 1,156 · 댓글 1,269 \(평소 49배\) · 평소 글 하나 50/);
    assert.match(L.lines[2], /형식: 댓글이벤트 · 혜택: 선물 · 올린 때: 수 오후 8시/);
});
test('1면: 튄 글이 없으면 가장 가까운 오픈 예고, 24시간이 비면 3일로 넓히고 그렇게 적는다', () => {
    const noSpike = POSTS.filter(p => p.id !== 'ev');
    assert.equal(leadStory(noSpike, COMPS, { now: NOW }).headline, '코코하니, 10/28(수) 오전 10시 오픈 예고');
    const old = [...base('a', 50), P('o', 'a', '2026-10-20T03:00:00Z', 60, 0, '겨울 신상', '')];
    assert.equal(leadStory(old, COMPS, { now: NOW }).range, '지난 3일');
    assert.equal(leadStory(base('a', 50), COMPS, { now: NOW }), null);
});
test('2면 달력: 오늘부터 7일 줄, 빈 날도 남긴다', () => {
    const cal = openCalendar(POSTS, COMPS, { now: NOW });
    assert.equal(cal.length, 7);
    assert.equal(cal[0].label, '10/22 (목)'); assert.ok(cal[0].today);
    const d28 = cal.find(d => d.date === '2026-10-28');
    assert.equal(d28.items.length, 1);
    assert.deepEqual([d28.items[0].when, d28.items[0].name, d28.items[0].kind], ['오전 10시', '코코하니', '오픈']);
    assert.equal(cal.filter(d => !d.items.length).length, 6);
});
test('오픈 시간대: 30% 넘는 시각·요일만 "주로"', () => {
    const ps = ['10/23 오전 10시 오픈', '10/24 오전 10시 오픈', '10/27 오후 8시 드롭', '10/29 오전 10시 오픈']
        .map((t, i) => P(`o${i}`, `x${i}`, '2026-10-21T00:00:00Z', 0, 0, t, ''));
    const pt = openPattern(ps);
    assert.deepEqual([pt.count, pt.hour, pt.hourShare], [4, '오전 10시', '3/4']);
    const mixed = ['10/23 오전 9시 오픈', '10/24 오전 10시 오픈', '10/25 오전 11시 오픈', '10/26 오후 1시 오픈']
        .map((t, i) => P(`m${i}`, `y${i}`, '2026-10-21T00:00:00Z', 0, 0, t, ''));
    assert.equal(openPattern(mixed).hour, null);
});
test('4면 TOP5: 평소 대비 배수 순 — 큰 계정·헛배수 계정이 늘 이기지 않는다', () => {
    const w = topWorked(POSTS, COMPS, { now: NOW });
    assert.equal(w[0].post.id, 'ev');
    assert.ok(!w.some(x => x.post.id === 'cc'), '반응 300이어도 평소를 모르는 작은 계정 글은 배수 있는 글에 밀린다');
    const all = topWorked(POSTS, COMPS, { now: NOW, top: 99 });
    assert.ok(all.findIndex(x => x.post.id === 'bb') < all.findIndex(x => x.post.id === 'cc'), '배수 있는 글이 먼저');
    assert.match(w[0].why, /댓글을 달아야/);
    assert.equal(w[0].slot, '수 오후 8시');
});
test('3면 동향: 어제 0시부터 글 올린 브랜드만, 오픈 예고가 있으면 맨 앞', () => {
    const mv = brandMoves(POSTS, COMPS, [], { now: NOW });
    assert.deepEqual(mv.map(m => m.name).sort(), ['베베소유', '작은계정', '코코하니']);   // 5일 전 글만 있는 브랜드는 없음
    const k = mv.find(m => m.name === '코코하니');
    assert.equal(mv[0].name, '코코하니');
    assert.match(k.text, /^10\/28 오전 10시 오픈 예고\. '댓글이벤트 · 댓글에하트' 글 ♥ 1,156 · 댓글 1,269 \(평소 49배\)\. 글 2개 올림\./);
    assert.match(k.text, /형식: .*댓글이벤트/);
    const snaps = [{ competitor_id: 'b', snap_date: '2026-10-22', followers: 1200 }, { competitor_id: 'b', snap_date: '2026-10-20', followers: 1000 }];
    assert.match(brandMoves(POSTS, COMPS, snaps, { now: NOW }).find(m => m.name === '베베소유').text, /팔로워 \+200\(2일\)/);
});
test('이번주 한 줄 요약', () => {
    const cal = openCalendar(POSTS, COMPS, { now: NOW });
    const s = weekSummary(cal, topWorked(POSTS, COMPS, { now: NOW }));
    assert.equal(s, '이번주: 오픈 1건 · 반응 좋은 형식 = 댓글이벤트');
});
test('반려1 회귀: 요약의 요일·시각은 이번 7일 달력에서만 — 최근 2주 패턴(수요일)과 섞지 않는다', () => {
    //  지난 2주 공지는 수요일 오픈이 많고(지난 날짜), 이번 7일 달력은 목요일 오픈이 많다
    const past = ['10/14 오후 2시 오픈', '10/15 오전 11시 오픈', '10/7 오후 2시 오픈', '9/30 오후 2시 오픈', '10/14 오후 8시 드롭']
        .map((t, i) => P(`w${i}`, `w${i}`, '2026-10-01T00:00:00Z', 0, 0, t, ''));
    const week = ['10/22 오전 10시 오픈', '10/24 오전 11시 오픈', '10/22 오후 2시 오픈', '10/23 오전 10시 오픈', '10/28 오후 8시 오픈']
        .map((t, i) => P(`n${i}`, `n${i}`, '2026-10-21T00:00:00Z', 0, 0, t, ''));
    const posts = [...past, ...week];
    assert.equal(openPattern(past).dow, '수요일');                // 최근 2주 기준이면 수요일
    const cal = openCalendar(posts, COMPS, { now: NOW });
    const s = weekSummary(cal, []);
    assert.ok(!s.includes('수요일'), s);
    assert.equal(s, `이번주: 오픈 ${cal.reduce((n, d) => n + d.items.length, 0)}건(목요일 2건 · 오전 10시 2건이 가장 많음)`);
});
test('조간 = 카드뉴스(main.js 연결): 카드 덱·좌우 넘김·인과 단정 문구 없음', () => {
    const src = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    assert.match(src, /lead: leadStory\(igPosts, comps\)/);
    assert.match(src, /const deck = cardDeck\(E, \{/);
    for (const t of ['pc-track', 'pcGo(dir)', "e.key === 'ArrowRight'", 'pc-dots', '다 봤습니다 — 업무 시작']) assert.ok(src.includes(t), t);
    assert.ok(!src.includes('>왜 먹혔나'), '인과 단정 문구 금지');
});
