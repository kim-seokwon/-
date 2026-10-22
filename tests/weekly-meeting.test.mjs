// 주간 회의록 1단계 — 메타 '-->' 왕복(기획 3-3 테스트 1~5) · 같은 주 중복 · 다시 만들기 10~12 보존 · 확정 고정.
// _joinNote 등은 main.js 에서 그대로 떼어 오고, 나머지는 meetingNote.js 를 바로 부른다. 실행: npm run test:weekly-meeting
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as M from '../meetingNote.js';
//  main.js 에서 떼어 온 메서드가 쓰는 도우미(메모 정리 — 바뀐 게 없으면 저장 안 함)
import { changedFields, bodyWithText } from '../noteTidy.js'; // eslint-disable-line no-unused-vars

const src = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const method = (name) => {
    const re = new RegExp(`\\n    (async )?${name}\\(`);
    const m = re.exec(src); assert.ok(m, `${name} 를 main.js 에서 못 찾음`);
    const a = m.index + 1, eol = src.indexOf('\n', a), first = src.slice(a, eol);
    const oneLine = first.trimEnd().endsWith('}') && first.split('{').length === first.split('}').length;
    const b = oneLine ? eol : src.indexOf('\n    }\n', a) + 6;
    const body = src.slice(a, b).trim().replace(new RegExp(`^(async )?${name}\\(`), (_, as) => `${as || ''}function ${name}(`);
    return eval('(' + body + ')');
};
const field = (name) => { const m = new RegExp(`\\n    ${name} = (.+);\\n`).exec(src); assert.ok(m, `${name} 못 찾음`); return eval('(' + m[1] + ')'); };

const mk = (notes = []) => {
    const t = {
        NOTE_META_RE: field('NOTE_META_RE'), noteList: notes, noteSel: notes[0]?.id, saved: [],
        requestRender() {}, showToast() {}, saveNote: async () => {},
        _curNote() { return this.noteList.find(x => x.id === this.noteSel) || null; },
        supabase: { from: (table) => ({ update: (row) => ({ eq: async (_c, id) => { t.saved.push({ table, id, ...row }); return { error: null }; } }) }) },
    };
    for (const f of ['_noteMeta', '_noteText', '_joinNote', 'setNoteProp']) t[f] = method(f);
    return t;
};
//  수정 전 _joinNote (하위호환 바이트 비교용)
const oldJoin = (meta, text) => {
    const bare = { ...meta };
    Object.keys(bare).forEach(k => { if (bare[k] === '' || bare[k] === '없음' || (Array.isArray(bare[k]) && !bare[k].length)) delete bare[k]; });
    return (Object.keys(bare).length ? `<!--p ${JSON.stringify(bare)}-->\n` : '') + text;
};
const meetMeta = () => ({ kind: 'meeting', week: '2026-10-19', state: 'draft', made_at: '2026-10-19T00:00:00Z',
    snap: { news_candidates: [{ kind: 'trend', title: 'a-->b', url: 'https://x' }], health: [] } });

// ── 기획 3-3 테스트 1~5 ────────────────────────────────────
test('3-3 ① 제목에 --> 가 있어도 첫 --> 는 메타를 닫는 자리, 결과에 --\\u003e', () => {
    const t = mk();
    const body = t._joinNote(meetMeta(), '본문');
    assert.equal(body.indexOf('-->'), body.indexOf('-->\n'));
    assert.ok(body.includes('--\\u003e'));
});
test('3-3 ② _noteMeta 로 읽으면 제목이 a-->b 로 되돌아온다', () => {
    const t = mk();
    const body = t._joinNote(meetMeta(), '본문');
    assert.equal(t._noteMeta({ body }).snap.news_candidates[0].title, 'a-->b');
});
test('3-3 ③ _noteText 는 본문만 — 메타가 새지 않는다', () => {
    const t = mk();
    assert.equal(t._noteText({ body: t._joinNote(meetMeta(), '본문') }), '본문');
});
test('3-3 ④ setNoteProp(status) 뒤에도 snap 제목·state 유지 (재직렬화 왕복)', async () => {
    const t0 = mk();
    const n = { id: 'n1', title: '회의', body: t0._joinNote(meetMeta(), '본문') };
    const t = mk([n]);
    await t.setNoteProp('status', '진행');
    const back = t._noteMeta(n);
    assert.equal(back.status, '진행');
    assert.equal(back.state, 'draft');
    assert.equal(back.snap.news_candidates[0].title, 'a-->b');
    assert.equal(t._noteText(n), '본문');
    assert.equal(t.saved.at(-1).body, n.body);
});
test('3-3 ⑤ --> 없는 기존 메모는 수정 전과 바이트 단위로 같다', () => {
    const t = mk();
    const cases = [
        [{ status: '진행', due: '2026-10-24', who: '김', proj: '', links: ['a', 'b'] }, '내용\n[ ] 할 일'],
        [{ status: '없음', due: '', who: '', proj: '', links: [] }, '메타 없는 메모'],
        [{ embed: 'items', note: '<!-- 주석 아님 -->' }, 'x'],   // '-->' 가 있으면 다르게 나와야 하는 경우와 구분
    ];
    for (const [m, txt] of cases.slice(0, 2)) assert.equal(t._joinNote(m, txt), oldJoin(m, txt));
    assert.notEqual(t._joinNote(...cases[2]), oldJoin(...cases[2]));
    assert.equal(t._noteMeta({ body: t._joinNote(...cases[2]) }).note, '<!-- 주석 아님 -->');
});

