//  CS 처리상태(123) — 전체 상태 접수/처리중/완료 + 단계 4칸(서로 독립) + 담당·다음 처리일·배송비 부담.
//  서버(123 트리거)와 같은 규칙. 기획: .work/개선요청/CS상태-기획.md
export const CS_STATUSES = ['접수', '처리중', '완료'];
export const LEGACY_STATUS = ['수거접수', '수거완료'];
export const STAGES = [
    { k: 'pickup_stage', c: 'pickup', label: '수거', opts: ['대기', '수거접수', '수거완료', '해당없음'] },
    { k: 'inspect_stage', c: 'inspect', label: '검품', opts: ['대기', '정상', '하자', '해당없음'] },
    { k: 'reship_stage', c: 'reship', label: '교환출고', opts: ['대기', '선출고', '출고완료', '해당없음'] },
    { k: 'refund_stage', c: 'refund', label: '환불', opts: ['대기', '환불완료', '해당없음'] },
];
export const FEE_PAYERS = ['미정', '고객', '회사'];
const KINDS = ['교환', '반품', '오배송', '불량', '수선'];
const IDLE = ['대기', '해당없음'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const stageDefault = (kind, c) => {
    if (!KINDS.includes(kind)) return '해당없음';
    if (c === 'reship') return kind === '반품' ? '해당없음' : '대기';
    if (c === 'refund') return kind === '반품' ? '대기' : '해당없음';
    return '대기';
};
//  DB 에 123 이 깔렸나(칸이 행에 있나) — 깔리기 전이면 단계 화면을 숨기고 옛 상태 그대로
export const hasStages = t => !!t && Object.prototype.hasOwnProperty.call(t, 'pickup_stage');
//  옛 값(수거접수/수거완료)은 화면에서 처리중으로 읽는다 — 수거 단계가 비었으면 그 값으로 본다
export const viewStatus = t => (LEGACY_STATUS.includes(t?.status) ? '처리중' : (t?.status || '접수'));
export const stageOf = (t, s) => (s.k === 'pickup_stage' && LEGACY_STATUS.includes(t?.status) && !t?.pickup_stage) ? t.status : (t?.[s.k] ?? null);
//  아직 '대기'인 단계 이름(완료 확인용)
export const remaining = t => STAGES.filter(s => stageOf(t, s) === '대기').map(s => s.label);
//  목록 한 줄: 진행된 값 · 남은 단계. 단계 기록 없는 이관 전 완료건은 빈 문자열
export const stageLine = t => {
    const done = STAGES.map(s => stageOf(t, s)).filter(v => v && !IDLE.includes(v));
    const rem = remaining(t);
    return [done.join(' · '), rem.length ? `${rem.join('·')} 대기` : ''].filter(Boolean).join(' · ');
};
export const overdue = (t, today) => viewStatus(t) !== '완료' && !!t?.next_action_on && String(t.next_action_on).slice(0, 10) < today;

//  화면에서 고칠 수 있는 칸만, 허용된 값만. 아니면 null. 서버 ④ 규칙(단계가 움직이면 접수→처리중)을 미리 반영
export const fieldPatch = (t, field, value) => {
    const s = STAGES.find(x => x.k === field);
    let v = value === '' || value == null ? null : String(value).trim();
    if (s) { if (!s.opts.includes(v)) return null; }
    else if (field === 'ship_fee_payer') { if (!FEE_PAYERS.includes(v)) return null; }
    else if (field === 'assignee_id') { if (v && !UUID.test(v)) return null; }
    else if (field === 'next_action_on') { if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null; }
    else return null;
    const patch = { [field]: v };
    if (s && !IDLE.includes(v) && viewStatus(t) === '접수') patch.status = '처리중';
    return patch;
};

//  담당 고르기 — 값은 직원 id(companies.id), 글자는 이름. 같은 이름이 둘 이상이면 아이디를 붙여 구분.
//  지금 담당이 목록에 없으면(퇴사·권한 변경) 서버가 찍어 둔 이름으로 한 줄 남긴다.
//  직원 행이 지워져 id 가 비고 이름 사본만 남은 건은 '미지정' 자리에 옛 담당을 읽기로 보이고, 새 담당은 고를 수 있다.
export const staffOptions = (companies, t) => {
    const staff = (companies || []).filter(c => c && c.id && c.role && c.role !== 'CLIENT');
    const cnt = {}; for (const c of staff) cnt[c.name] = (cnt[c.name] || 0) + 1;
    const opts = staff.map(c => ({ v: String(c.id), label: cnt[c.name] > 1 ? `${c.name} (${c.username || String(c.id).slice(0, 4)})` : c.name }));
    if (t?.assignee_id && !opts.some(o => o.v === String(t.assignee_id))) opts.push({ v: String(t.assignee_id), label: `${t.assignee_name || '담당'} (목록에 없음)` });
    const none = !t?.assignee_id && t?.assignee_name ? `전 담당 ${t.assignee_name}(퇴사)` : '미지정';
    return [{ v: '', label: none }, ...opts];
};
//  목록·검색에 쓸 담당 이름 — 지금 이름 우선, 없으면 서버 사본. 직원이 지워져 id 만 빈 건은 사본 + (퇴사·목록에 없음)
export const assigneeLabel = (companies, t) => {
    if (!t?.assignee_id) return t?.assignee_name ? `${t.assignee_name} (퇴사·목록에 없음)` : '';
    const c = (companies || []).find(x => String(x.id) === String(t.assignee_id));
    return c?.name || t.assignee_name || '';
};
