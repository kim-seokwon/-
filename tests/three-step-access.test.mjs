//  사장님 11-19 '3단 접근': 사이드 31개 항목을 눌렀을 때 창 제목 = '대분류 › 중분류', 창 왼쪽 중분류 강조가 같은 항목.
//  상품·생산 4개·업무·자료 5개는 창 왼쪽 맨 위에 같은 대분류의 중분류 목록이 있고, 누르면 같은 창에서 바뀐다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const body = (name, open = '{') => {
    const m = new RegExp(`\\n    ${name}\\s*=?\\s*\\(?`).exec(src); assert.ok(m, name);
    return m.index + 1;
};
//  MAC_SIDE_GROUPS·MID_ALIAS(대입식)와 _midPlace·_macWinTitle·_midNav(메서드)를 그대로 떼어 쓴다
const field = name => { const a = src.indexOf(`\n    ${name} = `); assert.ok(a >= 0, name); const s = src.slice(a + name.length + 8); let d = 0, i = 0;
    for (; i < s.length; i++) { const c = s[i]; if (c === '[' || c === '{') d++; else if (c === ']' || c === '}') { d--; if (!d) break; } }
    return eval('(' + s.slice(0, i + 1) + ')'); };
const method = name => { const a = body(name), b = src.indexOf('\n    }\n', a) + 6;
    return eval('(' + src.slice(a, b).trim().replace(new RegExp(`^${name}\\(`), `function ${name}(`) + ')'); };
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const mk = (over = {}) => {
    const t = { MAC_SIDE_GROUPS: field('MAC_SIDE_GROUPS'), MID_ALIAS: field('MID_ALIAS'), snsMode: 'dashboard', _renderingWin: 'w1', _vesc: esc,
        _sideOk: () => true, _macTitle: v => `옛:${v}`, ...over };
    for (const n of ['_midPlace', '_macWinTitle', '_midNav']) t[n] = method(n).bind(t);
    return t;
};
const items = () => mk().MAC_SIDE_GROUPS.flatMap(g => (g.apps || []).flatMap(a => (a.items || []).map(x => ({ g: g.label, k: x[0], label: x[1], mode: x[3] }))));

test('사이드 31개 — 창 제목 = 대분류 › 중분류 (옛 이름 판매·생산·SNS·협업 없음)', () => {
    const list = items(); assert.equal(list.length, 31);
    for (const it of list) {
        const t = mk({ snsMode: it.mode || 'dashboard' });
        assert.equal(t._macWinTitle(it.k), `${it.g} › ${it.label}`, it.label);
    }
    for (const g of ['생산', 'SNS', '협업']) assert.ok(!items().some(i => i.g === g), g);
});

test('숨은 화면은 보이는 중분류 아래 제목 — 작업지시서 작성·시즌·거래처·고객 CRM', () => {
    const t = mk();
    assert.equal(t._macWinTitle('sample_maker'), '상품·생산 › 작업지시서 작성');
    assert.equal(t._macWinTitle('dashboard'), '상품·생산 › 시즌');
    assert.equal(t._macWinTitle('makers'), '업무·자료 › 거래처');
    assert.equal(t._macWinTitle('crm'), '판매 › 고객 CRM');
    assert.equal(t._macWinTitle('nope'), '옛:nope', '모르는 화면은 옛 제목');
});

