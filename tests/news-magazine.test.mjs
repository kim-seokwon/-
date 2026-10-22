import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { magazine, sourceKo, whenWord, reactBits, kNum, MAG } from '../newsMagazine.js';

const NOW = Date.parse('2026-10-22T00:30:00Z');   // 10-22(목) 09:30 KST
const SRC = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const P = (id, cid, at, likes, comments, title = '', thumb = `t/${id}`) => ({ id, competitor_id: cid, kind: 'competitor_post', source: 'instagram',
    title, snippet: '', published_at: at, url: `https://instagram.com/p/${id}`, thumb, meta: { likes, comments } });
const COMPS = [{ id: 'a', name: '코코하니', handle: 'cocohoney' }, { id: 'b', name: '베베소유', handle: 'bebe' }, { id: 'c', name: '조용한곳', handle: 'quiet' }];
const base = (cid, eng, k = 4) => Array.from({ length: k }, (_, i) => P(`${cid}${i}`, cid, '2026-10-17T03:00:00Z', eng, 0, `평소 글 ${i}`));
const C = {
    competitor: [...base('a', 50), ...base('b', 100),
        P('ev', 'a', '2026-10-21T11:00:00Z', 1156, 1269, '#댓글이벤트 #댓글에하트'),
        P('open', 'a', '2026-10-21T11:37:00Z', 52, 1, '10월 28일(수) 오전 10시 오픈'),
        P('bb', 'b', '2026-10-21T12:00:00Z', 150, 10, '겨울 신상')],
    review: [{ id: 'r1', kind: 'review', source: 'naver_blog', title: '하이헤이호 후기', snippet: '좋아요', url: 'https://blog/1', published_at: '2026-10-20T01:00:00Z', author: '#태그' },
             { id: 'r2', kind: 'review', source: 'naver_cafe', title: '옛 후기', snippet: '', url: 'https://cafe/1', published_at: '2026-09-01T01:00:00Z' }],
    trend: [{ id: 't1', kind: 'news', source: 'naver_news', title: '아동복 시장 커진다 올해 매출 늘어', url: 'https://n/1', published_at: '2026-10-20T00:00:00Z' },
            { id: 't2', kind: 'news', source: 'google_news', title: '아동복 시장 커진다 올해 매출 늘어', url: 'https://n/2', published_at: '2026-10-20T02:00:00Z' }],
    resale: [{ id: 's1', kind: 'resale', source: 'bunjang', title: '하이헤이호 상하세트', url: 'https://m.bunjang.co.kr/products/1', published_at: '2026-10-19T00:00:00Z', thumb: 'b/1', meta: { price: 5900 } }],
};

