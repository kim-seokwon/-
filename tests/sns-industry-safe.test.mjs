//  P0-01(11-18 사장님 요청서): SNS > 동종업계 진입 시 'reading published_at' 반복 오류.
//  원인 = 게시물 0건 경쟁사 계정의 stamp(a.posts[0]) — posts[0] 이 undefined.
//  게시물·게시일이 없어도 화면이 멈추지 않고, 로딩·자료없음·수집실패(+다시 시도)를 섞지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const between = (a, b) => { const i = main.indexOf(a); assert.ok(i >= 0, a); return main.slice(i, main.indexOf(b, i + a.length)); };
const render = between('    renderSnsNews() {', '\n    }\n');
const load = between('    async loadNews() {', '\n    }\n');

test('게시물 없는 계정도 stamp 가 멈추지 않는다', () => {
    const m = render.match(/const stamp = (x => \(x \? whenWord\(x\.published_at \|\| x\.created_at\) : ''\) \|\| '');/);
    assert.ok(m, 'stamp 가 undefined 를 받는다');
    const whenWord = v => (v ? 'W' : '');
    const stamp = eval(m[1]);
    assert.equal(stamp(undefined), '');
    assert.equal(stamp({}), '');
    assert.equal(stamp({ created_at: '2026-11-18' }), 'W');
    assert.match(render, /stamp\(a\.posts\[0\]\) \|\| '게시물 없음'/);
});

test('로딩 · 수집 실패(+다시 시도) · 자료 없음을 다르게 보인다', () => {
    assert.match(render, /if \(!this\._newsLoaded\) return[^\n]*불러오는 중/);
    assert.match(render, /if \(this\._newsError\) return[^\n]*불러오지 못했습니다[^\n]*app\.retryNews\(\)/);
    assert.match(render, /표시할 계정이 없습니다/);
    assert.match(main, /retryNews\(\) \{ if \(this\._newsLoading\) return;/);
    assert.match(css, /\.sns-news-retry\{/);
});

test('supabase {error} 응답도 실패로 본다(0계정으로 둔갑 금지), 성공하면 실패 표시를 지운다', () => {
    assert.match(load, /const bad = \[items, comps\]\.find\(r => !r \|\| r\.error\);\s*if \(bad\) throw/);
    assert.match(load, /this\._newsError = null;\s*this\._newsLoaded = true;/);
    assert.match(load, /catch \(e\) \{[^}]*this\._newsError = String/);
    assert.ok(!load.includes('039_news.sql'), '실패 원인을 마이그레이션으로 단정하지 않는다');
});
