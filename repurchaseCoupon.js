//  재구매 쿠폰 1-A — 화면 쪽 순수 함수 (기획 v2: .work/재구매쿠폰/기획.md, DB: 103_repurchase_coupon.sql)
//
//  규칙·회차 상태 이름, 다음 실행 계산(DB coupon_next_run 과 같은 답), CSV 만들기, 업로드 결과 파일에서 회원 ID 뽑기.
//  발급·문자·메일은 없다. 'issued' 는 서버 coupon_run_confirm_manual 만 만든다 — 여기서는 숫자를 보여 줄 뿐.

export const KST = 9 * 3600e3;
const DAY = 864e5;

export const PRESETS = [
    ['first30', '첫구매 30일', '첫 구매 뒤 30~89일 재구매 없음'],
    ['dormant90', '휴면 90일', '마지막 구매 후 90~179일'],
    ['dormant180', '휴면 180일', '마지막 구매 후 180일 이상'],
    ['vip_risk', 'VIP 이탈 위험', '누적 상위 10% · 평소 주기 2배 경과'],
];
export const RULE_STATUS = { draft: '초안', active: '운영중', paused: '일시중지', archived: '보관' };
export const RUN_STATUS = {
    awaiting_approval: '승인 대기', needs_review: '확인 필요', rejected: '거절', expired: '만료',
    approved_for_export: '내보내기 승인', exported: '내보냄', export_expired: '확인 전 만료',
    approved: '발급 승인', issuing: '발급 중', blocked: '막힘',
    done: '완료', partial: '일부 완료', failed: '실패', cancelled: '중지',
};
export const EXCLUDE_REASON = {
    recent_order: '최근 7일 주문', open_cs: '진행 중 CS', shared_phone: '번호 공유 회원',
    cooldown: '같은 규칙 쿨다운', global_gap: '다른 규칙 14일 간격', other_rule: '우선 규칙에 들어감',
};
export const WEEKDAYS = ['', '월', '화', '수', '목', '금', '토', '일'];   // ISO 1=월 … 7=일
export const DEFAULT_RULE = {
    name: '', brand_id: '', target: { preset: 'dormant90' },
    coupon: { cafe24_coupon_no: '', memo: '', max_discount: null, valid_days: 7 },
    schedule: { freq: 'weekly', weekday: 1, monthday: 1, every_days: 14, time_kst: '10:00', start_date: '', end_date: '' },
    control_pct: 10, cooldown_days: 90, max_targets: 500, priority: 100,
};

//  KST 날짜·시각 도우미 — Date 는 UTC 로 다루고 9시간을 더해 KST '벽시계'를 읽는다
const kstWall = t => new Date(t.getTime() + KST);
const ymdUTC = d => d.toISOString().slice(0, 10);
export const kstDate = t => ymdUTC(kstWall(t));
const atKST = (ymd, hm) => new Date(Date.parse(`${ymd}T${hm}:00Z`) - KST);
const addDays = (ymd, n) => ymdUTC(new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY));
const isoDow = ymd => { const d = new Date(`${ymd}T00:00:00Z`).getUTCDay(); return d === 0 ? 7 : d; };
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

//  다음 실행: after 보다 '뒤' 첫 시각(Date). 없는 날(31일 등)은 그달 말일. 종료일 넘으면 null. — SQL coupon_next_run 과 같다.
export function nextRunAt(s, after) {
    const hm = /^([01]\d|2[0-3]):[0-5]\d$/.test(s?.time_kst || '') ? s.time_kst : '10:00';
    let base = kstDate(after);
    const sd = s?.start_date || null, ed = s?.end_date || null;
    if (sd && sd > base) base = sd;
    let ts = null;
    if (s?.freq === 'weekly') {
        for (let i = 0; i <= 7 && !ts; i++) {
            const d = addDays(base, i);
            if (isoDow(d) === Number(s.weekday)) { const t = atKST(d, hm); if (t > after) ts = t; }
        }
    } else if (s?.freq === 'monthly') {
        const [y, m] = base.split('-').map(Number), md = Number(s.monthday);
        for (let i = 0; i <= 13 && !ts; i++) {
            const first = new Date(Date.UTC(y, m - 1 + i, 1)), last = new Date(Date.UTC(y, m + i, 0)).getUTCDate();
            const d = ymdUTC(new Date(first.getTime() + (Math.min(md, last) - 1) * DAY));
            const t = atKST(d, hm);
            if (t > after && (!sd || d >= sd)) ts = t;
        }
    } else if (s?.freq === 'every_n') {
        const n = Number(s.every_days);
        if (!(n >= 1)) return null;
        const start = sd || base;
        let k = Math.max(0, Math.trunc(daysBetween(start, base) / n) - 1);
        for (;; k++) { const t = atKST(addDays(start, k * n), hm); if (t > after) { ts = t; break; } }
    } else return null;
    if (!ts) return null;
    if (ed && kstDate(ts) > ed) return null;
    return ts;
}

