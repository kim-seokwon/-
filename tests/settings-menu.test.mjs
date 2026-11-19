// 재설계 ① — 생산·설정 왼쪽 중분류. 설정 창 하나로 계정·브랜드·연동·불편사항을 모으고, 생산에 생산처를 둔다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const style = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const between = (a, b, from = 0) => { const i = main.indexOf(a, from); return main.slice(i, main.indexOf(b, i + a.length)); };

test('설정 묶음: 왼쪽 메뉴 칸이 재설계 §2 순서대로 있다', () => {
    const g = between("{ head: 'settings'", '] },');
    const keys = [...g.matchAll(/k: '(\w+)'/g)].map(m => m[1]);
    assert.deepEqual(keys, ['set_org', 'brand_management', 'user_management', 'integrations', 'set_adrules',
        'set_menu', 'set_alerts', 'feedback', 'settings', 'set_account']);
    for (const k of ['set_org', 'brand_management', 'user_management', 'set_menu', 'feedback'])
        assert.match(g, new RegExp(`k: '${k}', t: '[^']+', need: 'MASTER'`), k);
});

test('설정 칸 권한: 마스터 전용은 직원·파트너에게 안 보이고, 파트너는 내 칸만', () => {
    const fn = between('    _setTabOk(k) {', '\n    }');
    assert.match(fn, /t\.need === 'ANY'\) return true/);
    assert.match(fn, /role !== 'MASTER' && role !== 'STAFF'\) return false/);
    assert.match(main, /if \(set\.has\('settings'\)\) set\.add\('set_account'\)/);
    assert.match(main, /이 계정으로는 볼 수 없는 칸입니다/);
});

//  11-19 P4(팀장 3단점검): 11-18 '창 안 설정 목록 금지'를 바꿔, 왼쪽에 설정 중분류(_midNav, 전역 사이드바와 같은 원본) + 가운데 그 칸.
test('설정 창 왼쪽은 전역 사이드바와 같은 설정 중분류(_midNav)만 — "설정 메뉴" 제목·따로 만든 목록 없음', () => {
    const bar = between('    _appTabBar(', '    // SNS 3단');
    assert.doesNotMatch(bar, /설정 메뉴/);
    assert.match(bar, /g\.head === 'settings'\) return `<aside class="appside appside-filter settings-work-nav">\$\{this\._midNav\(view\)\}/);
    assert.match(main, /settings3 \? ' settings3' : ''/);
    assert.match(style, /\.settings3 \.appside \.m3-h\{font-size:12px/);
});

test('런처: 지출은 재무로 이관하고 설정 상세는 찾기로 연다', () => {
    const launch = between('    LAUNCH = [', '    // ====');
    for (const id of ['integrations', 'user_management', 'brand_management', 'feedback'])
        assert.doesNotMatch(launch, new RegExp(`\\['${id}',`), id);
    assert.match(launch, /\['expenses', '지출 관리'/);
    assert.doesNotMatch(launch, /\['(?:sample_maker|makers)',/);
    assert.match(main, /sec\.g === '설정' && k\) items = \[\.\.\.items, \.\.\.this\._setLaunchItems\(\)\]/);
});

test('생산처 = 연락처 같은 행 중 기타가 아닌 분류(복사본 아님)', () => {
    assert.match(main, /\{ k: 'makers', t: '생산처', hidden: true \}/);
    assert.match(main, /const makers = this\.currentView === 'makers';\s*let base = makers \? all\.filter\(v => \(v\.category \|\| '기타'\) !== '기타'\) : all;/);
    assert.match(main, /this\.currentView === 'contacts' \|\| this\.currentView === 'makers'\) return this\.renderContacts\(\)/);
    //  개편 2단계 B: 생산처 중분류는 없어지고 옛 makers 링크는 거래처(생산처 분류)로 넘긴다 — 같은 원본
    assert.match(main, /if \(viewId === 'makers'\) \{ this\.contactCat = this\._makerLinkCat\(\); viewId = 'contacts'; \}/);
    assert.match(main, /if \(view === 'makers'\) \{ this\.contactCat = this\._makerLinkCat\(\); view = 'contacts'; \}/);
});

test('새 설정 칸은 읽기만 한다 — DB 쓰기 호출이 없다', () => {
    const block = between('    renderSetOrg() {', '\n    // ── 묶음 앱');
    assert.doesNotMatch(block, /\.(insert|update|upsert|delete)\(/);
    assert.doesNotMatch(block, /TELEGRAM|bot_token|secret/i);
});
