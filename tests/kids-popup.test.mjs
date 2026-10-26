//  백화점 키즈 팝업 소식(10-26) — news-rules isPopupNews · 화면 앞거름 · 094 수집어.
//  PGlite 부분은 PGLITE_PATH 가 있을 때만 돈다(tech-pack-upload.test.mjs 와 같은 방식).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { isPopupNews, isCompetition, isTrendItem, competitionList, POPUP_WORDS } from '../supabase/functions/_shared/news-rules.js';

const n = (title, snippet = '', extra = {}) => ({ title, snippet, url: 'u:' + title, source: 'google_news', ...extra });

test('지시서 예시: 더현대 키즈 팝업은 통과, 아이돌·뷰티·아동 낱말 없는 백화점 팝업은 탈락', () => {
    assert.equal(isPopupNews(n('더현대 서울 키즈 브랜드 팝업스토어 오픈')), true);
    assert.equal(isPopupNews(n('스트레이키즈 팝업스토어 현대백화점')), false);
    assert.equal(isPopupNews(n('신세계 뷰티 팝업')), false);
    assert.equal(isPopupNews(n('롯데백화점 본점, 캠핑 브랜드 팝업스토어 연다')), false);
});

test('실데이터에서 잡은 잡음: 매체명 키즈맘 · 무도 키즈 · 키즈카페 · 공연', () => {
    assert.equal(isPopupNews(n('현대백화점 판교점 디저트 팝업 오픈 - 키즈맘')), false, '매체명은 뗀다');
    assert.equal(isPopupNews(n('무도 키즈 모여라, 더현대 서울 무한도전 팝업')), false);
    assert.equal(isPopupNews(n('스타필드 키즈카페 옆 팝업스토어')), false);
    assert.equal(isPopupNews(n('롯데월드몰 어린이 뮤지컬 팝업')), false);
    assert.equal(isPopupNews(n('신세계 센텀시티, 아르케메종·캉골 키즈 팝업스토어 - 패션비즈')), true);
    assert.equal(isPopupNews(n('MLB키즈, 스타필드 수원 릴레이 팝업')), true);
    assert.equal(isPopupNews(n('키즈 팝업스토어 성수 오픈')), false, '백화점·유통 낱말 없음');
});

test('isTrendItem·competitionList: 팝업 기사가 경쟁 칸에 들고, isCompetition 은 그대로', () => {
    const pop = n('더현대 서울 키즈 브랜드 팝업스토어 오픈');
    assert.equal(isCompetition(pop), false, '경쟁사 규칙은 안 건드렸다');
    assert.equal(isTrendItem(pop), true);
    const list = competitionList([pop, n('신세계 뷰티 팝업'), n('스트레이키즈 팝업스토어 현대백화점')]);
    assert.deepEqual(list.map(x => x.title), ['더현대 서울 키즈 브랜드 팝업스토어 오픈']);
});

test('화면: 서버 앞거름(like)에 팝업 낱말 · 카드에 팝업 꼬리표', () => {
    assert.deepEqual(POPUP_WORDS, ['팝업']);
    const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    assert.match(main, /\[\.\.\.COMPETITORS, \.\.\.POPUP_WORDS\]\.map/);
    assert.match(main, /x\.popup \? '<span class="nm-src nm-pop">팝업<\/span>'/);
    const mag = readFileSync(new URL('../newsMagazine.js', import.meta.url), 'utf8');
    assert.match(mag, /popup: !isCompetition\(x\) && isPopupNews\(x\)/);
    assert.match(readFileSync(new URL('../style.css', import.meta.url), 'utf8'), /\.nm-pop\{/);
});

test('094 깔기 두 번 · 되돌리기(PGlite)', { skip: !process.env.PGLITE_PATH && 'PGLITE_PATH 없음 — 건너뜀' }, async () => {
    const { PGlite } = await import(pathToFileURL(process.env.PGLITE_PATH).href);
    const db = new PGlite();
    await db.exec(`create table news_sources (id uuid primary key default gen_random_uuid(), kind text not null, query text not null,
      cafes text[], bucket text not null default 'trend', active boolean not null default true, sort int not null default 0);
      insert into news_sources (kind, query, bucket, sort) values ('news','아동복 시장','trend',40), ('news','키즈 팝업스토어','trend',51);`);
    const up = readFileSync(new URL('../supabase/migrations/094_news_popup_sources.sql', import.meta.url), 'utf8').replace(/notify pgrst.*;/g, '');
    const down = readFileSync(new URL('../supabase/rollbacks/094_news_popup_sources.down.sql', import.meta.url), 'utf8').replace(/notify pgrst.*;/g, '');
    await db.exec(up); await db.exec(up);
    const r = await db.query(`select kind, query, count(*)::int c from news_sources group by 1,2 order by 1,2`);
    assert.deepEqual(r.rows.map(x => `${x.kind}:${x.query}:${x.c}`),
        ['blog:백화점 키즈 팝업:1', 'news:백화점 키즈 팝업:1', 'news:아동복 시장:1', 'news:아동복 팝업:1', 'news:키즈 팝업스토어:1']);
    const b = await db.query(`select block from news_sources where query = '아동복 팝업'`);
    assert.ok(b.rows[0].block.includes('스트레이키즈'));
    await db.exec(down);
    const left = await db.query(`select query from news_sources order by sort`);
    assert.deepEqual(left.rows.map(x => x.query), ['아동복 시장', '키즈 팝업스토어'], '094 가 넣은 세 줄만 빠지고 원래 있던 줄은 남는다');
});
