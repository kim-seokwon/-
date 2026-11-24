//  캘린더 상태(C-b) — 숫자 기준 기간 · 칩 완료/지연 · 날짜 없는 일. DB 를 부르지 않는다.
//  화면(main.js renderCalendar)과 테스트가 같은 함수를 쓴다.

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };

//  숫자를 세는 기간 = 지금 보이는 기간 하나. 달=그 달 1일~말일, 주=일요일~토요일, 일=그날.
//  브랜드 칩 숫자 · 왼쪽 출처별 숫자 · 날짜 없는 일 외 모든 숫자가 이 기간 하나로 센다.
export function calRange(view, cursor) {
    const c = parse(cursor) || new Date();
    if (view === 'week') {
        const a = new Date(c); a.setDate(a.getDate() - a.getDay());
        const b = new Date(a); b.setDate(b.getDate() + 6);
        return { from: ymd(a), to: ymd(b), label: `${a.getMonth() + 1}/${a.getDate()}–${b.getMonth() + 1}/${b.getDate()}` };
    }
    if (view === 'day') return { from: ymd(c), to: ymd(c), label: `${c.getMonth() + 1}/${c.getDate()}` };
    const a = new Date(c.getFullYear(), c.getMonth(), 1), b = new Date(c.getFullYear(), c.getMonth() + 1, 0);
    return { from: ymd(a), to: ymd(b), label: `${c.getMonth() + 1}월` };
}
export const inRange = (date, r) => { const d = String(date || '').slice(0, 10); return !!d && d >= r.from && d <= r.to; };

//  칩 상태 — 취소(C-c, 할 일 status='취소') / 완료(건너뜀 포함) / 지연(날짜가 오늘 전인데 안 끝남) / 보통
//  고정 루틴은 지연 표시 안 함 — 매일 반복이라 체크 안 한 지난 날이 전부 빨갛게 덮인다(마감 있는 일만 지연)
export function chipState(x, today) {
    if (x.done) return x.cancelled ? 'cancel' : (x.skipped ? 'skip' : 'done');
    if (x.kind === 'routine') return '';
    const d = String(x.date || '').slice(0, 10);
    return d && d < today ? 'late' : '';
}

//  날짜를 여기서 붙일 수 있는 것 = 기존 저장 경로가 있는 것만 (setRemDue: reminders · todos · 메모/제품/거래처 체크줄)
export const ASSIGNABLE = new Set(['rem', 'todo', 'note', 'item', 'vendor']);
export function undatedList(all) {
    return all.filter(x => !x.date && !x.done && ASSIGNABLE.has(x.kind) && x.sid != null && x.sid !== '');
}
