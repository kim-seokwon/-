//  사용 기록(ui_events) — 직원이 어느 화면을 열고 어떤 업무 버튼을 누르는지만 1주 남긴다(10-22 사장님 "직원들 사용패턴 보고 더 편하게").
//  남기는 것: 화면 id · 동작 id · 시각(서버) · 누가(서버가 auth.uid() 로 채움). 남기지 않는 것: 입력 내용 · 고객/주문 id · 검색어.
//  동작은 아래 UI_ACTIONS 에 적힌 고정 낱말만 받는다 — 값을 이어 붙여 보낼 길을 아예 막는다(DB 는 형식 CHECK).
//  수집 기간은 DB 가 정한다(091 ui_events_until). 기간 밖이면 보내지 않는다. 기록은 화면 동작과 무관: 비동기, 실패는 삼킨다.

export const UI_ID = /^[a-z0-9_.:-]{1,60}$/;
export const UI_GAP_MS = 1000;   // 같은 화면·같은 동작이 1초 안에 또 오면 버린다(렌더 두 번·더블클릭)
const QUEUE_MAX = 20;            // 기간 확인 전에 온 기록은 이만큼만 잠깐 들고 있다

//  동작 사전 — 여기 없는 낱말은 버린다. 업무 흐름(주문·CS·재고·할 일·캘린더)은 091 집계 뷰의 '한 일' 기준과 짝이다.
//  UI_ACTIONS_091 = 지금 DB(091 ui_events_action_check)가 받는 낱말. 이 목록을 바꾸면 DB 형식 CHECK 도 같이 바꿔야 한다.
export const UI_ACTIONS_091 = new Set([
    'open', 'close', 'refresh',                                                          // 창·화면 공통
    'filter_target', 'filter_shipping', 'filter_done', 'filter_claim', 'filter_all',     // 주문 상태 칸
    'order_sync', 'invoice_export', 'ship_issue', 'invoice_upload',                      // 주문 → 출고
    'cs_create', 'cs_create_order', 'cs_select', 'cs_filter', 'cs_status', 'cs_memo',    // CS 처리
    'inv_tab_finished', 'inv_tab_materials', 'inv_save',                                 // 재고 조회·저장
    'todo_add', 'todo_done', 'todo_undo', 'cal_add',                                     // 할 일·캘린더
    'paper', 'paper_auto', 'brand_open',                                                 // 뉴스·조간
]);
//  2단계 계측 보완(10-29 .work/사용편의/2단계-후보.md) — 다음 수집 때 DB CHECK 에 더할 낱말. 지금 DB 는 이 낱말을 거절한다.
//  동작 목록 CHECK(23514)로 거절되면 이 낱말만 그 뒤로 안 보내고 나머지 기록은 그대로 간다(makeTracker) — DB(102)를 먼저 안 깔아도 깨지지 않는다.
export const UI_ACTIONS_NEXT = new Set([
    'item_select', 'item_open', 'item_open_dbl', 'item_memo', 'item_note',               // 제품: 옆 상세 칸 · 상세 페이지(이름 단추/줄 두 번 누름) · 한 줄 메모 · 기록
    'paper_close_done', 'paper_close_x', 'paper_close_esc',                              // 조간 닫는 법: '다 봤습니다' · ✕ · Esc
    'paper_seen_1', 'paper_seen_2_3', 'paper_seen_4_6', 'paper_seen_7p', 'paper_seen_all', // 조간 본 장 수(구간) · 끝 장까지 봄
]);
export const UI_ACTIONS = new Set([...UI_ACTIONS_091, ...UI_ACTIONS_NEXT]);

//  고정 칸 → 고정 동작(칸 이름을 이어 붙이지 않고 표로 바꾼다. 표에 없으면 null → 안 보냄)
export const ORDER_FILTER_ACTION = { target: 'filter_target', shipping: 'filter_shipping', done: 'filter_done', claim: 'filter_claim', all: 'filter_all' };
export const INV_TAB_ACTION = { finished: 'inv_tab_finished', materials: 'inv_tab_materials' };
export const PAPER_CLOSE_ACTION = { done: 'paper_close_done', x: 'paper_close_x', esc: 'paper_close_esc' };

