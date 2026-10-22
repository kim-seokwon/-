//  도움말 센터(공지·사용설명서·불편접수) + 숫자 옆 ? 툴팁 — 순수 함수 · 화면 HTML 이스케이프 · main.js 연결 · 092 정적 검사
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TIPS, MANUAL, searchManual } from '../helpDict.js';
import { tipHTML, placeTip, escHTML } from '../helpWidget.js';
import {
    helpTabs, unreadCount, sortNotices, validateFeedback, validateNotice, feedbackPath,
    helpPanelHTML, manualListHTML, helpFabHTML, helpFocusKey, FB_IMG_MAX,
} from '../helpCenter.js';

const MAIN = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const SQL = readFileSync(new URL('../supabase/migrations/092_help_center.sql', import.meta.url), 'utf8');
const DOWN = readFileSync(new URL('../supabase/rollbacks/092_help_center.down.sql', import.meta.url), 'utf8');

test('사전: TIPS 는 제목 + 3줄, MANUAL 이 가리키는 tips 키는 전부 있다', () => {
    for (const [k, t] of Object.entries(TIPS)) {
        assert.ok(t.title, k); assert.equal(t.lines.length, 3, k); assert.ok(t.basis, k);
    }
    for (const m of MANUAL) for (const k of m.tips) assert.ok(TIPS[k], `${m.id} → ${k}`);
});

