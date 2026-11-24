//  광고 판정선 수정(116) — 화면용 순수 함수. 저장은 RPC set_ad_report_rule 만 쓴다(표 직접 update 없음).
//  판정 계산은 adPanel.buildPanel/panelVerdict 를 그대로 다시 돌려 '바뀌면 판정이 이렇게 달라짐'을 센다.
import { buildPanel, PANEL_VERDICT } from './adPanel.js';

export const DEFAULT_RULE = { test_daily_budget: 10000, min_days: 2, min_spend: 10000, up_max: 1000, stop_over: 1600, early_mult: 2 };
export const EDIT_FIELDS = ['up_max', 'stop_over', 'min_days', 'min_spend'];
const int = v => (v === '' || v == null ? NaN : Number(String(v).replace(/[,\s원]/g, '')));

//  입력값(문자열 가능) → { ok, value, errors:{field: msg} }. RPC 검증과 같은 규칙.
export function validateRule(input, base = DEFAULT_RULE) {
    const v = {}, errors = {};
    for (const k of EDIT_FIELDS) {
        const raw = input?.[k] ?? base?.[k] ?? DEFAULT_RULE[k];
        const n = int(raw);
        if (!Number.isInteger(n)) errors[k] = '숫자만';
        v[k] = n;
    }
    if (!errors.up_max && v.up_max <= 0) errors.up_max = '0보다 커야 합니다';
    if (!errors.up_max && !errors.stop_over && v.up_max >= v.stop_over) errors.stop_over = '증액선보다 커야 합니다';
    if (!errors.min_days && v.min_days < 1) errors.min_days = '1일 이상';
    if (!errors.min_spend && v.min_spend < 0) errors.min_spend = '0 이상';
    return { ok: !Object.keys(errors).length, value: v, errors };
}
export const ruleChanged = (cur, next) => EDIT_FIELDS.some(k => Number(cur?.[k] ?? DEFAULT_RULE[k]) !== Number(next?.[k]));

//  현재 진행(ACTIVE) 세트 중 판정이 바뀌는 수 — 같은 기간(period)·같은 데이터로 두 번 계산해 비교
//  반환 { total, changed, moves: [{from, to, n}] , text }
export function ruleImpact({ links = [], daily = [], brands = [], rulesBy = {}, brandId, next, period = 'three', now = Date.now() }) {
    const key = String(brandId);
    const before = buildPanel({ links, daily, rulesBy, brands, period, now });
    const after = buildPanel({ links, daily, rulesBy: { ...rulesBy, [key]: { ...(rulesBy[key] || DEFAULT_RULE), ...next } }, brands, period, now });
    const kinds = groups => new Map(groups.filter(g => String(g.brand_id) === key).flatMap(g => g.sets).filter(s => s.status === 'ACTIVE').map(s => [s.adset_id, s.kind]));
    const a = kinds(before), b = kinds(after), moves = {};
    for (const [id, k] of a) { const k2 = b.get(id); if (k2 && k2 !== k) moves[`${k}>${k2}`] = (moves[`${k}>${k2}`] || 0) + 1; }
    const list = Object.entries(moves).map(([m, n]) => { const [from, to] = m.split('>'); return { from, to, n }; });
    const changed = list.reduce((s, x) => s + x.n, 0);
    const lbl = k => PANEL_VERDICT[k]?.label || k;
    const text = !a.size ? '지금 진행 중인 광고가 없어 판정이 바뀌는 광고는 없습니다'
        : !changed ? `진행 중 ${a.size}개 중 판정이 바뀌는 광고 없음`
        : `진행 중 ${a.size}개 중 ${changed}개 판정이 바뀜 · ${list.map(x => `${lbl(x.from)}→${lbl(x.to)} ${x.n}`).join(' · ')}`;
    return { total: a.size, changed, moves: list, text };
}

//  표 머리용 한 줄 — '증액 ≤1,000 · 유지 ≤1,300'
export const ruleLine = r => r ? `증액 ≤${Number(r.up_max).toLocaleString('ko-KR')} · 유지 ≤${Number(r.stop_over).toLocaleString('ko-KR')}` : '';

