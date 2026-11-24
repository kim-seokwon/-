//  ⑪ 지출 — 법인/귀속 분리 · 처리 상태 · 조회 월 (순수 함수)
//  서버 134: entity(결제 법인) · brand_id(귀속 브랜드) · category · pay_method · vat · evidence · status.
//  company 는 옛 칸 그대로 '귀속(브랜드·사업부)'으로 읽는다.

export const EXP_STATUSES = ['확인 필요', '증빙 대기', '지급 대기', '완료'];
export const EXP_CATEGORIES = ['원부자재', '생산·가공', '물류·퀵', '광고·마케팅', '촬영·모델', '외주·용역', '식대', '교통·주차', '소모품', '수수료', '기타'];
export const EXP_PAY_METHODS = ['법인카드', '개인카드(정산)', '계좌이체', '현금', '기타'];
export const EXP_EVIDENCE = ['세금계산서', '카드전표', '현금영수증', '간이영수증', '증빙 없음'];

//  134 적용 여부 — 행에 status 키가 있으면 새 칸을 쓴다(없으면 옛 화면처럼 done 만)
export const expHasFields = list => (list || []).some(e => e && 'status' in e);

//  처리 상태 — 134 전 행은 done 으로 대신한다
export function expStatusOf(e) {
    if (!e) return '확인 필요';
    if (e.status && EXP_STATUSES.includes(e.status)) return e.status;
    return e.done ? '완료' : '확인 필요';
}

//  한국 시각 기준 이번 달 'YYYY-MM'
export function kstMonth(now = new Date()) {
    return new Date(now.getTime() + 9 * 3600e3).toISOString().slice(0, 7);
}
export function kstToday(now = new Date()) {
    return new Date(now.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
}

//  조회 월 목록 — 기록이 없어도 이번 달은 늘 맨 위
export function expMonths(list, now = new Date()) {
    const cur = kstMonth(now);
    return [...new Set([cur, ...(list || []).map(e => String(e.spent_on || '').slice(0, 7)).filter(Boolean)])].sort().reverse();
}

//  입력 날짜가 보고 있는 달과 다르면 어디에 저장되는지 알려준다
export function expDateNote(dateStr, month) {
    const m = String(dateStr || '').slice(0, 7);
    if (!m || !month || m === month) return '';
    return `${m}에 저장됩니다 (지금 보는 달: ${month})`;
}

//  법인 후보 — 지금 조직(list = 그 조직 지출만)에서 이미 쓴 값, 많이 쓴 순.
//  특정 회사 이름을 박아 두지 않는다(⑪ 반려1: 다른 조직 지출이 이일칠구로 오기록됨).
export function expEntities(list) {
    const cnt = {};
    (list || []).forEach(e => { const v = String(e?.entity || '').trim(); if (v) cnt[v] = (cnt[v] || 0) + 1; });
    return Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a] || a.localeCompare(b));
}
//  새 지출 기본 법인 — 그 조직에서 가장 많이 쓴 값, 없으면 null(법인 미지정)
export const expDefaultEntity = list => expEntities(list)[0] || null;

//  상태별 건수·금액 (오른쪽 요약)
export function expStatusSummary(list) {
    const out = EXP_STATUSES.map(s => ({ s, n: 0, amt: 0 }));
    (list || []).forEach(e => { const r = out.find(x => x.s === expStatusOf(e)); r.n++; r.amt += Number(e.amount) || 0; });
    return out;
}
