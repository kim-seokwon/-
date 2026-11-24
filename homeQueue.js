//  ① 홈 — '오늘 처리할 일'(미처리 업무)과 '이번 달 실적'을 나눈다 (순수 함수)
//  미처리 = 지금 누가 손대야 끝나는 일(출고 전 주문·열린 CS·환불 대기·지난/오늘 할 일·납기 지난 생산).
//  실적 = 이미 끝난 결과(매출·환불 완료·교환 접수). 두 개를 한 칸에 섞지 않는다.
import { hasStages, viewStatus, stageOf, STAGES, assigneeLabel } from './csStages.js';

const DAY = 86400000;
const ymd = d => (d ? String(d).slice(0, 10) : '');
//  두 날짜(YYYY-MM-DD) 사이 일수 — b - a
export function daysBetween(a, b) {
    if (!a || !b) return null;
    const x = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10));
    const y = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10));
    return Math.round((y - x) / DAY);
}
//  '지연37' 대신 사람이 읽는 말
export const dueLabel = dd => dd == null ? '날짜 없음' : dd < 0 ? `${-dd}일 지남` : dd === 0 ? '오늘까지' : `${dd}일 남음`;
export const ageLabel = n => n == null ? '' : n <= 0 ? '오늘 접수' : `${n}일째`;
//  '27SS · 기본 페이지' — 시즌을 만들 때 자동으로 생기는 시즌 개요 메모다
export const taskTitle = t => String(t || '').replace(/\s*·\s*기본 페이지$/, ' · 시즌 개요 메모');

const REFUND = STAGES.find(s => s.c === 'refund');
//  환불 대기 = 아직 돈을 돌려주지 않은 열린 CS. 123 전(단계 칸 없음)은 반품 접수 중인 건으로 대신 센다.
export function isRefundWaiting(t) {
    if (!t || viewStatus(t) === '완료') return false;
    if (hasStages(t) || (t.refund_stage != null)) return stageOf(t, REFUND) === '대기';
    return t.kind === '반품';
}

//  열린 CS 나눔 — 교환·반품 처리 중(환불 대기 뺌) / 환불 대기 / 그 외(오배송·불량·수선·기타) 처리 중. 합 = 열린 CS 전체.
export function csOpenBreakdown(cs) {
    const open = (cs || []).filter(t => viewStatus(t) !== '완료');
    const out = { open: open.length, exRet: 0, refund: 0, other: 0 };
    open.forEach(t => {
        if (isRefundWaiting(t)) out.refund++;
        else if (t.kind === '교환' || t.kind === '반품') out.exRet++;
        else out.other++;
    });
    return out;
}

//  오늘 처리할 일 — [{ grp, title, owner, age, due, dd, go }] 급한 순(지난 것 → 오늘 → 접수 오래된 것)
//  today: 'YYYY-MM-DD'(한국 시각)
export function todayQueue({ today, cs = [], companies = [], preOrders = [], preCount, tasks = [], jobs = [] } = {}) {
    const out = [];
    (cs || []).filter(t => viewStatus(t) !== '완료').forEach(t => {
        const due = ymd(t.next_action_on);
        out.push({
            grp: isRefundWaiting(t) ? '환불 대기' : 'CS',
            title: [t.kind || 'CS', t.customer_name, t.product_name].filter(Boolean).join(' · ') || (t.order_no || 'CS'),
            owner: assigneeLabel(companies, t) || '미지정',
            age: daysBetween(ymd(t.occurred_on || t.created_at), today),
            due, dd: due ? daysBetween(today, due) : null,
            go: `app.findGo('cs','${String(t.id).replace(/'/g, '')}')`,
        });
    });
    const pre = preOrders || [];
    const n = preCount != null ? preCount : pre.length;
    if (n > 0) {
        const oldest = pre.map(o => ymd(o.order_date)).filter(Boolean).sort()[0] || '';
        out.push({ grp: '출고', title: `배송 전 주문 ${n.toLocaleString()}건 — 송장 발번·출고`, owner: '미지정',
            age: oldest ? daysBetween(oldest, today) : null, due: '', dd: null, go: "app.switchView('orders')", agePrefix: '가장 오래된 주문 ' });
    }
    (tasks || []).filter(x => !x.done && !x.cancelled && x.date && ymd(x.date) <= today).forEach(x => {
        const due = ymd(x.date);
        out.push({ grp: x.tag || '할 일', title: taskTitle(x.title) + (x.sub ? ` · ${x.sub}` : ''), owner: x.owner || '미지정',
            age: null, due, dd: daysBetween(today, due), go: x.go || `app.switchView('${x.view || 'reminders'}')` });
    });
    (jobs || []).filter(j => j.status !== 'done' && j.due_date && ymd(j.due_date) <= today).forEach(j => {
        const due = ymd(j.due_date);
        out.push({ grp: '생산', title: `${j.title || '작업'} · ${j._v || ''}`.replace(/ · $/, ''), owner: j.manager || j._v || '미지정',
            age: null, due, dd: daysBetween(today, due), go: j.go || "app.switchView('vendors')" });
    });
    const urg = r => r.dd != null ? r.dd : (r.age != null ? -r.age / 1000 : 1);
    return out.sort((a, b) => urg(a) - urg(b));
}

//  묶음 요약(헤더 칩): 그룹별 건수
export function queueCounts(rows) {
    const c = {}; (rows || []).forEach(r => { c[r.grp] = (c[r.grp] || 0) + 1; }); return c;
}
