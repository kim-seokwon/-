//  32 업데이트 내용·적용 시각 — 사용자에게 보이는 '이번에 바뀐 것' (순수 데이터·함수)
//  배포할 때 맨 위에 한 덩어리를 더한다. 빌드가 이 목록을 /version.json 으로도 내보내서
//  옛 화면을 띄워 둔 사람도 [업데이트]를 누르기 전에 무엇이 바뀌는지 본다.
//  문구는 쓰는 사람 말로 — 내부 번호(마이그레이션·항목 번호)는 쓰지 않는다.
export const RELEASES = [
    { date: '2026-11-20', items: [
        '설정 › 화면·사용 환경: 글자 크기·표 간격·새 창 전체 화면·상세 패널 폭·시작 페이지',
        '설정 › 광고 판정 기준: 기준 설명표·변경 이력·되돌리기(다른 관리자가 바꾼 뒤엔 막음)',
        '설정 › 메뉴 권한: 사이드 메뉴와 같은 이름, 사람별로 켜고 끄기',
        '회사 정보·견적서: 문서에 찍히는 회사 정보를 한 곳에서 고치기, 0원·빈 칸 견적 확정 막기',
        '매출 분석·고객 분석·작업지시서 작성 개선',
        '업데이트 내용·적용 시각 표시, 업데이트·새로고침 때 저장 안 한 입력 지키기',
    ] },
];

//  알림·설정에 보일 최근 항목 — 최신 묶음부터 n개
export function latestItems(rel = RELEASES, n = 3) {
    return (rel || []).flatMap(r => (r.items || []).map(t => ({ date: r.date, t }))).slice(0, n);
}

//  /version.json 이 가리키는 빌드가 내 빌드와 다른가 — 둘 다 있어야 판단한다
export function isNewer(mine, live) {
    return !!(mine && live && live.build && live.build !== mine);
}

//  저장하지 않은 작업 요약 — [{ where, n }] → '광고 판정 기준 1곳 · 견적서 2곳'
export function unsavedText(list) {
    const m = new Map();
    (list || []).forEach(x => { if (x && x.where) m.set(x.where, (m.get(x.where) || 0) + (x.n || 1)); });
    return [...m].map(([w, n]) => `${w} ${n}곳`).join(' · ');
}

//  입력 칸 하나가 '고쳤지만 아직 저장 안 함'인가 — 사람이 직접 친 칸(data-touched)이고,
//  화면이 그린 값(defaultValue)과 지금 값이 다르면. 코드가 넣은 값은 세지 않는다(괜한 경고 막기).
//  검색·필터·고르기·읽기 전용·숨김 칸은 작업이 아니라 빼고 센다.
//  고르는 칸(select·checkbox·radio)은 저장형 폼(입력 창·form) 안에서만 센다 — 화면 필터·즉시 저장 스위치는 바뀌어도 잃을 게 없다.
//  32 반려1: 새 견적서 상태만 작성중→발송으로 바꿔도 '저장 안 한 입력'이다(처음 값 defaultSelected·defaultChecked 와 비교).
const CHOICE = ['select-one', 'select-multiple', 'checkbox', 'radio'];
export function isEditedField(f, saved = false) {
    if (!f || f.disabled || f.readOnly) return false;
    const type = String(f.type || '').toLowerCase();
    if (!f.dataset || f.dataset.touched == null || f.dataset.nodirty != null) return false;
    if (CHOICE.includes(type)) {
        if (!saved) return false;
        if (type === 'checkbox' || type === 'radio') return !!f.checked !== !!f.defaultChecked;
        const opts = Array.from(f.options || []);
        if (!opts.length) return false;
        const hasDef = opts.some(o => o.defaultSelected);
        return opts.some((o, i) => !!o.selected !== (hasDef ? !!o.defaultSelected : (type === 'select-one' && i === 0)));
    }
    if (['search', 'hidden', 'button', 'submit', 'file', 'range', 'color'].includes(type)) return false;
    if (/검색|찾기|search|filter/i.test(`${f.placeholder || ''} ${f.className || ''} ${f.name || ''}`)) return false;
    return String(f.value ?? '') !== String(f.defaultValue ?? '');
}
