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

test('붙는 자리 — 상품·생산 창 왼쪽(작업지시서 포함)·업무·자료 5개 사이드, 창 바 제목', () => {
    assert.match(src, /g\.head === 'items'\) return `<aside class="appside appside-filter production-work-nav">\$\{this\._midNav\(view\)\}/);
    for (const [cls, v] of [['nt-side', 'notes'], ['rm-side', 'reminders'], ['cal-side', 'calendar'], ['fd-side', 'documents'], ['m3-side', 'contacts']]) {
        const a = src.indexOf(`<aside class="${cls}">`); assert.ok(a >= 0, cls);
        assert.ok(src.slice(a, a + 400).includes(`\${this._midNav('${v}')}`), cls);
    }
    assert.match(src, /<b>\$\{esc\(this\._macWinTitle\(w\.view\)\)\}<\/b>/);
    assert.match(css, /\.mid-nav\{[^}]*border-bottom/);
});