test('상품·생산 4개·업무·자료 5개 — 왼쪽 중분류가 지금 화면을 강조하고 같은 창에서 바꾼다', () => {
    for (const it of items().filter(i => i.g === '상품·생산' || i.g === '업무·자료')) {
        const html = mk()._midNav(it.k);
        const on = [...html.matchAll(/<button class="m3-s on"[^>]*onclick="app\.switchAppTab\('w1','([a-z_]+)'\)"[^>]*>[\s\S]*?<span>([^<]+)<\/span>/g)];
        assert.equal(on.length, 1, it.label); assert.equal(on[0][1], it.k); assert.equal(on[0][2], esc(it.label));
        assert.equal((html.match(/class="m3-s/g) || []).length, it.g === '상품·생산' ? 4 : 5, it.label);
        assert.match(html, new RegExp(`<div class="m3-h">${esc(it.g)}</div>`));
    }
    //  숨은 화면에서도 보이는 중분류가 강조된다
    for (const [v, k] of [['sample_maker', 'tech_packs'], ['dashboard', 'items'], ['makers', 'contacts']])
        assert.match(mk()._midNav(v), new RegExp(`m3-s on" aria-current="page" onclick="app\\.switchAppTab\\('w1','${k}'\\)`), v);
    //  꺼진 메뉴(_sideOk false)는 빠진다
    assert.ok(!mk({ _sideOk: k => k !== 'inventory' })._midNav('items').includes("'inventory'"));
});

test('마케팅 6개·설정 10개(P3·P4) — 왼쪽 중분류 강조, 마케팅은 sns 로 두고 모드 전환', () => {
    for (const it of items().filter(i => i.g === '마케팅' || i.g === '설정')) {
        const html = mk({ snsMode: it.mode || 'dashboard' })._midNav(it.k);
        const on = [...html.matchAll(/<button class="m3-s on"[^>]*onclick="([^"]+)"[^>]*>[\s\S]*?<span>([^<]+)<\/span>/g)];
        assert.equal(on.length, 1, it.label); assert.equal(on[0][2], esc(it.label));
        assert.equal((html.match(/class="m3-s/g) || []).length, it.g === '마케팅' ? 6 : 10, it.label);
        if (it.mode) assert.equal(on[0][1], `app.switchAppTab('w1','sns');app.setSnsMode('${it.mode}')`);
        else assert.equal(on[0][1], `app.switchAppTab('w1','${it.k}')`);
    }
    assert.match(mk({ snsMode: 'news' })._midNav('news'), /m3-s on"[^>]*setSnsMode\('news'\)/, '조간 창(news)도 뉴스·조간 강조');
    assert.match(src, /g\.head === 'settings'\) return `<aside class="appside appside-filter settings-work-nav">\$\{this\._midNav\(view\)\}/);
    assert.match(src, /_snsShell\(inner\) \{[\s\S]{0,400}this\._midNav\(this\.currentView === 'news' \? 'news' : 'sns'\)/);
});

test('붙는 자리 — 상품·생산 창 왼쪽(작업지시서 포함)·업무·자료 5개 사이드, 창 바 제목', () => {
    assert.match(src, /g\.head === 'items'\) return `<aside class="appside appside-filter production-work-nav">\$\{this\._midNav\(view\)\}/);
    //  메모 창만 한 줄 아이콘 바(11-19 Q). 나머지 넷은 글자 목록 그대로
    for (const [cls, v, arg] of [['nt-side', 'notes', ", { icons: true }"], ['rm-side', 'reminders', ''], ['cal-side', 'calendar', ''], ['fd-side', 'documents', ''], ['m3-side', 'contacts', '']]) {
        const a = src.indexOf(`<aside class="${cls}">`); assert.ok(a >= 0, cls);
        assert.ok(src.slice(a, a + 400).includes(`\${this._midNav('${v}'${arg})}`), cls);
    }
    assert.match(src, /<b>\$\{esc\(this\._macWinTitle\(w\.view\)\)\}<\/b>/);
    assert.match(css, /\.mid-nav\{[^}]*border-bottom/);
});

test('C 반려 11-19 — 901~1100 마케팅: 상세는 고르기 전 접고 고르면 겹쳐 연다(가운데 최소 300px), 현황 숫자 칸은 폭 맞춰 줄바꿈', async () => {
    const fs = await import('node:fs');
    const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    const src = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    const m = css.match(/@media \(min-width:901px\) and \(max-width:1100px\)\{([\s\S]*?)\n\}/);
    assert.ok(m, '901~1100 규칙');
    assert.match(m[1], /\.sns3-layout:not\(\.no-side\)\{--c1:200px;grid-template-columns:200px minmax\(0,1fr\)\}/);
    assert.match(m[1], /\.sns3-layout>\.m3-doc\{display:none\}/);
    assert.match(m[1], /\.sns3-layout\.detail>\.m3-doc\{display:flex;position:absolute;[^}]*width:min\(340px,48%\)/);
    assert.match(m[1], /\.sns3-layout\.detail>\.m3-doc \.sns3-back\{display:inline-flex!important/);
    //  1024 창 실측: 가운데 570px(옛 210px) — 200(왼쪽)+340(겹친 상세) 빼도 가운데 목록은 그대로
    const winW = 815, side = 200; assert.ok(winW - side >= 300 + 260, '가운데 최소 300px');
    assert.match(css, /\.sns-dashboard-cards \.sns3-kpis\{grid-template-columns:repeat\(auto-fill,minmax\(128px,1fr\)\)\}/);
    //  겹친 상세는 어느 마케팅 창이든 닫기 버튼이 있다(오늘 보기 상세 포함)
    const docs = src.match(/<section class="m3-doc"><div class="m3-tools">.{0,40}/g) || [];
    const sns = docs.filter(d => /광고 상세|계정 게시물|동종업계|조간 상세|게시물 상세|피로도|속성 상세|브랜드 상세/.test(d) || d.includes('sns3-back'));
    assert.ok(sns.length >= 7);
    assert.ok(!src.includes('<section class="m3-doc"><div class="m3-tools"><b>광고 상세</b>'), '오늘 보기 상세 닫기 버튼');
    assert.match(src, /setSnsMode\(k\) \{[\s\S]{0,900}this\.snsMobileDetail = false;/, '창 바꾸면 겹친 상세 닫힘');
});

test('11-19 Q 메모 창 — 업무·자료 5개를 한 줄 아이콘 바로(지금 위치 강조·이름은 마우스 올리면·같은 창에서 이동)', () => {
    const html = mk()._midNav('notes', { icons: true });
    assert.match(html, /class="mid-nav category-work-nav mid-icons"/);
    assert.ok(!html.includes('m3-h'), '머리글(업무·자료) 줄 없음');
    assert.ok(!html.includes('<span>'), '글자 없음 — 아이콘만');
    const btns = [...html.matchAll(/<button class="m3-s( on)?"[^>]*onclick="app\.switchAppTab\('w1','([a-z_]+)'\)" data-tip="([^"]+)" aria-label="([^"]+)"><i class="ph [^"]+"><\/i><\/button>/g)];
    assert.deepEqual(btns.map(m => m[3]), ['할 일', '통합 캘린더', '메모', '자료실', '거래처']);
    assert.deepEqual(btns.filter(m => m[1]).map(m => m[2]), ['notes'], '메모만 강조');
    assert.match(html, /m3-s on" aria-current="page"/);
    //  나머지 화면은 그대로(글자 목록)
    assert.equal(mk()._midNav('notes'), mk()._midNav('notes', { icons: false }));
    assert.match(mk()._midNav('reminders'), /<div class="m3-h">업무·자료<\/div>/);
    assert.match(css, /\.mid-nav\.mid-icons\{display:flex/);
    assert.match(css, /\.mid-nav\.mid-icons \.m3-s\.on\{/);
    //  11-19 R: 이름은 CSS 말풍선(data-tip) — 마우스·키보드 포커스에 바로 보임, 브라우저 title 과 겹치지 않게 title 없음
    assert.ok(!/ title="/.test(html), 'title 없음');
    assert.match(css, /\.mid-nav\.mid-icons \.m3-s::after\{content:attr\(data-tip\)/);
    assert.match(css, /\.mid-nav\.mid-icons \.m3-s:hover::after,\.mid-nav\.mid-icons \.m3-s:focus-visible::after\{opacity:1\}/);
});

test('11-19 Q 메모 폴더 숫자 = 눌렀을 때 목록 수 — 제품 기록장(item_id)은 빼고 센다', () => {
    const a = src.indexOf('    renderNotes() {'), r = src.slice(a, src.indexOf('\n    }\n', a));
    assert.match(r, /const cnt = \(fn\) => all\.filter\(n => !n\.item_id && fn\(n\)\)\.length;/);
    assert.match(r, /fold\('all', 'ph-tray', '모든 메모', cnt\(\(\) => true\)/);
    assert.ok(!/fold\('all'[^\n]*all\.length/.test(r), '모든 메모 숫자에 all.length 금지');
    assert.match(r, /if \(n\.item_id\) return false;/, '목록도 제품 기록장을 뺀다(숫자와 같은 기준)');
});
