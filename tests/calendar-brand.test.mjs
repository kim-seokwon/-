//  캘린더 전체 / 브랜드별 보기 (10-23 사장님) — 한 건마다 브랜드가 맞게 붙는지, 칩이 맞게 거르는지
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeBrandResolver, calBrandMatch, calBrandValid, CAL_BRAND_ALL, CAL_BRAND_NONE } from '../calBrand.js';

const src = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const method = (name) => {
    const re = new RegExp(`\\n    (async )?${name}\\(`);
    const m = re.exec(src); assert.ok(m, `${name} 를 main.js 에서 못 찾음`);
    const a = m.index + 1, b = src.indexOf('\n    }\n', a) + 6;
    return eval('(' + src.slice(a, b).trim().replace(new RegExp(`^(async )?${name}\\(`), (_, as) => `${as || ''}function ${name}(`) + ')');
};

const seasons = [{ id: 's1', name: '26SS 셔츠', brand_id: 'b1', due_date: '2026-10-20', todos: [{ text: '스와치', due_date: '2026-10-08' }] },
    { id: 's2', name: '26SS 데님', brand_id: 'b2' }, { id: 's3', name: '브랜드 없는 시즌' }];
const items = [{ id: 'i1', product_id: 's1', tech_pack_id: 'tp1' }, { id: 'i2', product_id: 's3', brand_id: 'b2' }, { id: 'i3', product_id: 's3' }];
const techPacks = [{ id: 'tp1' }, { id: 'tp2', brand_id: 'b1' }, { id: 'tp3', item_id: 'i2' }];
const notes = [{ id: 'n1', product_id: 's2' }, { id: 'n2', item_id: 'i1' }, { id: 'n3', meta: { proj: 's1' } }, { id: 'n4' }];
const br = makeBrandResolver({ seasons, items, techPacks, notes, noteSeason: n => n.meta?.proj || null });

test('고리 따라 브랜드를 찾는다 — 시즌 ← 제품 ← 지시서 · 메모 · 할 일 · 생산', () => {
    assert.equal(br.season('s1'), 'b1');
    assert.equal(br.item('i1'), 'b1', '제품은 시즌 브랜드를 따른다');
    assert.equal(br.item('i2'), 'b2', '제품 자체 브랜드가 먼저');
    assert.equal(br.item('i3'), null);
    assert.equal(br.techPack('tp1'), 'b1', '제품 줄이 물고 있는 지시서');
    assert.equal(br.techPack('tp2'), 'b1', '업로드 지시서 자체 brand_id');
    assert.equal(br.techPack('tp3'), 'b2', '지시서 item_id');
    assert.equal(br.note(notes[0]), 'b2'); assert.equal(br.note(notes[1]), 'b1'); assert.equal(br.note(notes[2]), 'b1', '메타 proj');
    assert.equal(br.note(notes[3]), null);
    assert.equal(br.reminder({ source_kind: 'season', source_id: 's2' }), 'b2');
    assert.equal(br.reminder({ item_id: 'i1' }), 'b1');
    assert.equal(br.reminder({ source_kind: 'note', source_id: 'n2' }), 'b1');
    assert.equal(br.reminder({ title: '세무사 서류' }), null, '연결 없으면 공통');
    assert.equal(br.job({ item_id: 'i2' }), 'b2'); assert.equal(br.job({ tech_pack_id: 'tp1' }), 'b1'); assert.equal(br.job({}), null);
    assert.equal(br.lineTodo({ src: 'vendor', noteId: 'n1' }), null, '거래처 메모는 공통');
    assert.equal(br.lineTodo({ src: 'item', srcId: 'i2' }), 'b2');
    assert.equal(br.lineTodo({ src: 'note', noteId: 'n1' }), 'b2');
    assert.equal(br.lineTodo({ src: 'season', seasonId: 's1' }), 'b1');
});

test('칩 거르기 — 전체는 다, 공통은 브랜드 없는 것만, 브랜드는 그것만', () => {
    const xs = [{ brand_id: 'b1' }, { brand_id: 'b2' }, { brand_id: null }, {}];
    assert.equal(xs.filter(x => calBrandMatch(x, CAL_BRAND_ALL)).length, 4);
    assert.equal(xs.filter(x => calBrandMatch(x, CAL_BRAND_NONE)).length, 2);
    assert.deepEqual(xs.filter(x => calBrandMatch(x, 'b1')), [{ brand_id: 'b1' }]);
    assert.equal(calBrandValid('b9', [{ id: 'b1' }]), CAL_BRAND_ALL, '없어진 브랜드는 전체로');
    assert.equal(calBrandValid('b1', [{ id: 'b1' }]), 'b1');
    assert.equal(calBrandValid(CAL_BRAND_NONE, []), CAL_BRAND_NONE);
});

