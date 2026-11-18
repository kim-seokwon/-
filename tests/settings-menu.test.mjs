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

test('설정 창 안에는 설정 메뉴 목록을 다시 그리지 않는다(전역 사이드바 몫, 사장님 11-18)', () => {
    const bar = between('    _appTabBar(', '    // SNS 3단');
    assert.doesNotMatch(bar, /설정 메뉴|g\.head === 'settings'/);
    assert.match(main, /settings3 \? ' settings3' : ''/);
    assert.match(style, /\.settings3 \.appside \.m3-h\{font-size:12px/);
});

test('런처: 연동·계정·브랜드·불편사항·지출은 빠지고, 찾기로는 여전히 걸린다', () => {
    const launch = between('    LAUNCH = [', '    // ====');
    for (const id of ['integrations', 'user_management', 'brand_management', 'feedback', 'expenses'])
        assert.doesNotMatch(launch, new RegExp(`\\['${id}',`), id);
    assert.match(launch, /\['makers', '생산처'/);
    assert.match(main, /sec\.g === '설정' && k\) items = \[\.\.\.items, \.\.\.this\._setLaunchItems\(\)\]/);
});

test('생산처 = 연락처 같은 행 중 기타가 아닌 분류(복사본 아님)', () => {
    assert.match(main, /\{ k: 'quotes', t: '견적' \}, \{ k: 'makers', t: '생산처' \}/);
    assert.match(main, /const makers = this\.currentView === 'makers';\s*let base = makers \? all\.filter\(v => \(v\.category \|\| '기타'\) !== '기타'\) : all;/);
    assert.match(main, /this\.currentView === 'contacts' \|\| this\.currentView === 'makers'\) return this\.renderContacts\(\)/);
});

test('새 설정 칸은 읽기만 한다 — DB 쓰기 호출이 없다', () => {
    const block = between('    renderSetOrg() {', '\n    // ── 묶음 앱');
    assert.doesNotMatch(block, /\.(insert|update|upsert|delete)\(/);
    assert.doesNotMatch(block, /TELEGRAM|bot_token|secret/i);
});
