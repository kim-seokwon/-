//  사용 기록(ui_events) — 직원이 어느 화면을 열고 어떤 업무 버튼을 누르는지만 1주 남긴다(10-22 사장님 "직원들 사용패턴 보고 더 편하게").
//  남기는 것: 화면 id · 동작 id · 시각(서버) · 누가(서버가 auth.uid() 로 채움). 남기지 않는 것: 입력 내용 · 고객/주문 id · 검색어.
//  동작은 아래 UI_ACTIONS 에 적힌 고정 낱말만 받는다 — 값을 이어 붙여 보낼 길을 아예 막는다(DB 는 형식 CHECK).
//  수집 기간은 DB 가 정한다(091 ui_events_until). 기간 밖이면 보내지 않는다. 기록은 화면 동작과 무관: 비동기, 실패는 삼킨다.

export const UI_ID = /^[a-z0-9_.:-]{1,60}$/;
export const UI_GAP_MS = 1000;   // 같은 화면·같은 동작이 1초 안에 또 오면 버린다(렌더 두 번·더블클릭)
const QUEUE_MAX = 20;            // 기간 확인 전에 온 기록은 이만큼만 잠깐 들고 있다

//  동작 사전 — 여기 없는 낱말은 버린다. 업무 흐름(주문·CS·재고·할 일·캘린더)은 091 집계 뷰의 '한 일' 기준과 짝이다.
export const UI_ACTIONS = new Set([
    'open', 'close', 'refresh',                                                          // 창·화면 공통
    'filter_target', 'filter_shipping', 'filter_done', 'filter_claim', 'filter_all',     // 주문 상태 칸
    'order_sync', 'invoice_export', 'ship_issue', 'invoice_upload',                      // 주문 → 출고
    'cs_create', 'cs_create_order', 'cs_select', 'cs_filter', 'cs_status', 'cs_memo',    // CS 처리
    'inv_tab_finished', 'inv_tab_materials', 'inv_save',                                 // 재고 조회·저장
    'todo_add', 'todo_done', 'todo_undo', 'cal_add',                                     // 할 일·캘린더
    'paper', 'paper_auto', 'brand_open',                                                 // 뉴스·조간
]);

//  고정 칸 → 고정 동작(칸 이름을 이어 붙이지 않고 표로 바꾼다. 표에 없으면 null → 안 보냄)
export const ORDER_FILTER_ACTION = { target: 'filter_target', shipping: 'filter_shipping', done: 'filter_done', claim: 'filter_claim', all: 'filter_all' };
export const INV_TAB_ACTION = { finished: 'inv_tab_finished', materials: 'inv_tab_materials' };

//  직원 안내 — 수집이 켜진 첫 화면에 한 번 띄운다(무엇·왜·언제까지·누가 봄·안 모으는 것)
export function usageNotice(until) {
    const d = new Date(until);
    const md = Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}월 ${d.getDate()}일`;
    return `화면을 더 편하게 고치려고 ${md ? md + '까지 ' : ''}1주 동안 어느 화면·버튼을 쓰는지만 기록합니다. `
        + '입력한 내용·고객정보·검색어는 남기지 않습니다. 대표만 보고, 집계가 끝나면 개인별 기록은 지우고 익명 합계만 남깁니다.';
}

//  send(row) — 실제로 보내는 함수(Supabase insert, 결과에 error 가 있으면 그 뒤로 끈다)
//  enabled() — 지금 기록해도 되나(로그인·직원·미리보기 아님)
//  ready — 수집 기간 확인 약속(true = 기간 안, false = 끝남/모름). 확인 전에 온 기록은 잠깐 들고 있다가 보내거나 버린다.
export function makeTracker({ send, enabled = () => true, ready = Promise.resolve(true), now = () => Date.now(), gap = UI_GAP_MS, later = f => setTimeout(f, 0) } = {}) {
    const last = new Map();
    let state = 'wait', queue = [];
    const fire = row => later(() => {
        try {
            Promise.resolve(send(row)).then(r => { if (r && r.error) state = 'off'; }, () => {});   // 기간 끝·권한 없음이면 그 뒤로 조용히 멈춤
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
