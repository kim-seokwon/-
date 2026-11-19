//  F 11-19 사장님 '이건 왜이래' — 광고 관리 표가 왼쪽 60%만 차고 칸 글자가 옆 칸에 겹침
//  원인: ①넓은 화면에서 타겟·일예산·작업 열은 display:none 인데 '종료 N개'·빈 줄이 colspan=12 → 빈 열 3개가 오른쪽 폭을 먹음
//        ②숨은 열 때문에 th:nth-child 위치 폭이 다른 열에 붙음(세트명 90px 고정)
//  헤드리스 실측(1920·1440·1160·1024 겹침 0·머리글 아이콘 겹침 0): .work/개발자/광고표-F/m.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const wide = (() => { const i = css.indexOf('@media (min-width:901px){\n  .sns3-layout:not(.no-side)'); assert.ok(i >= 0); return css.slice(i, css.indexOf('\n}\n', i)); })();

test('광고 표 colspan = 넓은 화면에 보이는 열 수(머리글 12칸 - 숨김 3칸)', () => {
    const cols = (main.match(/this\._thead\('sns_ads', \[([\s\S]*?)\]\);/)[1].match(/\['\w+'/g) || []).length + 1;   // + 작업
    assert.equal(cols, 12);
    assert.match(main, /const SNS_ADS_VISIBLE_COLS = 9;/);
    const sec = main.slice(main.indexOf("if (mode === 'active_ads') return"), main.indexOf("if (mode === 'active_ads') return") + 4000);
    assert.doesNotMatch(sec, /colspan="12"/);
    assert.equal((sec.match(/colspan="\$\{SNS_ADS_VISIBLE_COLS\}"/g) || []).length, 2);
    for (const h of ['sns-th-target', 'sns-th-budget', 'sns-td-actions']) assert.ok(css.includes(`.sns3-tablepane .${h}`), h);
});

test('넓은 화면 열 폭은 클래스로만 — 위치(nth-child) 폭 금지, 세트명은 auto', () => {
    assert.doesNotMatch(wide, /sns3-table th:nth-child/);
    assert.match(wide, /th\.sns-th-name\{width:auto\}/);
    assert.match(wide, /th\{padding-right:32px!important\}/, '머리글 깔때기 자리');
    assert.match(wide, /td\.sns-td-brand\{width:0;padding:0!important/, '좁으면 열을 빼지 않고 폭 0 으로 접는다(colspan 유지)');
    assert.match(wide, /container:adtbl\/inline-size/);
    assert.doesNotMatch(wide, /@container adtbl[^{]*\{[^}]*display:none[^}]*sns-td-brand/);
});

test('왼쪽 브랜드 목록은 이름+점 색만 — 중단 배지·개수·일예산 줄 없음, 숫자는 표 위 요약줄', () => {
    const nav = main.slice(main.indexOf('<div class="m3-h">브랜드</div>${sideRows.map'), main.indexOf('</aside>`;', main.indexOf('<div class="m3-h">브랜드</div>${sideRows.map')));
    assert.match(nav, /<span><b>\$\{esc\(r\.label\)\}<\/b><\/span><\/button>/);
    assert.doesNotMatch(nav, /<small|em class="bad"|중단|\/일/);
    assert.match(main, /<span class="sns3-sum">\$\{esc\(headSum\)\}<\/span>/);
    assert.match(main, /\$\{r\.stop \? ` · 중단 \$\{r\.stop\}` : ''\}/);
});