export function fmtKST(t, withYear = false) {
    if (!t) return '—';
    const d = kstWall(t instanceof Date ? t : new Date(t));
    const p = n => String(n).padStart(2, '0');
    const dow = WEEKDAYS[d.getUTCDay() === 0 ? 7 : d.getUTCDay()];
    return `${withYear ? d.getUTCFullYear() + '/' : ''}${d.getUTCMonth() + 1}/${d.getUTCDate()}(${dow}) ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

export function describeSchedule(s) {
    const t = s?.time_kst || '10:00';
    if (s?.freq === 'weekly') return `매주 ${WEEKDAYS[Number(s.weekday)] || '?'}요일 ${t}`;
    if (s?.freq === 'monthly') return `매월 ${s.monthday}일 ${t}${Number(s.monthday) >= 29 ? ' (없는 달은 말일)' : ''}`;
    if (s?.freq === 'every_n') return `${s.every_days}일마다 ${t}`;
    return '주기 없음';
}

export function describeTarget(t) {
    const p = PRESETS.find(x => x[0] === t?.preset);
    const extra = [];
    if (t?.gone_min != null || t?.gone_max != null) extra.push(`경과 ${t.gone_min ?? 0}~${t.gone_max ?? '∞'}일`);
    if (t?.orders_min != null || t?.orders_max != null) extra.push(`구매 ${t.orders_min ?? 1}~${t.orders_max ?? '∞'}회`);
    if (t?.spend_min != null) extra.push(`누적 ${Number(t.spend_min).toLocaleString()}원 이상`);
    return [p ? p[1] : '직접 조건', ...extra].join(' · ');
}

//  저장 전 화면 검사 — 서버(_coupon_check_rule)도 같은 검사를 한다. 첫 오류 문장만 돌려준다.
export function validateRule(r) {
    if (!String(r?.name || '').trim()) return '규칙 이름을 넣어 주세요';
    if (!r?.brand_id) return '브랜드를 고르세요';
    const t = r.target || {};
    if (!t.preset && !['gone_min', 'gone_max', 'orders_min', 'orders_max', 'spend_min'].some(k => t[k] != null)) return '대상(묶음 또는 직접 조건)을 정해 주세요';
    if (!String(r.coupon?.cafe24_coupon_no || '').trim()) return '카페24 쿠폰 번호를 넣어 주세요';
    const s = r.schedule || {};
    if (!['weekly', 'monthly', 'every_n'].includes(s.freq)) return '주기를 고르세요';
    if (s.freq === 'weekly' && !(Number(s.weekday) >= 1 && Number(s.weekday) <= 7)) return '요일을 고르세요';
    if (s.freq === 'monthly' && !(Number(s.monthday) >= 1 && Number(s.monthday) <= 31)) return '날짜(1~31)를 넣어 주세요';
    if (s.freq === 'every_n' && !(Number(s.every_days) >= 1)) return 'N일마다의 N을 넣어 주세요';
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time_kst || '')) return '시각은 HH:MM';
    if (!(Number(r.control_pct) >= 0 && Number(r.control_pct) <= 50)) return '대조군은 0~50%';
    if (!(Number(r.max_targets) >= 1)) return '회차 최대 인원은 1명 이상';
    return null;
}

//  CSV — 회원 ID 한 칸만(전화·이메일 없음). 엑셀 한글 깨짐 막는 BOM 은 내려받을 때 붙인다.
export function exportCSV(memberIds) {
    return ['회원ID', ...memberIds.map(id => `"${String(id).replace(/"/g, '""')}"`)].join('\r\n');
}

//  카페24 발급 결과 파일(CSV·TXT)에서 회원 ID 뽑기. 머리글에 '회원'/'member'/'아이디'/'id' 가 있으면 그 칸, 없으면 첫 칸.
export function parseMemberIds(text) {
    const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) return [];
    const split = l => l.split(/[,\t]/).map(c => c.trim().replace(/^"|"$/g, '').replace(/""/g, '"'));
    const head = split(lines[0]);
    let col = head.findIndex(h => /회원\s*아이디|회원\s*ID|member_?id|아이디|^id$/i.test(h));
    const hasHead = col >= 0 || head.some(h => /회원|아이디|member|id|이름|쿠폰/i.test(h));
    if (col < 0) col = 0;
    const ids = (hasHead ? lines.slice(1) : lines).map(l => split(l)[col]).filter(Boolean);
    return [...new Set(ids)];
}

//  회차 상세에서 누를 수 있는 것 — 서버도 같은 상태 검사를 한다(버튼 가리기용)
export function runActions(status, isMaster) {
    if (!isMaster) return [];
    return ({
        awaiting_approval: ['approve', 'reject', 'cancel'],
        needs_review: ['reject', 'cancel'],
        approved_for_export: ['export', 'cancel'],
        exported: ['export', 'confirm', 'cancel'],
        export_expired: ['confirm'],
    })[status] || [];
}

//  복귀율 비교 — 회차 4번 이상, 매번 발송군이 높을 때만 '효과 있음'. 그 전에는 '측정 중'.
export function effectVerdict(results) {
    const done = (results || []).filter(r => r.issued_n > 0 && r.control_n > 0);
    const rate = (a, b) => (b ? a / b : 0);
    const diffs = done.map(r => rate(r.treat_returned, r.issued_n) - rate(r.control_returned, r.control_n));
    if (done.length < 4) return { label: '복귀율 비교(측정 중)', rounds: done.length, effect: null };
    const same = diffs.every(d => d > 0);
    return { label: same ? '효과 있음(발송군 복귀율이 매회 높음)' : '효과 불분명(회차마다 방향이 다름)', rounds: done.length, effect: same };
}