test('출처는 한글 이름 — 번개장터·당근·중고나라, 모르는 건 "기타", 빈 건 빈칸', () => {
    assert.equal(sourceKo('bunjang'), '번개장터');
    assert.equal(sourceKo('daangn'), '당근');
    assert.equal(sourceKo('joonggonara'), '중고나라');
    assert.equal(sourceKo('naver_blog'), '네이버 블로그');
    assert.equal(sourceKo('xyz_raw'), '기타');
    assert.equal(sourceKo(''), '');
});
test('날짜·숫자 말투 — 빈 날짜는 — 대신 빈칸, 좋아요 0(숨김)은 ♥ 안 찍음', () => {
    assert.equal(whenWord('2026-10-21T23:30:00Z', NOW), '오늘');      // 10-22 08:30 KST
    assert.equal(whenWord('2026-10-21T11:00:00Z', NOW), '어제');
    assert.equal(whenWord('2026-10-19T00:00:00Z', NOW), '3일 전');
    assert.equal(whenWord('2026-10-01T00:00:00Z', NOW), '10/1');
    assert.equal(whenWord(null, NOW), '');
    assert.deepEqual(reactBits(0, 12), ['댓글 12']);
    assert.deepEqual(reactBits(1156, 1269), ['♥ 1,156', '댓글 1,269']);
    assert.equal(kNum(116875), '12만');
    assert.equal(kNum(null), '');
});
test('오늘 요약 띠: 고객 반응(14일) · 경쟁사 새 글(어제 0시부터) · 오픈 예정(7일) · 중고(14일)', () => {
    const M = magazine(C, COMPS, [], { now: NOW });
    assert.deepEqual(M.summary.map(s => [s.key, s.value]), [['customer', 1], ['brands', 3], ['opens', 1], ['resale', 1]]);
});
test('섹션 재료: 반응 좋은 글은 평소 대비 순 + 배수 배지, 기사는 같은 보도자료 하나로, 중고는 가격·한글 출처', () => {
    const M = magazine(C, COMPS, [], { now: NOW });
    assert.equal(M.top[0].id, 'ev');
    assert.equal(M.top[0].brand, '코코하니');
    assert.match(M.top[0].hot, /^평소 \d+(\.\d)?배$/);
    assert.equal(M.top[0].head, '댓글이벤트 · 댓글에하트');
    assert.equal(M.trend.length, 1, '같은 제목 기사 두 건 → 한 건');
    assert.equal(M.resale[0].price, 5900);
    assert.equal(M.resale[0].source, '번개장터');
    assert.equal(M.customer.find(x => x.id === 'r1').author, '', '#태그 작성자는 숨김');
    assert.equal(M.opens[0].name, '코코하니');
});
test('브랜드 카드: 지금 움직이는 곳 먼저, 최근 썸네일 3장, 기록 없는 변화는 null(화면에서 숨김)', () => {
    const M = magazine(C, COMPS, [], { now: NOW });
    assert.deepEqual(M.brands.map(b => b.name), ['코코하니', '베베소유', '조용한곳']);
    assert.equal(M.brands[0].recent.length, MAG.RECENT_THUMBS);
    assert.equal(M.brands[0].newCount, 2);
    assert.equal(M.brands[0].delta, null);
    assert.equal(M.brands[2].recent.length, 0);
    const snaps = [{ competitor_id: 'b', snap_date: '2026-10-22', followers: 1200 }, { competitor_id: 'b', snap_date: '2026-10-20', followers: 1000 }];
    assert.equal(magazine(C, COMPS, snaps, { now: NOW }).brands.find(b => b.id === 'b').delta, 200);
});
test('찾기는 모든 섹션에 걸린다, 다 비면 empty', () => {
    const M = magazine(C, COMPS, [], { now: NOW, q: '베베' });
    assert.deepEqual(M.brands.map(b => b.name), ['베베소유']);
    assert.ok(M.top.every(x => x.brand === '베베소유'));
    assert.equal(M.customer.length, 0);
    assert.ok(magazine(C, COMPS, [], { now: NOW, q: '없는낱말zz' }).empty);
    assert.ok(magazine({}, [], [], { now: NOW }).empty);
});

//  main.js 의 메서드를 떼어 가짜 this 에 붙여 돌린다(DOM 없이)
function method(name) {
    const at = SRC.indexOf(`    ${name}(`) >= 0 ? SRC.indexOf(`    ${name}(`) : SRC.indexOf(`    async ${name}(`);
    assert.ok(at >= 0, name);
    const end = SRC.indexOf('\n    }\n', at);
    return SRC.slice(at, end + 7);
}
function fakeStore() { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), m }; }

