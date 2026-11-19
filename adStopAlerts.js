//  광고 중단선 알림 규칙 — 11-18 사장님 '하루 11만원 낭비'(중단선 넘은 광고가 1~3일 더 돌아 113,789원) 재발방지.
//   판정은 화면과 똑같이 adPanel.buildPanel(period 'three' = 최근 3일, 어제까지) + ad_report_rules 행(없으면 화면과 같은 기본값).
//   보낼 대상 = 판정 '중단' 이면서 세트 아래 광고 중 effective_status=ACTIVE 1개 이상. 광고를 끄지는 않는다(알림만).
//   한 번 알린 세트(ad_stop_alert, 121)는 대상에서 빠질 때(판정이 바뀌거나 꺼짐)까지 다시 안 보낸다. 빠지면 기록을 지워 다음에 다시 걸리면 또 알린다.
import { buildPanel } from './adPanel.js';
import { kstDay, addDays } from './adReport.js';

//  화면(main.js _snsData)의 defaultRule 과 같은 값 — 판정선 행이 없는 새 브랜드만 쓴다
export const DEFAULT_RULE = { test_daily_budget: 10000, min_days: 2, min_spend: 10000, up_max: 1000, stop_over: 1600, early_mult: 2 };
export const DAILY_DAYS = 9;   // 최근 3일 판정 + '최근 7일 지출' 숨김 판단에 충분

export function rulesByBrand(brands = [], rules = []) {
    return Object.fromEntries(brands.map(b => [b.id, { ...DEFAULT_RULE, ...(rules.find(x => String(x.brand_id) === String(b.id)) || {}) }]));
}

//  보낼 대상 산출 — 중단 + 켜진 광고가 있는 세트만
export function stopTargets({ links = [], daily = [], rules = [], brands = [], now = Date.now() } = {}) {
    const rulesBy = rulesByBrand(brands, rules);
    const panelBrands = brands.map(b => ({ ...b, ad_prefixes: rulesBy[b.id]?.ad_prefixes || [] }));
    const groups = buildPanel({ links, daily, rulesBy, brands: panelBrands, period: 'three', now });
    //  '켜짐' = 세트 아래 광고 중 effective_status=ACTIVE 가 1개 이상(광고 effective 는 세트·캠페인이 꺼지면 ADSET_PAUSED 등이 된다).
    //   세트 상태만 보면 광고만 끈 세트(세트 ACTIVE·광고 전부 PAUSED, 지출 0)를 잘못 잡는다(팀장 반려 11-19: 10개 중 7개 오탐).
    const live = new Set(links.filter(l => !l.excluded && l.effective_status === 'ACTIVE').map(l => String(l.adset_id || 'ad:' + l.ad_id)));
    const out = [];
    for (const g of groups) for (const s of g.sets) {
        if (s.kind !== 'stop' || !live.has(String(s.adset_id))) continue;
        out.push({ adset_id: String(s.adset_id), brand_id: g.brand_id || null, brand: g.name, name: s.name,
            cpf: s.cpf3, spend3: s.spend3, follows3: s.follows3, stop_over: Number(g.rules?.stop_over) || null, spendYesterday: s.spendYesterday });
    }
    return out;
}

//  sent = ad_stop_alert 행들 → fresh(새로 알릴 것) · cleared(대상에서 빠져 기록을 지울 것) · already(알렸고 아직 대상)
export function diffAlerts(targets = [], sent = []) {
    const was = new Set(sent.map(r => String(r.adset_id))), now = new Set(targets.map(t => t.adset_id));
    return {
        fresh: targets.filter(t => !was.has(t.adset_id)),
        already: targets.filter(t => was.has(t.adset_id)),
        cleared: [...was].filter(id => !now.has(id)),
    };
}

const won = n => `${Math.round(Number(n) || 0).toLocaleString('ko-KR')}원`;
export function alertText(list = [], day, md = s => String(s ?? '')) {
    if (!list.length) return '';
    const L = [`🔴 *광고 중단선 넘음* (${day} 기준 최근 3일) — ${list.length}개 세트가 아직 켜져 있습니다`, ''];
    for (const t of list) {
        L.push(`• ${md(t.brand)} · ${md(t.name)}`);
        L.push(`  팔로워당 ${t.cpf == null ? `팔로우 0 (3일 ${won(t.spend3)})` : won(t.cpf)} · 중단선 ${t.stop_over ? won(t.stop_over) : '미확인'} · 어제 지출 ${won(t.spendYesterday)}`);
    }
    L.push('', '광고는 자동으로 끄지 않았습니다. 메타 광고관리자에서 확인 후 꺼 주세요.');
    return L.join('\n');
}

export { kstDay, addDays };
