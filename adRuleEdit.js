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