test('첫 접속 조간: 하루 한 번만 자동으로 뜨고, 실패해도 첫 화면을 막지 않는다', async () => {
    const K = new Function('localStorage', `return class { ${method('_maybeMorning')} }`);
    const store = fakeStore();
    const Cls = K(store);
    const mk = (open) => Object.assign(new Cls(), { paper: null, opened: 0, renders: 0,
        _paperKey: () => 'bhas_paper_u1', _ymdSeoul: () => '2026-10-22', requestRender() { this.renders++; },
        async openPaper(auto) { this.opened++; assert.equal(auto, true); return open(this); } });
    const a = mk(() => {});
    await a._maybeMorning();
    assert.equal(a.opened, 1);
    await a._maybeMorning();                          // 같은 날 두 번째
    assert.equal(a.opened, 1, '같은 날은 다시 안 뜸');
    const b = mk(() => {}); await b._maybeMorning();   // 새로고침(새 앱) — 저장된 날짜가 막는다
    assert.equal(b.opened, 0);
    store.m.clear();
    const c = mk(self => { self.paper = {}; throw new Error('네트워크'); });
    await c._maybeMorning();
    assert.equal(c.paper, null, '실패하면 조간을 접는다');
    const broken = K({ getItem() { throw new Error('막힘'); }, setItem() {} });
    const d = Object.assign(new broken(), { paper: null, _paperKey: () => 'k', _ymdSeoul: () => 'd', async openPaper() { throw new Error('불리면 안 됨'); } });
    await d._maybeMorning();                         // 저장소를 못 쓰면 아예 안 띄운다(매번 뜨지 않게)
});
test('첫 접속 조간 연결: 로그인 뒤 두 경로 모두 _maybeMorning, 자동판이 비거나 실패하면 접음', () => {
    assert.ok((SRC.match(/this\._maybeMorning\(\)/g) || []).length >= 2);
    assert.match(SRC, /if \(auto && \(this\.paper\.err \|\| !this\._paperHasNews\(this\.paper\.data\)\)\)/);
});
test('뉴스탭 화면: 매거진 구조(요약 띠·섹션·브랜드 서랍), 옛 3단 목록 없음, 원문 링크', () => {
    const r = method('renderNews');
    for (const t of ['nm-strip', "sec('opens'", "sec('top'", "sec('brands'", "sec('customer'", "sec('trend'", "sec('resale'", 'nm-drawer', 'app.openPaper()', 'target="_blank" rel="noopener"'])
        assert.ok(r.includes(t), t);
    assert.ok(!r.includes('m3-list') && !r.includes('selectNews'), '옛 3단·고르기 없음');
    assert.ok(!/['"`]—['"`]/.test(r.replace(/dfmt[^\n]*\n[^\n]*/, '')), '빈 값을 — 로 찍지 않음(서랍의 변화칸 제외)');
    assert.match(method('_compBrandHTML'), /<a class="cb-li" href="\$\{esc\(p\.url/, '브랜드 한 장 글 줄도 원문 링크');
});
test('사진은 자르지 않는다: _photo = contain + 같은 사진 흐린 바탕, 실패하면 칸 제거, 따옴표 깨짐 없음', () => {
    const Cls = new Function(`return class { _vesc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')} ${method('_photo')} }`)();
    const o = new Cls();
    const h = o._photo('https://x/a.jpg?b=1&c="2")', 'nm-ph');
    assert.match(h, /^<div class="ph-fit nm-ph" style="--ph:url\(&quot;https:\/\/x\/a\.jpg\?b=1&amp;c=%222%22%29&quot;\)">/);
    assert.match(h, /onerror="this\.parentNode\.remove\(\)"/);
    assert.equal(o._photo(null), '');
    assert.match(CSS, /\.ph-fit>img\{[^}]*object-fit:contain/);
    assert.match(CSS, /\.ph-fit::before\{[^}]*var\(--ph\)[^}]*blur/);
    //  뉴스탭·카드뉴스의 사진 규칙에 cover 가 남아 있으면 안 된다
    for (const sel of ['.nw-th', '.pp-fig img', '.pc-img img', '.pc-th', '.pp-cut img', '.pp-used img']) {
        const rule = CSS.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{[^}]*\\}'));
        assert.ok(rule && !/object-fit:cover/.test(rule[0]), sel);
    }
    const paper = method('_paperHTML');
    assert.ok(paper.includes("this._photo(c.img, 'pc-img')") && paper.includes("this._photo(r.img, 'pc-th')"), '카드뉴스도 같은 사진 칸');
});
test('반려1 회귀: 브랜드 서랍은 스크롤되는 .nm 바깥·창 안 기준(absolute) — fixed 면 메뉴막대에 도구막대가 가려진다', () => {
    const r = method('renderNews');
    assert.match(r, /return `<div class="nm-wrap"><div class="nm">/);
    assert.match(r, /<\/div>\$\{drawer\}<\/div>`;/, '서랍은 .nm 이 닫힌 뒤에');
    const rule = sel => (CSS.match(new RegExp('\\n' + sel.replace(/[.>]/g, '\\$&') + '\\{[^}]*\\}')) || [''])[0];
    assert.match(rule('.nm-wrap'), /position:relative/);
    assert.match(rule('.nm-drawer'), /position:absolute;top:0/);
    assert.match(rule('.nm-drawer'), /overflow-y:auto/);
    assert.match(rule('.nm-dim'), /position:absolute/);
    assert.match(rule('.nm-drawer>.m3-tools'), /position:sticky;top:0/, '도구막대는 서랍을 내려도 위에 붙어 있다');
    //  화면 안 버튼 상자 검사(헤드리스): .work/뉴스탭/drawer-check.mjs
});
