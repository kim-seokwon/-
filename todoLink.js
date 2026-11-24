//  할 일 모델·원본 연결(C-c, 개선요청 19·20) — DB 를 부르지 않는다. 화면(main.js)과 시험이 같은 함수를 쓴다.
//  ① 할 일 상태·우선순위(135)  ② 생산·시즌 단계 완료를 원본과 같이  ③ 생산 납기 = 제품 출고예정일  ④ 오픈일 변경 영향

//  ① 할 일(reminders) — status 와 done 은 DB 트리거(135)가 맞춘다. 135 가 안 깔린 DB 는 done 만 있다.
export const REM_STATUS = ['할 일', '진행', '완료', '취소'];
export const REM_PRIORITY = [{ v: 1, t: '높음' }, { v: 2, t: '보통' }, { v: 3, t: '낮음' }];
export const remStatusOf = r => (r && REM_STATUS.includes(r.status)) ? r.status : (r && r.done ? '완료' : '할 일');
export const isClosedStatus = s => s === '완료' || s === '취소';
//  상태를 바꿀 때 보내는 값 — done 도 같이 보낸다(트리거 없는 DB·옛 화면 호환). done_at 은 실제로 끝남/되살림일 때만.
export function remStatusPatch(r, status, nowIso) {
    if (!REM_STATUS.includes(status)) throw new Error('알 수 없는 상태: ' + status);
    const done = isClosedStatus(status);
    const p = { status, done };
    if (done !== !!(r && r.done)) p.done_at = done ? nowIso : null;
    return p;
}
//  동그라미 체크 = 완료 ↔ 할 일(취소된 일은 되살린다)
export const remToggleStatus = r => isClosedStatus(remStatusOf(r)) ? '할 일' : '완료';
//  135 가 없는 DB 에 새 칸을 쓰면 '열 없음' — 새 칸을 빼고 다시 쓴다(옛 동작)
export const REM_NEW_COLS = ['status', 'priority', 'assignee_id'];
export const isMissingColErr = (e, cols = REM_NEW_COLS) => !!e && (e.code === 'PGRST204' || e.code === '42703'
    || cols.some(c => new RegExp(`\\b${c}\\b`).test(String(e.message || ''))));

//  ② 시즌 단계 메모 — 체크줄이 있으면 줄이 전부 끝났을 때 완료, 없으면 메모 상태가 '완료'일 때.
export function stepDone(meta, lines) {
    const st = (meta && meta.status) || '';
    if (lines && lines.length) return lines.every(x => x.done);
    return st === '완료';
}
//  체크줄을 바꾼 뒤 메모 상태를 원본과 맞춘다 — 전부 끝나면 '완료', 하나라도 다시 열리면 '완료'→'진행'. 그 밖은 그대로.
export function stepStatusAfter(meta, lines) {
    const st = (meta && meta.status) || '';
    if (!lines || !lines.length) return st;
    const all = lines.every(x => x.done);
    if (all && st !== '완료') return '완료';
    if (!all && st === '완료') return '진행';
    return st;
}
//  체크줄 없는 단계 메모를 할 일 화면·캘린더에서 끄고 켤 때
export const stepToggleStatus = meta => ((meta && meta.status) === '완료' ? '진행' : '완료');

//  ③ 생산 납기 — 제품에 연결된 작업은 제품 출고예정일이 원본(한 곳에서만 적는다). 제품에 날짜가 없으면 작업에 적힌 값.
export function jobDue(job, item) {
    const own = job ? (job.due_date || null) : null;
    const it = item && item.ship_date ? String(item.ship_date).slice(0, 10) : null;
    if (job && job.item_id && it) return { date: it, linked: true, own };
    return { date: own ? String(own).slice(0, 10) : null, linked: false, own };
}

//  ④ 오픈일 변경 영향 — 바꾸기 전에 보여 주고 고르게 한다. 아무것도 쓰지 않는다.
//   move: 오픈일 기준 계산값 그대로인 단계 → 새 오픈일 기준으로 옮길 수 있음
//   keep: 날짜를 직접 고친 단계(계산값과 다름) → 그대로 둠
//   check: 같은 시즌 제품 오픈예정일이 옛 오픈일과 같음 → 제품표에서 따로 확인
//   warn: 진행 중 생산 납기가 새 오픈일보다 늦음
export function openShiftPlan({ oldOpen, newOpen, notes = [], steps = [], items = [], jobs = [], stepDate }) {
    //  '2026.12.01'·'2026/12/1' 도 같은 날로(시즌 마감은 글자 칸이라 점 표기가 섞여 있다)
    const d10 = v => { const m = String(v || '').match(/(\d{4})[.\-/\s]+(\d{1,2})[.\-/\s]+(\d{1,2})/);
        return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null; };
    oldOpen = d10(oldOpen); newOpen = d10(newOpen);
    if (!newOpen || oldOpen === newOpen) return [];
    const byStep = new Map(steps.map(s => [String(s.id), s]));
    const rows = [];
    notes.forEach(n => {
        const m = n.meta || {}; const cur = d10(m.due); if (!cur) return;
        if (m.embed === 'season-home') {
            rows.push(oldOpen && cur === oldOpen
                ? { kind: 'home', id: n.id, title: n.title, cur, next: newOpen, action: 'move' }
                : { kind: 'home', id: n.id, title: n.title, cur, next: cur, action: 'keep' });
            return;
        }
        if (!m.step) return;
        const st = byStep.get(String(m.step));
        const was = st && oldOpen ? stepDate(oldOpen, st.offset_days) : null;
        if (st && was === cur) rows.push({ kind: 'step', id: n.id, title: n.title, cur, next: stepDate(newOpen, st.offset_days), action: 'move' });
        else rows.push({ kind: 'step', id: n.id, title: n.title, cur, next: cur, action: 'keep' });
    });
    items.forEach(it => {
        if (oldOpen && d10(it.open_date) === oldOpen) rows.push({ kind: 'item', id: it.id, title: it.name, cur: oldOpen, next: oldOpen, action: 'check' });
    });
    jobs.forEach(j => {
        const due = d10(j.due_date);
        if (j.status !== 'done' && due && due > newOpen) rows.push({ kind: 'job', id: j.id, title: j.title, cur: due, next: due, action: 'warn' });
    });
    return rows;
}
//  옮길 때 처음 날짜를 due0 에 남긴다(원문 일정 보존 — 여러 번 옮겨도 맨 처음 값 하나)
export const shiftedMeta = (meta, next) => ({ ...meta, due: next, due0: meta.due0 || meta.due });