//  RPC 오류 → 사람 말
export function saveErrorText(err) {
    const m = String(err?.message || err || '');
    if (err?.code === '42501' || /조직 관리자만|permission denied/.test(m)) return '판정선은 조직 관리자만 바꿀 수 있습니다';
    if (err?.code === 'PGRST202' || /set_ad_report_rule/.test(m) && /not find|does not exist/.test(m)) return '저장 기능이 아직 서버에 없습니다(116 적용 전)';
    if (/증액선|최소 일수|최소 지출|브랜드가 없습니다/.test(m)) return m;
    return '저장하지 못했습니다 · 잠시 뒤 다시 시도해 주세요';
}

//  30 광고 판정 기준 — 항목 이름·단위·뜻·예시(화면에 내부 변수명 대신 보인다). edit = 이 화면에서 바꿀 수 있는지
export const RULE_FIELDS = [
    { k: 'up_max', name: '증액선', unit: '원', per: '팔로워 1명당 광고비', edit: true,
      desc: '팔로워 1명을 이 금액 이하로 얻으면 예산을 늘릴 광고로 봅니다', ex: '1,000 → 1명에 1,000원 이하면 증액' },
    { k: 'stop_over', name: '유지선', unit: '원', per: '팔로워 1명당 광고비', edit: true,
      desc: '증액선과 이 금액 사이면 유지, 넘으면 중단 후보입니다', ex: '1,600 → 1명에 1,600원 넘으면 중단' },
    { k: 'min_days', name: '최소 일수', unit: '일', edit: true,
      desc: '이만큼 돌기 전에는 판정하지 않고 지켜봅니다', ex: '2 → 이틀은 돌린 뒤 판정' },
    { k: 'min_spend', name: '최소 지출', unit: '원', edit: true,
      desc: '이만큼 쓰기 전에는 판정하지 않고 지켜봅니다', ex: '10,000 → 1만 원은 쓴 뒤 판정' },
    { k: 'test_daily_budget', name: '테스트 하루 예산', unit: '원', edit: false,
      desc: '새 광고를 시험할 때 하루 예산 — 첫날 조기 중단 판단에 씁니다', ex: '10,000 → 하루 1만 원' },
    { k: 'early_mult', name: '첫날 조기 중단 배수', unit: '배', edit: false,
      desc: '첫날 하루 예산을 다 쓰고 팔로워가 0이거나 1명당 광고비가 유지선 × 배수를 넘으면 조기 중단 표시', ex: '2 → 유지선 1,600이면 3,200원 넘을 때' },
];
const FIELD = Object.fromEntries(RULE_FIELDS.map(f => [f.k, f]));
export const fieldValueText = (k, v) => {
    const f = FIELD[k]; if (v == null || v === '') return '-';
    return f?.unit === '배' ? `×${v}` : `${Number(v).toLocaleString('ko-KR')}${f?.unit || ''}`;
};

//  변경 기록(ad_report_rule_log) 한 줄 → 사람 말. before 가 없으면 처음 저장(그 전엔 기본값).
export function logChange(row) {
    const b = { ...DEFAULT_RULE, ...(row?.before || {}) }, a = { ...b, ...(row?.after || {}) };
    const parts = EDIT_FIELDS.filter(k => Number(b[k]) !== Number(a[k]))
        .map(k => `${FIELD[k].name} ${fieldValueText(k, b[k])} → ${fieldValueText(k, a[k])}`);
    return { first: !row?.before, text: parts.join(' · ') || '값 변화 없음', undo: Object.fromEntries(EDIT_FIELDS.map(k => [k, Number(b[k])])) };
}
//  되돌리기 가능 = 그 브랜드의 가장 최근 기록이고, 지금 값이 그 기록의 '바꾼 뒤'와 같을 때만
//  (그 뒤에 또 바뀌었는데 옛 기록을 되돌리면 나중 변경까지 조용히 지워진다)
export function undoableIds(log, rulesByBrand) {
    const seen = new Set(), ok = new Set();
    for (const r of [...(log || [])].sort((x, y) => String(y.changed_at).localeCompare(String(x.changed_at)))) {
        const bid = String(r.brand_id);
        if (seen.has(bid)) continue;
        seen.add(bid);
        const cur = { ...DEFAULT_RULE, ...(rulesByBrand?.[bid] || {}) }, aft = { ...DEFAULT_RULE, ...(r.before || {}), ...(r.after || {}) };
        if (EDIT_FIELDS.every(k => Number(cur[k]) === Number(aft[k]))) ok.add(r.id);
    }
    return ok;
}
