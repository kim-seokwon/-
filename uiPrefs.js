//  31 화면·사용 환경 — 글자 크기·표 간격·기본 전체 화면·상세 패널·시작 페이지 (순수 함수)
//  이 기기(브라우저)에 저장한다. 사람마다 모니터·눈이 달라 계정이 아니라 기기 기준이 맞다.
export const UI_PREF_KEY = 'bhas_ui_prefs';

export const UI_OPTIONS = {
    font: [['s', '작게', 0.92], ['m', '보통', 1], ['l', '크게', 1.1], ['xl', '아주 크게', 1.22]],
    density: [['tight', '좁게'], ['normal', '보통'], ['loose', '넓게']],
    detail: [['narrow', '좁게', 260], ['normal', '보통', 300], ['wide', '넓게', 400]],
    max: [['on', '전체 화면으로'], ['off', '창 크기로']],
};
//  시작 페이지 후보 — 메뉴 권한이 없는 화면은 고를 때·열 때 둘 다 뺀다
export const START_VIEWS = [['', '없음(바탕화면)'], ['reminders', '할 일'], ['orders', '주문·배송'], ['items', '상품 관리'],
    ['sales', '매출 분석'], ['sns', '마케팅'], ['calendar', '통합 캘린더']];

export const UI_DEFAULT = { font: 'm', density: 'normal', detail: 'normal', max: 'off', start: '' };

const pick = (k, v) => (UI_OPTIONS[k] || []).some(o => o[0] === v) ? v : UI_DEFAULT[k];
export function normalizeUiPrefs(raw) {
    const o = raw && typeof raw === 'object' ? raw : {};
    return {
        font: pick('font', o.font), density: pick('density', o.density), detail: pick('detail', o.detail), max: pick('max', o.max),
        start: START_VIEWS.some(s => s[0] === o.start) ? o.start : '',
    };
}
export function parseUiPrefs(text) {
    try { return normalizeUiPrefs(JSON.parse(text || 'null')); } catch (_e) { return { ...UI_DEFAULT }; }
}
//  상세 패널 폭(px) — 3단 화면 오른쪽 칸(--pane-det). 사용자가 끌어 바꾼 폭(인라인)은 그대로 이긴다
export const detailWidth = d => (UI_OPTIONS.detail.find(o => o[0] === d) || UI_OPTIONS.detail[1])[2];
export const fontZoom = f => (UI_OPTIONS.font.find(o => o[0] === f) || UI_OPTIONS.font[1])[2];
//  시작 페이지 — 고른 화면을 지금 권한으로 열 수 있을 때만. allowed: Set(view id)
export function startViewFor(prefs, allowed) {
    const v = prefs?.start || '';
    return v && (!allowed || allowed.has(v)) ? v : '';
}
export const startChoices = allowed => START_VIEWS.filter(([v]) => !v || !allowed || allowed.has(v));