// ── 주 계산 ─────────────────────────────────────────────
test('주: KST 월요일·ISO 주·제목·숫자 주(지난주)', () => {
    assert.equal(M.kstToday(new Date('2026-10-18T15:30:00Z')), '2026-10-19');   // 일 23:30 UTC 가 아니라 KST 월 00:30
    assert.equal(M.mondayOf('2026-10-25'), '2026-10-19');
    assert.equal(M.mondayOf('2026-10-19'), '2026-10-19');
    assert.equal(M.isoWeek('2026-10-19'), '2026-W43');
    assert.equal(M.isoWeek('2026-12-28'), '2026-W53');
    assert.equal(M.isoWeek('2027-01-04'), '2027-W01');
    assert.equal(M.meetingTitle('2026-10-19'), '2026-W43 주간회의 (10/19~10/25)');
    assert.equal(M.dataWeekOf('2026-10-19'), '2026-10-12');
    assert.equal(M.kstStamp('2026-10-20T00:40:12.5+00:00'), '2026-10-20 09:40');
    assert.equal(M.kstStamp(''), '');
});

// ── 같은 주 중복 방지 ─────────────────────────────────────
test('중복: 같은 week 의 meeting 메타가 있으면 찾는다 — 제목이 아니라 메타로', () => {
    const t = mk();
    const notes = [
        { id: 'a', title: '2026-W43 주간회의 (10/19~10/25)', body: '그냥 메모' },                       // 제목만 같음
        { id: 'b', title: '다른 이름', body: t._joinNote({ kind: 'meeting', week: '2026-10-12', state: 'draft' }, '') },
        { id: 'c', title: '바꾼 제목', body: t._joinNote({ kind: 'meeting', week: '2026-10-19', state: 'draft' }, '') },
    ];
    assert.equal(M.findMeeting(notes, '2026-10-19', n => t._noteMeta(n))?.id, 'c');
    assert.equal(M.findMeeting(notes.slice(0, 2), '2026-10-19', n => t._noteMeta(n)), null);
});
test('중복: createWeeklyMeeting 은 이미 있으면 RPC·insert 없이 그걸 연다', async () => {
    const t0 = mk();
    const had = { id: 'c', title: 'x', folder: '회의록', body: t0._joinNote({ kind: 'meeting', week: '2026-10-19', state: 'draft' }, '') };
    const calls = [];
    const t = Object.assign(mk([had]), {
        _noteLoaded: true, opened: null, currentUser: { name: '사장' },
        _meetWeek: () => '2026-10-19', openMeetingNote(id) { this.opened = id; },
        supabase: { rpc: async () => { calls.push('rpc'); return { data: {} }; }, from: () => { calls.push('from'); throw new Error('DB 접근 없어야 함'); } },
    });
    for (const f of ['_meetingOf', '_findMeetingDb', 'createWeeklyMeeting']) t[f] = method(f);
    globalThis.findMeeting = M.findMeeting; globalThis.MEETING_FOLDER = M.MEETING_FOLDER;
    await t.createWeeklyMeeting();
    assert.equal(t.opened, 'c');
    assert.deepEqual(calls, []);
});
test('실패: weekly_brief 오류면 회의록을 만들지 않는다', async () => {
    const inserts = [], toasts = [];
    const t = Object.assign(mk([]), {
        _noteLoaded: true, currentUser: { name: '사장' }, _meetWeek: () => '2026-10-19', showToast: s => toasts.push(s),
        supabase: {
            rpc: async () => ({ data: null, error: { message: 'boom' } }),
            from: () => ({ select: () => ({ eq: () => ({ ilike: () => ({ limit: async () => ({ data: [], error: null }) }) }) }),
                           insert: (r) => { inserts.push(r); return { select: () => ({ single: async () => ({ data: {}, error: null }) }) }; } }),
        },
    });
    for (const f of ['_meetingOf', '_findMeetingDb', '_weeklyBrief', 'createWeeklyMeeting']) t[f] = method(f);
    Object.assign(globalThis, { findMeeting: M.findMeeting, MEETING_FOLDER: M.MEETING_FOLDER, dataWeekOf: M.dataWeekOf });
    const warn = console.warn; console.warn = () => {};
    await t.createWeeklyMeeting(); console.warn = warn;
    assert.equal(inserts.length, 0);
    assert.ok(toasts.some(s => s.includes('숫자를 못 모았습니다')));
});

