import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const style = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

test('홈 중분류는 선택한 내용과 활성 항목을 함께 바꾼다', () => {
    assert.match(main, /const homeMode = \['todos', 'sales', 'orders', 'alerts', 'paper'\]/);
    assert.match(main, /data-home-mode="\$\{homeMode\}"/);
    for (const mode of ['todos', 'sales', 'orders', 'alerts', 'paper']) {
        assert.ok(main.includes(`data-pane="${mode}"`), mode);
    }
    assert.match(main, /view === 'home'[\s\S]*?this\.homeMode = mode/);
    assert.match(main, /view === 'home'\) return desktopHome[\s\S]*?this\.homeMode \|\| 'todos'/);
});

test('홈은 펼친 사이드바 뒤에서 시작하고 12px 미만 글씨를 보정한다', () => {
    assert.match(style, /\.mac-deskboard\{position:absolute;left:var\(--mac-side-w\)/);
    assert.match(style, /\.home-view \[style\*="font-size:0\.58rem"\][\s\S]*?font-size:12px!important/);
    assert.match(style, /\.desk-find kbd\{font-family:inherit;font-size:12px/);
});
