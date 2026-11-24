//  33 불편접수 한 곳 — 옛 접수함(feedback, 10-22 이전)과 새 접수(feedback_reports, 도움말 패널)를 한 목록으로 (순수 함수)
//  새 접수는 화면·버전·창 크기·재현 과정·첨부·처리 상태·답을 함께 남긴다. 재현 과정·버전은 092 의 screen_meta(jsonb ≤4000바이트)에 담는다
//  — 서버 바꾸지 않고 바로 쓸 수 있게. 옛 접수는 읽기 + 해결 처리만(옛 표엔 답 칸·사진이 없다).

//  도움말 버튼의 실제 자리 — 화면은 맥 모드 하나라 맨 위 메뉴 막대 오른쪽에 있다(옛 안내 '오른쪽 아래'는 틀림)
export const HELP_WHERE = '맨 위 오른쪽 [도움말]';
export const FB_STEPS_MAX = 800;
export const META_MAX_BYTES = 4000;
export const INBOX_FILTERS = [['open', '처리 전'], ['done', '완료'], ['all', '전체']];

const bytes = o => new TextEncoder().encode(JSON.stringify(o)).length;

//  재현 과정 검사 — 통과면 null
export function validateSteps(steps) {
    const t = String(steps || '').trim();
    return t.length > FB_STEPS_MAX ? `재현 과정은 ${FB_STEPS_MAX}자까지입니다(지금 ${t.length}자).` : null;
}

//  접수에 함께 남길 정보 — { w, h, ver, steps } · 4000바이트를 넘지 않게 재현 과정 끝을 자른다
export function feedbackMeta({ w, h, ver, steps } = {}) {
    const m = { w: Number(w) || 0, h: Number(h) || 0 };
    if (ver) m.ver = String(ver).slice(0, 60);
    let s = String(steps || '').trim().slice(0, FB_STEPS_MAX);
    if (s) { m.steps = s; while (bytes(m) > META_MAX_BYTES && s.length) { s = s.slice(0, -20); m.steps = s; } if (!s) delete m.steps; }
    return m;
}

//  한 줄 모양 — { src:'new'|'old', id, who, screen, ver, size, body, steps, image, status, note, at, cat }
export function fromNew(r) {
    const m = r?.screen_meta && typeof r.screen_meta === 'object' ? r.screen_meta : {};
    return {
        src: 'new', id: r.id, who: r.username || '', screen: r.screen || '', ver: m.ver || '',
        size: m.w && m.h ? `${m.w}×${m.h}` : '', body: r.body || '', steps: m.steps || '',
        image: r.image_path || '', status: ['접수', '처리중', '완료'].includes(r.status) ? r.status : '접수',
        note: r.admin_note || '', at: r.created_at || '', cat: '',
    };
}
export function fromOld(f) {
    const done = f?.status === 'resolved';
    return {
        src: 'old', id: f.id, who: f.author_name || f.author_email || '익명', screen: f.page || '', ver: '', size: '',
        body: f.message || '', steps: '', image: '', status: done ? '완료' : '접수',
        note: done && f.resolved_by ? `해결: ${f.resolved_by}` : '', at: f.created_at || '', cat: f.category || '',
    };
}
//  두 목록을 최신순으로 합친다. 한쪽을 못 받았으면(null) 그쪽만 빠진다
export function mergeInbox(news, olds) {
    return [...(news || []).map(fromNew), ...(olds || []).map(fromOld)]
        .sort((a, b) => String(b.at).localeCompare(String(a.at)));
}
//  답 저장 값 — 092 admin_note 는 text NOT NULL default '' 라 지운 답은 null 이 아니라 빈 문자열로 보낸다(코덱스 반려 11-20)
export const NOTE_MAX = 1000;
export function notePatch(text) {
    const note = String(text ?? '').trim();
    return note.length > NOTE_MAX ? { error: `답은 1,000자까지입니다(지금 ${note.length.toLocaleString()}자).` } : { admin_note: note };
}
export const isOpen = r => r.status !== '완료';
export function inboxFilter(list, f) {
    return f === 'done' ? (list || []).filter(r => !isOpen(r)) : f === 'all' ? (list || []).slice() : (list || []).filter(isOpen);
}
export function inboxCounts(list) {
    const c = { 접수: 0, 처리중: 0, 완료: 0, old: 0 };
    (list || []).forEach(r => { c[r.status]++; if (r.src === 'old') c.old++; });
    return { ...c, open: c.접수 + c.처리중, all: (list || []).length };
}