// ── 다시 만들기 ────────────────────────────────────────────
const snapA = { week: { start: '2026-10-12', end: '2026-10-18' }, made_at: '2026-10-19T00:00:00Z',
    health: [{ mall_key: 'hiheiho', brand: '하이헤이호', status: 'ok' }, { mall_key: 'kidikidi', brand: '키디', status: 'down' }],
    sales: { total: { this: { paid: 1000, order_count: 3, refund: 0 }, prev: { paid: 500 }, avg4: { paid: 700 } }, by_brand: [] },
    top_items: [], claims: {}, cs: { new: 1, open: 2, open_over7: 0, by_kind: [] }, shipping: { pre: 4, failed: 0, unknown: 0 },
    production: { due7: [], overdue: [] }, stock: { negative: 0, low: 1, material_low: 0 },
    news_candidates: [{ kind: 'trend', title: '소식1', url: 'https://n/1' }], insta: { error: 'relation missing' } };
const snapB = { ...snapA, sales: { total: { this: { paid: 2222, order_count: 9, refund: 0 }, prev: {}, avg4: {} }, by_brand: [] } };

test('다시 만들기: 0~9 는 새 숫자, 10~12 사람이 쓴 글은 그대로', () => {
    const first = M.buildBody(snapA, null);
    const edited = first.replace('## 10 결정\n', '## 10 결정\n가격 인상 보류\n').replace('## 12 메모\n', '## 12 메모\n회의 끝\n');
    const next = M.regenerateBody(edited, snapB, null);
    assert.ok(next.includes('2,222원'));
    assert.ok(!next.includes('1,000원'));
    assert.equal(M.humanPart(next), M.humanPart(edited));
    assert.ok(next.includes('가격 인상 보류') && next.includes('회의 끝'));
});
test('다시 만들기: 10번 제목 줄을 지웠으면 거부(null) — 글을 잃지 않게', () => {
    const body = M.buildBody(snapA, null).replace('## 10 결정', '결정');
    assert.equal(M.regenerateBody(body, snapB, null), null);
});
test('그리기: 끊긴 몰 빨간 줄 · 실패 섹션만 불러오지 못함 · 브랜드별 정의 차이', () => {
    const b = M.buildBody({ ...snapA, sales: { ...snapA.sales, by_brand: [{ brand_name: '하이헤이호', amt: 900, cnt: 3 }] } }, null);
    assert.ok(b.includes('🔴 키디 kidikidi 수집 끊김 — 이 몰 숫자 빠짐'));
    assert.match(b, /## 7 인스타\n· 불러오지 못함/);
    assert.ok(b.includes('## 1 숫자판\n· 매출(실결제) 1,000원'));
    assert.ok(b.includes('주문 기준이라 합계와 다를 수 있음'));
    for (let i = 0; i <= 12; i++) assert.match(b, new RegExp(`^## ${i} `, 'm'));
});

// ── 확정 ─────────────────────────────────────────────────
test('확정: confirmed·confirmed_at·by, 끊긴 몰은 confirmed_with_down, 확정 뒤 다시 만들기 불가', () => {
    const now = new Date('2026-10-20T00:40:00Z');
    const meta = M.newMeetingMeta('2026-10-19', snapA, now);
    assert.equal(M.canRegenerate(meta), true);
    const c = M.confirmMeetingMeta(meta, { by: '사장', now });
    assert.equal(c.state, 'confirmed');
    assert.equal(c.confirmed_at, now.toISOString());
    assert.equal(c.confirmed_by, '사장');
    assert.deepEqual(c.confirmed_with_down, ['kidikidi']);
    assert.equal(c.snap, snapA);                                  // 숫자는 그대로
    assert.equal(M.canRegenerate(c), false);
    assert.equal(M.confirmMeetingMeta(c, { by: 'x' }), null);     // 두 번 확정 안 됨
    const ok = M.confirmMeetingMeta(M.newMeetingMeta('2026-10-19', { ...snapA, health: [] }), { by: '사장' });
    assert.ok(!('confirmed_with_down' in ok));
});
test('확정 메타가 _joinNote·saveNote 왕복을 거쳐도 남는다', async () => {
    const t0 = mk();
    const c = M.confirmMeetingMeta(M.newMeetingMeta('2026-10-19', snapA), { by: '사장' });
    const n = { id: 'n1', title: 't', body: t0._joinNote(c, M.buildBody(snapA, null)) };
    const t = mk([n]);
    await t.setNoteProp('who', '김');
    const back = t._noteMeta(n);
    assert.equal(back.state, 'confirmed');
    assert.deepEqual(back.confirmed_with_down, ['kidikidi']);
    assert.equal(back.snap.sales.total.this.paid, 1000);
});
test('지난주 할 일: 완료·밀림·담당 없음', () => {
    const s = M.prevTodoSummary([
        { done: true, title: 'a', at: ['김'], due: '2026-10-10' },
        { done: false, title: 'b', at: [], due: '2026-10-15' },
        { done: false, title: 'c', at: ['이'], due: '2026-10-30' },
    ], '2026-10-20');
    assert.deepEqual([s.total, s.done, s.late, s.no_owner], [3, 1, 1, 1]);
    assert.ok(M.renderSections(snapA, s).includes('· 3개 중 완료 1 · 밀림 1 · 담당 없음 1'));
});
