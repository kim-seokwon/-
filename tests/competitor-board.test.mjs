import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    topPosts, followerChange, rankCompetitors, snapStart, reactionStats, extractOpening,
    upcomingOpenings, searchName, brandIssues, nameOfPost,
} from '../competitorBoard.js';
import { titleKey, mergeSameTitle, datedOnly, competitionList } from '../supabase/functions/_shared/news-rules.js';

const NOW = Date.parse('2026-10-22T03:00:00Z');   // 10-22 12:00 KST
const post = (id, at, likes, comments, extra = {}) => ({ id, kind: 'competitor_post', source: 'instagram',
    published_at: at, meta: { likes, comments, name: 'X' }, competitor_id: 'c1', ...extra });

// ── 2856 조간 경쟁사 인스타 ──
test('topPosts: 최근 7일만, 좋아요+댓글 큰 순, 상위 N', () => {
    const ps = [
        post('a', '2026-10-21T00:00:00Z', 10, 1),
        post('b', '2026-10-20T00:00:00Z', 300, 20),
        post('old', '2026-10-10T00:00:00Z', 9999, 0),       // 7일 밖
        post('c', '2026-10-19T00:00:00Z', 50, 50),
    ];
    assert.deepEqual(topPosts(ps, { now: NOW }).map(p => p.id), ['b', 'c', 'a']);
    assert.deepEqual(topPosts(ps, { now: NOW, top: 1 }).map(p => p.id), ['b']);
});
test('nameOfPost: competitors 표 이름 > meta.name > 작성자', () => {
    assert.equal(nameOfPost(post('a', '2026-10-21T00:00:00Z', 1, 1), [{ id: 'c1', name: '두두앤솜' }]), '두두앤솜');
    assert.equal(nameOfPost(post('a', '2026-10-21T00:00:00Z', 1, 1), []), 'X');
});

// ── 2857 옛 기사 거르기 ──
test('titleKey: 구글 검색 · 구글 뉴스 · 매체 앞붙임 표기를 같은 키로', () => {
    const k = titleKey('이랜드 키디키디, 현대百 판교점서 팝업스토어 오픈 - 싱글리스트');
    assert.equal(titleKey('이랜드 키디키디, 현대百 판교점서 팝업스토어 오픈 < 유통소비 < S이코노미 < 기사본문 - 싱글리스트'), k);
    assert.equal(titleKey('어패럴뉴스 - 키디키디, 두 번째 팝업스토어 오픈'), titleKey('키디키디, 두 번째 팝업스토어 오픈 - 어패럴뉴스'));
});
test('mergeSameTitle: 같은 기사면 날짜 있는 쪽, datedOnly: 날짜 없는 건 뺀다', () => {
    const list = [
        { id: 'g', source: 'google', title: '키디키디 첫 팝업 흥행 < 유통 < 기사본문 - 헤럴드', url: 'u1', published_at: null },
        { id: 'n', source: 'google_news', title: '키디키디 첫 팝업 흥행 - 헤럴드', url: 'u2', published_at: '2024-02-21T00:00:00Z' },
        { id: 'z', source: 'google', title: '키디키디 단독 기사', url: 'u3', published_at: null },
    ];
    assert.deepEqual(mergeSameTitle(list).map(x => x.id), ['n', 'z']);
    assert.deepEqual(datedOnly(list).map(x => x.id), ['n']);
});
test('경쟁·유통 칸은 날짜 없는 옛 기사를 싣지 않는다(main.js _newsColumns 연결)', () => {
    const src = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    assert.match(src, /compete: competitionList\(datedOnly\(tr\.data \|\| \[\]\)\)/);
    const undated = [{ id: 'g', title: '이랜드 키디키디 팝업', url: 'u', published_at: null, kind: 'trend' }];
    assert.equal(competitionList(datedOnly(undated)).length, 0);
});
test('구글 맞춤검색 후기는 페이지 메타태그 날짜를 published_at 으로 넣는다', () => {
    const src = readFileSync(new URL('../channel-bots/news/collect.mjs', import.meta.url), 'utf8');
    assert.match(src, /published_at: cseDate\(i\)/);
    const body = src.slice(src.indexOf('function cseDate'), src.indexOf('}\n', src.indexOf('function cseDate')) + 1);
    const cseDate = new Function(`${body}; return cseDate;`)();
    assert.equal(cseDate({ pagemap: { metatags: [{ 'article:published_time': '2024-02-21T09:00:00+09:00' }] } }), '2024-02-21T00:00:00.000Z');
    assert.equal(cseDate({}), null);
});