test('main.js 의 tipHTML 키는 모두 사전에 있다(틀린 키 = 빈 ? 안 생김)', () => {
    const keys = [...MAIN.matchAll(/tipHTML\('([a-z_0-9]+)'/g)].map(m => m[1]);
    assert.ok(keys.length >= 8, '툴팁 붙인 곳 ' + keys.length);
    for (const k of keys) assert.ok(TIPS[k], k);
    for (const k of ['net_sales', 'refund_split', 'new_repeat', 'channel_basis', 'ship_ready', 'member_count', 'net_after_fee'])
        assert.ok(keys.includes(k), '붙여야 할 툴팁 ' + k);
    assert.ok(!/kpiCard\(`오늘 매출 \$\{tipHTML/.test(MAIN), "'오늘 매출' 에 이번 달 기준 net_sales 문구를 달지 않는다");
});

test('tipHTML: 없는 키는 빈 문자열, 있는 키는 aria 달린 버튼', () => {
    assert.equal(tipHTML('nope', TIPS), '');
    assert.equal(tipHTML('__proto__', TIPS), '');
    const h = tipHTML('net_sales', TIPS);
    assert.match(h, /^<button type="button" class="tip-q" data-tip="net_sales"/);
    assert.match(h, /aria-describedby="tip-pop"/);
    assert.match(h, /aria-label="매출\(실결제\) 설명"/);
});

test('placeTip: 화면 밖으로 안 나간다(390 오른쪽 끝 · 아래 모자라면 위로 · 좁은 화면 폭 줄임)', () => {
    const vp = { w: 390, h: 844 };
    const a = { left: 370, right: 386, top: 100, bottom: 116, width: 16, height: 16 };
    const p = placeTip(a, { w: 300, h: 120 }, vp);
    assert.ok(p.left >= 8 && p.left + p.width <= 390 - 8, JSON.stringify(p));
    assert.equal(p.below, true); assert.equal(p.top, 122);
    const low = placeTip({ ...a, top: 800, bottom: 816 }, { w: 300, h: 120 }, vp);
    assert.equal(low.below, false); assert.ok(low.top + 120 <= 800, JSON.stringify(low));
    const narrow = placeTip({ ...a, left: 10, right: 26 }, { w: 500, h: 50 }, { w: 320, h: 600 });
    assert.equal(narrow.width, 304); assert.equal(narrow.left, 8);
    const huge = placeTip(a, { w: 200, h: 2000 }, vp);
    assert.equal(huge.top, 8);
});

test('역할별 탭: 직원·관리자 3탭, 고객사 사용설명서만', () => {
    assert.deepEqual(helpTabs('MASTER'), ['notice', 'manual', 'feedback']);
    assert.deepEqual(helpTabs('STAFF'), ['notice', 'manual', 'feedback']);
    assert.deepEqual(helpTabs('CLIENT'), ['manual']);
    assert.deepEqual(helpTabs(undefined), ['manual']);
    const h = helpPanelHTML({ role: 'CLIENT', tab: 'feedback', manual: MANUAL, tips: TIPS });
    assert.ok(!h.includes('hc-tabs'), '고객사는 탭 줄 없음');
    assert.ok(h.includes('data-tab="manual"') && !h.includes('hc-fb-body'), '고객사가 불편접수 탭을 강제로 못 연다');
});

test('안 읽은 공지 · 정렬', () => {
    const ns = [{ id: 'a', published: true, created_at: '2026-10-20' }, { id: 'b', published: true, created_at: '2026-10-21' },
                { id: 'c', published: false, created_at: '2026-10-22' }, { id: 'd', pinned: true, created_at: '2026-10-01' }];
    assert.equal(unreadCount(ns, ['a']), 2);    // b, d (숨김 c 는 안 셈)
    assert.equal(unreadCount(ns, ['a', 'b', 'd']), 0);
    assert.equal(unreadCount(null, null), 0);
    assert.deepEqual(sortNotices(ns).map(n => n.id), ['d', 'c', 'b', 'a']);
});

test('불편접수·공지 입력 검사', () => {
    assert.equal(validateFeedback('  ', null), '내용을 적어주세요.');
    assert.match(validateFeedback('x'.repeat(2001), null), /2,000자/);
    assert.equal(validateFeedback('x'.repeat(2000), null), null);
    assert.equal(validateFeedback('ok', { type: 'image/png', size: FB_IMG_MAX }), null);
    assert.match(validateFeedback('ok', { type: 'image/png', size: FB_IMG_MAX + 1 }), /5MB/);
    assert.match(validateFeedback('ok', { type: 'image/svg+xml', size: 10 }), /PNG/);
    assert.match(validateFeedback('ok', { type: 'application/pdf', size: 10 }), /PNG/);
    assert.equal(validateNotice('', ''), '제목을 적어주세요.');
    assert.match(validateNotice('x'.repeat(101), ''), /100자/);
    assert.match(validateNotice('t', 'x'.repeat(5001)), /5,000자/);
    assert.equal(validateNotice('t', 'b'), null);
});

test('첨부 경로: 내 이름/uuid.확장자 — 확장자는 종류에서, 경로 꺾기 못 함', () => {
    const u = '0b2c7c1e-1111-4222-8333-444455556666';
    assert.equal(feedbackPath('kim', 'image/jpeg', u), `kim/${u}.jpg`);
    assert.equal(feedbackPath('kim', 'image/webp', u), `kim/${u}.webp`);
    assert.equal(feedbackPath('kim', 'image/svg+xml', u), null);
    assert.equal(feedbackPath('', 'image/png', u), null);
    assert.equal(feedbackPath('a/b', 'image/png', u), null);
    assert.equal(feedbackPath('..', 'image/png', u), null);
    assert.equal(feedbackPath('kim', 'image/png', '../../x'), null);
    assert.equal(feedbackPath('kim', 'image/png', '../ab/cd'), 'kim/abcd.png');
    assert.equal(feedbackPath('kim', 'image/png', '///'), null);
});

test('패널 HTML: 사람이 쓴 글은 전부 이스케이프', () => {
    const X = '<img src=x onerror=alert(1)>"\'';
    const st = {
        role: 'MASTER', tab: 'notice', unread: 1, readIds: [], tips: TIPS, manual: MANUAL,
        notices: [{ id: X, title: X, body: X, pinned: true, published: false, created_at: '2026-10-22T01:00:00Z' }],
        feedback: [{ id: X, username: X, screen: X, body: X, image_path: 'kim/a.png', status: '처리중', admin_note: X, created_at: '2026-10-22T01:00:00Z' }],
        error: X, screen: X,
    };
    for (const tab of ['notice', 'feedback', 'manual']) {
        const h = helpPanelHTML({ ...st, tab, q: X });
        assert.ok(!h.includes('<img'), tab + ' 태그 새어 나감');
        assert.ok(!/onerror=alert\(1\)>"/.test(h), tab);
    }
    const staff = helpPanelHTML({ ...st, role: 'STAFF', tab: 'feedback' });
    assert.ok(!staff.includes('data-hc="fb-st"'), '직원은 상태 버튼 없음');
    assert.ok(staff.includes('답: &lt;img'), '직원은 관리자 답을 본다(이스케이프)');
    const boss = helpPanelHTML({ ...st, tab: 'feedback' });
    assert.equal((boss.match(/data-hc="fb-st"/g) || []).length, 3);
    assert.ok(boss.includes('aria-pressed="true"'));
    const nStaff = helpPanelHTML({ ...st, role: 'STAFF', tab: 'notice' });
    assert.ok(!nStaff.includes('n-new') && !nStaff.includes('n-edit'), '직원은 공지 쓰기·고치기 없음');
    assert.equal(escHTML(`<&>"'`), '&lt;&amp;&gt;&quot;&#39;');
});

test('사용설명서 찾기: 낱말 + TIPS 원문까지, 목록만 다시 그리기', () => {
    assert.deepEqual(searchManual('송장').map(m => m.id), ['orders']);
    assert.ok(searchManual('수수료').some(m => m.id === 'orders'), 'TIPS(net_after_fee) 문구로도 찾음');
    assert.equal(searchManual('').length, MANUAL.length);
    const list = manualListHTML({ q: 'zzz없음', manual: [], tips: TIPS });
    assert.match(list, /맞는 설명이 없습니다/);
    assert.ok(!list.includes('hc-q'), '목록만(찾기 칸은 안 다시 그림)');
    const full = manualListHTML({ q: '', manual: MANUAL, tips: TIPS });
    assert.equal((full.match(/class="hc-card"/g) || []).length, MANUAL.length);
});

test('? 도움말 버튼: 안 읽은 공지 점', () => {
    assert.ok(!helpFabHTML(0).includes('hc-dot'));
    assert.match(helpFabHTML(2), /hc-dot/);
    assert.match(helpFabHTML(2), /안 읽은 공지 2건/);
});

test('main.js 연결: 옛 불편 버튼 → 도움말, 조간 Esc 닫힘, 패널은 앱 칸 밖', () => {
    assert.ok(!/class="feedback-fab"/.test(MAIN), '옛 불편사항 버튼은 내림');
    assert.match(MAIN, /\$\{helpFabHTML\(this\._help \? this\._help\.unread : 0\)\}/);
    assert.match(MAIN, /mac-ver[^\n]*\n\s*\$\{helpFabHTML\(/, '맥 화면(기본) 메뉴바에 ? 가 있다 — 옛 불편 버튼은 맥 화면에 없었다');
    assert.match(MAIN, /if \(e\.key === 'Escape'\) \{ e\.preventDefault\(\); this\.closePaper\(\); \}/);
    assert.match(MAIN, /this\._paintPaper\(\);\s*this\._helpBoot\(\);/);
    assert.match(MAIN, /el\.id = 'help-slot'; document\.body\.appendChild\(el\)/);
    assert.match(MAIN, /createSignedUrl\(f\.image_path, 600\)/);
    assert.ok(!/storage\.from\('feedback'\)\.getPublicUrl/.test(MAIN), '첨부는 공개 주소 금지');
    assert.match(MAIN, /from\('feedback_reports'\)\.update\(\{ status, updated_at/);
    assert.match(CSS, /\.help-fab \{/); assert.match(CSS, /\.tip-pop \{/);
});

test('포커스 자리: id 우선, 없으면 data-hc + 구분값, 따옴표는 이스케이프', () => {
    const el = (attrs, id = '') => ({ id, getAttribute: k => (k in attrs ? attrs[k] : null) });
    assert.equal(helpFocusKey(el({}, 'hc-fb-body')), '[id="hc-fb-body"]');
    assert.equal(helpFocusKey(el({ 'data-hc': 'tab', 'data-tab': 'manual' })), '[data-hc="tab"][data-tab="manual"]');
    assert.equal(helpFocusKey(el({ 'data-hc': 'fb-st', 'data-id': 'a"b', 'data-st': '완료' })), '[data-hc="fb-st"][data-id="a\\"b"][data-st="완료"]');
    assert.equal(helpFocusKey(el({})), null); assert.equal(helpFocusKey(null), null);
});

test('불편접수 실패 보상: 접수 저장이 실패하면 방금 올린 사진을 치우고, 고른 사진은 남긴다', () => {
    assert.match(MAIN, /if \(error\) \{[^}]*if \(image_path\) await this\._helpDropUpload\(image_path\);\s*throw error;/);
    assert.match(MAIN, /storage\.from\('feedback'\)\.remove\(\[path\]\)/);
    assert.match(MAIN, /new DataTransfer\(\); dt\.items\.add\(file\); f2\.files = dt\.files/);
});

test('092 정적: RLS 켜짐 · 버킷 private · 첨부 수정 없음 · 지우기는 안 붙은 내 파일만 · 되돌리기는 is_staff/is_master 안 지움', () => {
    for (const t of ['notices', 'notice_reads', 'feedback_reports']) assert.match(SQL, new RegExp(`alter table public\\.${t} enable row level security`));
    assert.match(SQL, /values \('feedback', 'feedback', false, 5242880/);
    assert.ok(!/create policy[^;]*on storage\.objects for (update|all)/.test(SQL));
    const del = SQL.match(/create policy feedback_obj_delete on storage\.objects for delete[^;]*;/);
    assert.ok(del, '정리용 지우기 정책');
    assert.match(del[0], /current_username\(\)/); assert.match(del[0], /not exists \(select 1 from public\.feedback_reports r where r\.image_path = objects\.name\)/);
    assert.match(DOWN, /drop policy if exists feedback_obj_delete on storage\.objects/);
    assert.match(SQL, /grant update \(status, admin_note, updated_at\) on public\.feedback_reports/);
    assert.ok(!/drop function[^;]*(is_staff|is_master)/.test(DOWN));
});