//  조간 본 장 수 → 고정 구간 낱말(숫자를 이어 붙이지 않는다). seen = 가장 멀리 넘긴 장(1부터), total = 그날 장 수.
//  끝 장까지 갔으면 'paper_seen_all'. 장을 못 그렸으면(불러오는 중) null → 안 보냄.
export function paperSeenAction(seen, total) {
    const s = Math.floor(Number(seen)), n = Math.floor(Number(total));
    if (!(s >= 1) || !(n >= 1)) return null;
    if (s >= n) return 'paper_seen_all';
    return s === 1 ? 'paper_seen_1' : s <= 3 ? 'paper_seen_2_3' : s <= 6 ? 'paper_seen_4_6' : 'paper_seen_7p';
}

//  직원 안내 — 수집이 켜진 첫 화면에 한 번 띄운다(무엇·왜·언제까지·누가 봄·안 모으는 것)
export function usageNotice(until) {
    const d = new Date(until);
    const md = Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}월 ${d.getDate()}일`;
    return `화면을 더 편하게 고치려고 ${md ? md + '까지 ' : ''}1주 동안 어느 화면·버튼을 쓰는지만 기록합니다. `
        + '입력한 내용·고객정보·검색어는 남기지 않습니다. 대표만 보고, 집계가 끝나면 개인별 기록은 지우고 익명 합계만 남깁니다.';
}

//  DB 가 이 동작 낱말을 모른다(동작 목록 CHECK 위반)는 것이 확실한 오류인가 — Postgres 23514 + 제약 이름 ui_events_action_check.
//  RLS(42501)·기간 끝·네트워크·다른 CHECK(screen) 는 아니다.
export function actionCheckMissing(err) {
    if (!err || String(err.code || '') !== '23514') return false;
    return /\bui_events_action_check\b/.test(String(err.message || '') + ' ' + String(err.details || ''));
}

//  send(row) — 실제로 보내는 함수(Supabase insert, 결과에 error 가 있으면 그 뒤로 끈다)
//  enabled() — 지금 기록해도 되나(로그인·직원·미리보기 아님)
//  ready — 수집 기간 확인 약속(true = 기간 안, false = 끝남/모름). 확인 전에 온 기록은 잠깐 들고 있다가 보내거나 버린다.
export function makeTracker({ send, enabled = () => true, ready = Promise.resolve(true), now = () => Date.now(), gap = UI_GAP_MS, later = f => setTimeout(f, 0) } = {}) {
    const last = new Map();
    let state = 'wait', queue = [], nextOff = false;
    //  기간 끝·권한 없음·그 밖의 오류면 그 뒤로 조용히 멈춤(전부 끔). 새 낱말(UI_ACTIONS_NEXT)이 동작 목록 CHECK 에 걸린 것
    //  (23514 + ui_events_action_check)만은 DB 에 102 가 아직 안 깔린 것이 확실하다 — 그때만 새 낱말만 끄고 나머지는 계속.
    const fire = row => later(() => {
        try {
            Promise.resolve(send(row)).then(r => {
                if (!(r && r.error)) return;
                if (UI_ACTIONS_NEXT.has(row.action) && actionCheckMissing(r.error)) nextOff = true; else state = 'off';
            }, () => {});
        } catch (_e) { /* 기록 실패는 화면에 영향 없음 */ }
    });
    Promise.resolve(ready).then(ok => {
        state = ok ? 'on' : 'off';
        const q = queue; queue = [];
        if (state === 'on') q.forEach(fire);
    }, () => { state = 'off'; queue = []; });
    return function track(screen, action) {
        try {
            if (state === 'off' || !enabled()) return false;
            if (!UI_ID.test(String(screen || '')) || !UI_ACTIONS.has(action)) return false;
            if (nextOff && UI_ACTIONS_NEXT.has(action)) return false;
            const key = screen + '|' + action, t = now();
            if (last.has(key) && t - last.get(key) < gap) return false;
            last.set(key, t);
            const row = { screen, action };
            if (state === 'wait') { if (queue.length < QUEUE_MAX) queue.push(row); } else fire(row);
            return true;
        } catch (_e) { return false; }
    };
}

//  미리보기·검수 판정 — 로컬 dev 서버, ?dev-preview=, 화면 검수용 가짜 계정이면 기록하지 않는다
export function trackAllowed(user, { dev = false, search = '' } = {}) {
    if (dev) return false;
    if (/[?&]dev-preview=/.test(search || '')) return false;
    if (!user || !['MASTER', 'STAFF'].includes(user.role)) return false;   // 고객사 계정은 대상 아님(DB 도 막음)
    if (['dev', 'preview', 'preview-user'].includes(user.id)) return false;
    return true;
}