test('_allDated 가 모든 줄에 brand_id 를 단다(루틴은 공통)', () => {
    globalThis.mockData = { products: seasons, brands: [{ id: 'b1' }, { id: 'b2' }] };
    globalThis.makeBrandResolver = makeBrandResolver;
    const t = {
        pItems: items, _techPacks: techPacks, noteList: [{ id: 'n1', product_id: 's2', title: '데님 촬영', meta: { due: '2026-10-11' } }],
        remList: [{ id: 'r1', title: '데님 샘플', due_date: '2026-10-12', source_kind: 'season', source_id: 's2' }, { id: 'r2', title: '서류', due_date: '2026-10-12' }],
        vendors: [{ id: 'v1', name: '봉제', jobs: [{ id: 'j1', title: '메인 생산', due_date: '2026-10-18', item_id: 'i1' }] }],
        _calCursor: '2026-10-15',
        _noteMeta: n => n.meta || {}, _noteTodos: () => [], _allNoteTodos: () => [{ id: 'l1', src: 'vendor', title: '정산', due: '2026-10-13' }],
        _dateLocal: s => new Date(s + 'T00:00:00'), _dateKey: d => d.toISOString().slice(0, 10),
        _expandedRoutines: () => [{ date: '2026-10-10', title: '오전 주문 확인', kind: 'routine' }],
    };
    const out = method('_allDated').call(t);
    const by = Object.fromEntries(out.map(x => [x.title, x.brand_id ?? null]));
    assert.deepEqual(by, { '데님 샘플': 'b2', '서류': null, '스와치': 'b1', '26SS 셔츠': 'b1', '데님 촬영': 'b2', '정산': null, '메인 생산': 'b1', '오전 주문 확인': null });
    assert.equal(out.filter(x => calBrandMatch(x, 'b1')).length, 3);
    assert.equal(out.filter(x => calBrandMatch(x, CAL_BRAND_NONE)).length, 3);
});

test('캘린더 화면이 칩을 그리고, 고른 것을 기억하고, 같은 목록으로 월·주·일·하루 목록을 그린다', () => {
    const rc = src.slice(src.indexOf('\n    renderCalendar('), src.indexOf('\n    }\n', src.indexOf('\n    renderCalendar(')));
    assert.match(rc, /calBrandMatch\(x, bsel\)/);
    assert.match(rc, /cal-bchip/);
    assert.match(rc, /app\.setCalBrand\('\$\{/);
    const cb = method('_calBrand');
    const store = { 'cal.brand': 'b2' };
    globalThis.localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
    globalThis.calBrandValid = calBrandValid; globalThis.CAL_BRAND_ALL = CAL_BRAND_ALL;
    globalThis.mockData = { brands: [{ id: 'b1' }, { id: 'b2' }] };
    assert.equal(cb.call({}), 'b2');
    globalThis.localStorage = { getItem() { throw new Error('막힘'); } };
    assert.equal(cb.call({}), CAL_BRAND_ALL, 'localStorage 가 막혀도 전체로 뜬다');
    //  홈 통합 캘린더는 거르지 않는다
    const home = src.slice(src.indexOf('\n    renderHome('), src.indexOf('\n    }\n', src.indexOf('\n    renderHome(')));
    assert.doesNotMatch(home, /calBrandMatch/);
});

test('반려1-1: 캘린더에 들어오면 제품·작업지시서·메모를 부르고, 오기 전/후 브랜드가 맞게 바뀐다', () => {
    //  ensureViewData — 캘린더 진입 때 부르는 로더
    const calls = [];
    const t = new Proxy({ currentView: 'calendar' }, {
        get: (o, k) => (k in o ? o[k] : (/^(load|ensure)/.test(String(k)) ? (() => calls.push(String(k))) : undefined)),
    });
    method('ensureViewData').call(t);
    for (const f of ['loadItems', 'ensureTechPacks', 'loadNotes']) assert.ok(calls.includes(f), `${f} 를 부른다`);
    const loaded = new Proxy({ currentView: 'calendar', _itemsLoaded: true, _techPacksLoaded: true, _noteLoaded: true }, {
        get: (o, k) => (k in o ? o[k] : (/^(load|ensure)/.test(String(k)) ? (() => calls.push('again:' + String(k))) : (/Loaded$/.test(String(k)) ? true : undefined))),
    });
    calls.length = 0; method('ensureViewData').call(loaded);
    assert.deepEqual(calls.filter(c => /Items|TechPacks|Notes/.test(c)), [], '이미 있으면 다시 안 부른다');

    //  같은 _allDated — 제품·지시서가 없을 땐 공통, 오고 나면 제 브랜드
    globalThis.mockData = { products: [{ id: 's1', name: '셔츠', brand_id: 'b1' }], brands: [{ id: 'b1' }] };
    globalThis.makeBrandResolver = makeBrandResolver;
    const st = {
        pItems: [], _techPacks: [], noteList: [], remList: [{ id: 'r1', title: '치수 확인', due_date: '2026-10-12', source_kind: 'item', source_id: 'i1' }],
        vendors: [{ id: 'v1', name: '봉제', jobs: [{ id: 'j1', title: '메인 생산', due_date: '2026-10-18', tech_pack_id: 'tp1' }] }],
        _calCursor: '2026-10-15', _noteMeta: () => ({}), _noteTodos: () => [], _allNoteTodos: () => [],
        _dateLocal: s => new Date(s + 'T00:00:00'), _dateKey: d => d.toISOString().slice(0, 10), _expandedRoutines: () => [],
    };
    const brandOf = () => Object.fromEntries(method('_allDated').call(st).filter(x => x.kind !== 'proj').map(x => [x.title, x.brand_id ?? null]));
    assert.deepEqual(brandOf(), { '치수 확인': null, '메인 생산': null }, '오기 전엔 공통');
    st.pItems = [{ id: 'i1', product_id: 's1', tech_pack_id: 'tp1' }];
    st._techPacks = [{ id: 'tp1', source: 'upload' }];
    assert.deepEqual(brandOf(), { '치수 확인': 'b1', '메인 생산': 'b1' }, '온 뒤 다시 그리면 제 브랜드');
    //  덜 왔을 때는 칩 줄에 '분류 중' 표시
    assert.match(src, /linking \? '<span class="cal-bload">브랜드 분류 중…<\/span>'/);
    assert.match(src, /if \(\(this\._techPacksLoaded \|\| this\._techPacksLoading\) && !force\) return;/, '지시서 중복 호출 막기');
});