// ── 2858 순위판 ──
test('followerChange: 하루치면 변화 없음, 7일 안 가장 오래된 날과 견준다', () => {
    assert.equal(followerChange([{ snap_date: '2026-10-22', followers: 100 }]).delta, null);
    const r = followerChange([
        { snap_date: '2026-10-22', followers: 130 }, { snap_date: '2026-10-19', followers: 110 },
        { snap_date: '2026-10-15', followers: 100 }, { snap_date: '2026-10-10', followers: 1 },   // 12일 전은 안 쓴다
    ]);
    assert.deepEqual([r.delta, r.span, r.since], [30, 7, '2026-10-15']);
    const p = followerChange([{ snap_date: '2026-10-22', followers: 90 }, { snap_date: '2026-10-20', followers: 100 }]);
    assert.deepEqual([p.delta, p.span], [-10, 2]);
});
test('rankCompetitors: 변화 크기 순 → 변화 없으면 팔로워 순', () => {
    const comps = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }, { id: 'd', name: 'D' }];
    const snaps = [
        { competitor_id: 'a', snap_date: '2026-10-22', followers: 5000 },
        { competitor_id: 'b', snap_date: '2026-10-22', followers: 100 }, { competitor_id: 'b', snap_date: '2026-10-15', followers: 150 },
        { competitor_id: 'c', snap_date: '2026-10-22', followers: 200 }, { competitor_id: 'c', snap_date: '2026-10-15', followers: 190 },
    ];
    assert.deepEqual(rankCompetitors(comps, snaps).map(r => r.id), ['b', 'c', 'a', 'd']);
    assert.equal(snapStart(snaps), '2026-10-15');
});

// ── 2859 브랜드 한 장 ──
test('reactionStats: 평소(중앙값)의 2배 넘고 차이 10 이상이면 튄 글, 글 4개 미만이면 판단 안 함', () => {
    const ps = [post('1', 'x', 20, 0), post('2', 'x', 22, 0), post('3', 'x', 18, 0), post('4', 'x', 90, 5), post('5', 'x', 21, 0)];
    const st = reactionStats(ps);
    assert.equal(st.usual, 21);
    assert.deepEqual([...st.spikes.keys()], ['4']);
    assert.equal(reactionStats(ps.slice(0, 3)).usual, null);
    // 작은 계정의 3 → 7 은 튄 글 아님(차이 10 미만)
    assert.equal(reactionStats([post('a', 'x', 3, 0), post('b', 'x', 3, 0), post('c', 'x', 3, 0), post('d', 'x', 7, 0)]).spikes.size, 0);
});

const cap = (title, snippet, at) => ({ id: 'p', title, snippet, published_at: at });
test('extractOpening: 실제 공지 문구들', () => {
    const cases = [
        [cap('10월 28일(수) 오전 10시', '코코하니에서 처음으로 선보이는 테리 턱받이가 오픈됩니다!', '2026-10-21T11:37:00Z'), '10/28 10:00 오픈'],
        [cap('2026 Winter 1st Drop', '✓ 10/29 (thu) 12:00 pm Open • Fleece Work Jacket', '2026-10-20T07:49:00Z'), '10/29 12:00 드롭'],
        [cap('올해의 마지막 오가닉 빕 프리오더가 내일 오후 2시에 시작됩니다.', 'Organic Bib Pre-order 10/22(목) 2pm - 10/29(목) 2pm', '2026-10-21T15:46:00Z'), '10/22 14:00 프리오더'],
        [cap('오래도록 사랑받는', 'MISHA & PUFF 26WI DROP 1 오늘 밤 11시 오픈', '2026-10-22T00:00:13Z'), '10/22 23:00 드롭'],
        [cap('10.21 WED 10:00 AM', '**WINTER KIDIKIDI OPEN LIST**', '2026-10-20T15:55:00Z'), '10/21 10:00 오픈'],
        [cap('[REFURB OPEN]', '10.19 MON 11:00 AM 리퍼브 상품이 오픈됩니다.', '2026-10-14T23:50:00Z'), '10/19 11:00 오픈'],
        [cap('잠시 후 오후 4시 마지막 잔여수량이 오픈됩니다', '', '2026-10-21T06:16:00Z'), '10/21 16:00 오픈'],
    ];
    for (const [p, want] of cases) assert.equal(extractOpening(p)?.label, want, p.title);
});
test('extractOpening: 지난 일·마감·배송·가격은 일정으로 안 본다', () => {
    const no = [
        cap('NOTICE', '먼저 오늘 오픈에 함께해 주신 모든 분들께 감사드립니다. 오늘 주문 건은 순차적으로 출고', '2026-10-20T05:50:00Z'),
        cap('[Pre-order Notice]', '*프리오더 기간 :~10월 15일까지', '2026-10-09T01:37:00Z'),
        cap('OURCOLOR PRE-ORDER NOTICE', '1차 예약배송은 10월 23일(금)부터 순차 출고될 예정입니다.', '2026-10-16T08:59:00Z'),
        cap('26 WINTER OPEN', '1차 오픈 15% OFF 📅 10.19 - 10.25 단 7일간!', '2026-10-20T00:00:00Z'),   // 시작일 지남, 끝 날짜는 오픈 아님
        cap('겨울 신상', '10만 원 이상 구매 시 할인, 오픈 기념', '2026-10-20T00:00:00Z'),
        cap('그냥 일상', '10/30 날씨가 좋네요', '2026-10-20T00:00:00Z'),                          // 오픈 말이 없음
    ];
    for (const p of no) assert.equal(extractOpening(p), null, p.snippet);
});
test('upcomingOpenings: 오늘~7일 안만, 같은 브랜드·같은 날은 시각 있는 한 건', () => {
    const ps = [
        { id: '1', competitor_id: 'c1', title: '내일 오픈!', snippet: '', published_at: '2026-10-21T02:00:00Z', url: 'u1' },          // 10/22, 시각 없음
        { id: '2', competitor_id: 'c1', title: '10/22 오전 11시 오픈', snippet: '', published_at: '2026-10-20T02:00:00Z', url: 'u2' },
        { id: '3', competitor_id: 'c2', title: '11/20 오픈 예정', snippet: '', published_at: '2026-10-20T02:00:00Z', url: 'u3' },      // 7일 밖
        { id: '4', competitor_id: 'c2', title: '10.24 SAT 8PM DROP', snippet: '', published_at: '2026-10-21T02:00:00Z', url: 'u4' },
    ];
    const r = upcomingOpenings(ps, [{ id: 'c1', name: '가' }, { id: 'c2', name: '나' }], { now: NOW });
    assert.deepEqual(r.map(o => `${o.name} ${o.label}`), ['가 10/22 11:00 오픈', '나 10/24 20:00 드롭']);
});
test('brandIssues: 괄호 이름은 앞 이름으로, 띄어쓰기 무시, 경쟁사 글·우리 글 제외', () => {
    assert.equal(searchName('오유(OU)'), '오유');
    assert.equal(searchName('산'), '');
    assert.equal(searchName('Makes me better.'), 'Makes me better');
    const items = [
        { id: 1, kind: 'news', title: '무신사 키즈 새 매장', url: 'a', published_at: '2026-10-20' },
        { id: 2, kind: 'competitor_post', title: '무신사키즈 글', url: 'b' },
        { id: 3, kind: 'review', title: '다른 이야기', snippet: '무신사키즈에서 샀어요', url: 'c', published_at: '2026-10-21' },
        { id: 4, kind: 'news', title: '무신사 키즈 새 매장', url: 'a' },
    ];
    assert.deepEqual(brandIssues(items, '무신사키즈').map(x => x.id), [3, 1]);
});

// ── 반려1: 모바일(≤860px) 조간 4칸은 1열 ──
test('style.css: 860px 이하에서 .pp-cols.four 도 1열(4열 선택자가 모바일 규칙을 이기지 않게)', () => {
    const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    const at = css.indexOf('@media (max-width: 860px)');
    assert.ok(at > css.indexOf('.pp-cols.four{grid-template-columns:repeat(4,1fr)}'), '모바일 규칙이 4열 규칙보다 뒤에 있어야 한다');
    const block = css.slice(at, css.indexOf('\n}', at));
    assert.match(block, /\.pp-cols,\.pp-cols\.four,\.pp-cols\.two\{grid-template-columns:1fr\}/);
    assert.match(block, /\.pp-cols\.four \.pp-c\{border-left:0;border-top:1px solid #d6cfc0;padding:14px 0\}/);
});
