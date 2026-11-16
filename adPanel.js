//  광고 판정판 — 광고세트별 '인스타 팔로우 1명당 비용'으로 증액/유지/중단을 한눈에 (광고리포트 탭 맨 위 카드)
//   데이터: ad_links(광고→세트 메타) × ad_daily(광고×날짜 지출·팔로우) 를 세트로 합산. 판정선은 ad_report_rules 행에서만 읽는다.
//   방문당 비용·도달은 보여주지 않는다(사장님 지시 2026-11-16). 화면에 나가는 문자열은 전부 esc().
import { esc, won, kstDay, addDays } from './adReport.js';

const num = v => Number(v) || 0;
export const PANEL_VERDICT = {
    up: { label: '증액', color: '#059669', bg: 'rgba(5,150,105,.12)' },
    keep: { label: '유지', color: '#2563eb', bg: 'rgba(37,99,235,.12)' },
    stop: { label: '중단', color: '#dc2626', bg: 'rgba(220,38,38,.12)' },
    idle: { label: '집행 없음', color: '#64748b', bg: 'rgba(100,116,139,.12)' },
    none: { label: '판정선 없음', color: '#64748b', bg: 'rgba(100,116,139,.12)' },
};
//  브랜드 연결이 비어 있는 광고는 세트명 접두사로 찾는다(ad_links.brand_id 는 인스타 계정 연결이 있어야 채워짐)
export const PREFIX = [['hhh', '하이헤이호'], ['하헤호', '하이헤이호'], ['lohi', '로하이'], ['tovee', '토비']];

//  팔로우 0 = 1명당 무한대 → 중단. 지출도 0 이면 판정하지 않는다(그 기간 집행 없음).
export function panelVerdict(spend, follows, rules) {
    if (!rules) return 'none';
    if (num(spend) <= 0) return 'idle';
    if (num(follows) <= 0) return 'stop';
    const cpf = num(spend) / num(follows);
    return cpf <= num(rules.up_max) ? 'up' : cpf <= num(rules.stop_over) ? 'keep' : 'stop';
}
export const cpfOf = (spend, follows) => num(follows) > 0 ? Math.round(num(spend) / num(follows)) : null;

export function brandOfLink(l, brands = []) {
    if (l.brand_id) return l.brand_id;
    const name = String(l.adset_name || l.ad_name || '').toLowerCase();
    const hit = PREFIX.find(([p]) => name.startsWith(p.toLowerCase()));
    const b = hit && brands.find(b => String(b.name || '').replace(/\s/g, '').includes(hit[1]));
    return b ? b.id : null;
}

//  period: 'yesterday' = 어제(KST) 하루 · 'cum' = 세트 시작일(KST) ~ 어제
//  반환: [{ brand_id, name, rules, spend, follows, cpf, kind, sets: [{ adset_id, name, status, budget, end, spend, follows, cpf, kind }] }]
export function buildPanel({ links = [], daily = [], rulesBy = {}, brands = [], period = 'yesterday', now = Date.now() } = {}) {
    const yday = addDays(kstDay(now), -1);
    const sets = new Map(), adSet = new Map();
    for (const l of links) {
        const id = l.adset_id || 'ad:' + l.ad_id;
        adSet.set(String(l.ad_id), id);
        const s = sets.get(id) || { adset_id: id, name: l.adset_name || l.ad_name || l.ad_id, status: null, budget: null, start: null, end: null, brand_id: null, spend: 0, follows: 0, ads: 0 };
        s.ads++;
        //  세트 상태는 세트값 우선, 없으면 광고 상태 중 '진행'이 하나라도 있으면 진행
        const st = l.adset_status || l.effective_status;
        if (!s.status || st === 'ACTIVE') s.status = st;
        s.budget ??= l.daily_budget ?? null;
        s.start ??= l.adset_start ? kstDay(l.adset_start) : null;
        s.end ??= l.adset_end ? kstDay(l.adset_end) : null;
        s.brand_id ??= brandOfLink(l, brands);
        sets.set(id, s);
    }
    for (const d of daily) {
        const s = sets.get(adSet.get(String(d.ad_id)));
        if (!s || !d.day || d.day > yday) continue;                       // 오늘(진행 중)은 판정에 넣지 않는다
        if (d.day > addDays(yday, -7) && num(d.spend) > 0) s.recent = true;   // 최근 7일(어제까지) 지출 있음
        if (period === 'yesterday' ? d.day !== yday : (s.start && d.day < s.start)) continue;
        s.spend += num(d.spend); s.follows += num(d.follows);
    }
    const nameOf = id => (brands.find(b => b.id === id) || {}).name || '브랜드 미지정';
    const groups = new Map();
    for (const s of sets.values()) {
        if (s.status !== 'ACTIVE' && !s.recent) continue;                 // 꺼진 옛 세트 숨김: 진행 중이거나 최근 7일 지출이 있는 세트만(팀장 결정 11-16)
        if (s.spend <= 0 && s.status !== 'ACTIVE') continue;              // 그 기간 집행도 없고 꺼진 세트는 뺀다
        const g = groups.get(s.brand_id) || { brand_id: s.brand_id, name: nameOf(s.brand_id), rules: rulesBy[s.brand_id] || null, spend: 0, follows: 0, sets: [] };
        s.cpf = cpfOf(s.spend, s.follows); s.kind = panelVerdict(s.spend, s.follows, g.rules);
        g.spend += s.spend; g.follows += s.follows; g.sets.push(s);
        groups.set(s.brand_id, g);
    }
    //  1명당 오름차순 — 팔로우 0(무한대)은 지출 큰 순으로 그 아래, 집행 없음은 맨 아래
    const key = s => s.spend <= 0 ? [2, 0] : s.cpf == null ? [1, -s.spend] : [0, s.cpf];
    //  브랜드 순서 하이헤이호 → 로하이(스튜디오) → 토비 → 그 밖
    const rank = n => { const i = ['하이헤이호', '로하이', '토비'].findIndex(k => String(n || '').replace(/\s/g, '').includes(k)); return i < 0 ? 99 : i; };
    return [...groups.values()].map(g => {
        g.sets.sort((a, b) => { const x = key(a), y = key(b); return x[0] - y[0] || x[1] - y[1] || String(a.name).localeCompare(String(b.name)); });
        g.cpf = cpfOf(g.spend, g.follows); g.kind = panelVerdict(g.spend, g.follows, g.rules);
        return g;
    }).sort((a, b) => rank(a.name) - rank(b.name) || String(a.name).localeCompare(String(b.name)));
}

const STATUS = { ACTIVE: ['진행', '#059669'], PAUSED: ['꺼짐', '#64748b'], ADSET_PAUSED: ['꺼짐', '#64748b'], CAMPAIGN_PAUSED: ['캠페인 꺼짐', '#64748b'],
    PENDING_REVIEW: ['검토중', '#d97706'], WITH_ISSUES: ['문제', '#dc2626'], DISAPPROVED: ['거절', '#dc2626'], ARCHIVED: ['보관', '#64748b'], DELETED: ['삭제', '#64748b'] };
const md = d => d ? `${+d.slice(5, 7)}/${+d.slice(8, 10)}` : '—';
const badge = k => { const v = PANEL_VERDICT[k] || PANEL_VERDICT.none; return `<span class="ap-badge" style="color:${v.color};background:${v.bg}">${v.label}</span>`; };
const cpfTxt = (cpf, spend) => num(spend) <= 0 ? '—' : cpf == null ? '∞' : won(cpf) + '원';

export const AP_CSS = `<style>
.ap-wrap{padding:1.1rem;border-radius:18px;margin-bottom:1.3rem}
.ap-head{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}
.ap-title{font-size:1.02rem;font-weight:800}
.ap-tog{display:inline-flex;border:1px solid var(--card-border);border-radius:999px;padding:2px}
.ap-tog button{border:0;background:none;color:var(--text-muted);font-weight:700;font-size:.78rem;padding:5px 12px;border-radius:999px;cursor:pointer}
.ap-tog button.on{background:var(--text-main);color:var(--bg-card,#fff)}
.ap-sub{font-size:.7rem;color:var(--text-muted);margin:4px 2px 0}
.ap-brand{margin-top:14px;border:1px solid var(--card-border);border-radius:14px;overflow:hidden}
.ap-bh{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 12px;background:rgba(148,163,184,.08)}
.ap-bh b{font-size:.95rem}
.ap-bh .ap-tot{margin-left:auto;font-size:.78rem;color:var(--text-muted);font-variant-numeric:tabular-nums}
.ap-bh .ap-tot strong{color:var(--text-main);font-size:.92rem}
.ap-rule{font-size:.66rem;color:var(--text-muted)}
.ap-badge{display:inline-block;font-size:.72rem;font-weight:800;padding:2px 8px;border-radius:999px;white-space:nowrap}
.ap-t{width:100%;border-collapse:collapse;font-size:.8rem;font-variant-numeric:tabular-nums}
.ap-t th{font-size:.68rem;color:var(--text-muted);font-weight:700;text-align:right;padding:6px 8px;border-top:1px solid var(--card-border);white-space:nowrap}
.ap-t td{text-align:right;padding:7px 8px;border-top:1px solid var(--card-border);white-space:nowrap}
.ap-t th:first-child,.ap-t td:first-child{text-align:left}
.ap-t td.ap-n{max-width:240px;overflow:hidden;text-overflow:ellipsis;font-weight:600}
.ap-t td.ap-c{font-weight:800}
.ap-st{font-size:.7rem;font-weight:700}
.ap-t td.ap-m{display:none}
@media (max-width:640px){
  .ap-t thead{display:none}
  .ap-t,.ap-t tbody,.ap-t tr{display:block;width:100%}
  .ap-t tr{display:grid;grid-template-columns:1fr auto;gap:2px 10px;padding:9px 12px;border-top:1px solid var(--card-border)}
  .ap-t td{display:none;padding:0;background:none}
  .ap-wrap table.ap-t tbody tr td{border:0!important;box-shadow:none!important}
  .ap-t td.ap-n{display:block;max-width:none;white-space:normal;word-break:break-all}
  .ap-t td.ap-v{display:block;grid-row:1/span 2;grid-column:2;align-self:center}
  .ap-t td.ap-m{display:block;grid-column:1;font-size:.72rem;color:var(--text-muted);white-space:normal;text-align:left}
  .ap-t td.ap-m b{color:var(--text-main);font-size:.82rem}
}
.ap-sum{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-top:12px}
.ap-sum a{display:block;text-decoration:none;color:inherit;border:1px solid var(--card-border);border-radius:12px;padding:9px 11px;cursor:pointer}
.ap-sum .ap-sn{display:flex;justify-content:space-between;align-items:center;gap:6px;font-weight:800;font-size:.86rem}
.ap-sum .ap-sv{font-size:1.15rem;font-weight:800;font-variant-numeric:tabular-nums;margin-top:3px}
.ap-sum .ap-sc{font-size:.68rem;color:var(--text-muted);font-variant-numeric:tabular-nums}
@media (max-width:640px){.ap-sum{grid-template-columns:1fr}.ap-sum a{display:grid;grid-template-columns:1fr auto;align-items:center}.ap-sum .ap-sv{margin:0;grid-row:1/span 2;grid-column:2}}
.ap-empty{padding:14px;color:var(--text-muted);font-size:.82rem;text-align:center}
</style>`;

export function panelHtml({ groups = [], period = 'yesterday', now = Date.now(), loading = false, error = false } = {}) {
    const yday = addDays(kstDay(now), -1);
    const tog = `<div class="ap-tog">${[['yesterday', '어제'], ['cum', '누적']].map(([k, l]) => `<button class="${period === k ? 'on' : ''}" onclick="app.adPanelPeriod('${k}')">${l}</button>`).join('')}</div>`;
    const head = `<div class="ap-head"><div class="ap-title"><i class="ph ph-user-plus"></i> 광고 판정판 · 팔로우당 비용</div>${loading || error ? '' : tog}</div>
        <div class="ap-sub">${period === 'yesterday' ? `어제(${md(yday)}) 하루` : `세트 시작일 ~ 어제(${md(yday)})`} · 1명당 = 지출 ÷ 광고로 생긴 인스타 팔로우 · 오늘 수치는 빼고 판정</div>`;
    if (loading) return `${AP_CSS}<div class="glass ap-wrap">${head}<div class="ap-empty">불러오는 중...</div></div>`;
    if (error || !groups.length) return `${AP_CSS}<div class="glass ap-wrap">${head}<div class="ap-empty">${error ? '광고 수치를 불러올 수 없어요.' : '이 기간에 집행된 광고 세트가 없어요.'}</div></div>`;
    const brandHtml = g => {
        const r = g.rules;
        const rule = r ? `${won(r.up_max)}원 이하 증액 · ${won(r.stop_over)}원까지 유지 · 넘으면 중단` : '판정선 없음';
        const rows = g.sets.map(s => {
            const [stt, stc] = STATUS[s.status] || [s.status || '—', '#64748b'];
            return `<tr data-set="${esc(s.adset_id)}">
                <td class="ap-n" title="${esc(s.name)}">${esc(s.name)}</td>
                <td><span class="ap-st" style="color:${stc}">${esc(stt)}</span></td>
                <td>${s.budget != null ? won(s.budget) : '—'}</td>
                <td>${md(s.end)}</td>
                <td>${won(s.spend)}</td>
                <td>${won(s.follows)}</td>
                <td class="ap-c">${cpfTxt(s.cpf, s.spend)}</td>
                <td class="ap-v">${badge(s.kind)}</td>
                <td class="ap-m"><b>${cpfTxt(s.cpf, s.spend)}</b> · 지출 ${won(s.spend)} · 팔로우 ${won(s.follows)}<br><span style="color:${stc}">${esc(stt)}</span> · 일예산 ${s.budget != null ? won(s.budget) : '—'} · 종료 ${md(s.end)}</td>
            </tr>`;
        }).join('');
        return `<div class="ap-brand" data-brand="${esc(g.name)}">
            <div class="ap-bh"><b>${esc(g.name)}</b>${badge(g.kind)}<span class="ap-tot">합계 <strong>${cpfTxt(g.cpf, g.spend)}</strong> · ${won(g.spend)}원 ÷ ${won(g.follows)}명</span>
                <div class="ap-rule" style="flex-basis:100%">${esc(rule)}</div></div>
            <table class="ap-t"><thead><tr><th>세트</th><th>상태</th><th>일예산</th><th>종료</th><th>지출</th><th>팔로우</th><th>1명당</th><th>판정</th></tr></thead><tbody>${rows}</tbody></table>
        </div>`;
    };
    //  맨 위 브랜드 요약 — 세트가 많아도 브랜드별 판정은 첫 화면에 보이게(누르면 그 브랜드 표로)
    const count = g => ['up', 'keep', 'stop'].map(k => [k, g.sets.filter(s => s.kind === k).length]).filter(([, n]) => n).map(([k, n]) => `${PANEL_VERDICT[k].label} ${n}`).join(' · ');
    const sum = `<div class="ap-sum">${groups.map((g, i) => `<a onclick="document.getElementById('ap-b${i}').scrollIntoView({behavior:'smooth',block:'start'})">
        <div class="ap-sn"><span>${esc(g.name)}</span>${badge(g.kind)}</div>
        <div class="ap-sv">${cpfTxt(g.cpf, g.spend)}</div>
        <div class="ap-sc">세트 ${g.sets.length}개${count(g) ? ' · ' + count(g) : ''}</div></a>`).join('')}</div>`;
    return `${AP_CSS}<div class="glass ap-wrap">${head}${sum}${groups.map((g, i) => brandHtml(g).replace('<div class="ap-brand"', `<div class="ap-brand" id="ap-b${i}"`)).join('')}</div>`;
}

//  SNS 운영현황 3단 — 브랜드 3열(하이헤이호 | 로하이스튜디오 | 토비). 한 열 = 브랜드 머리(판정·1명당) → 광고 세트(압축) → 인스타 카드.
//   수치는 buildPanel 결과 그대로(재계산 없음) — 여기선 배치만 바꾼다. 세트는 '진행' 먼저(그 안 순서는 buildPanel 순서 유지).
//   igCards: [{ brand_id, html }] (main.js 가 만든 기존 인스타 카드 그대로). 3브랜드 밖(머문 등·브랜드 미지정)은 3열 아래 별도 줄.
export const MAIN3 = ['하이헤이호', '로하이', '토비'];
const squash = s => String(s || '').replace(/\s/g, '');
export function snsColumns({ groups = [], brands = [], igCards = [] } = {}) {
    const cols = MAIN3.map(k => {
        const b = brands.find(b => squash(b.name).includes(k));
        const id = b ? b.id : null;
        return { key: k, brand_id: id, name: b ? b.name : k, group: id ? groups.find(g => g.brand_id === id) || null : null,
            ig: id ? igCards.filter(c => c.brand_id === id) : [] };
    });
    const ids = new Set(cols.map(c => c.brand_id).filter(Boolean));
    return { cols, extraGroups: groups.filter(g => !ids.has(g.brand_id)), extraIg: igCards.filter(c => !ids.has(c.brand_id)) };
}

export const SNS3_CSS = `<style>
.sns3-cols{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;align-items:start}
.sns3-col{display:flex;flex-direction:column;gap:12px;min-width:0}
.sns3-extra{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:14px;align-items:start;margin-top:14px}
.sns3-xt{grid-column:1/-1;font-size:.78rem;font-weight:800;color:var(--text-muted);margin:4px 2px -4px}
.sns3-bh{padding:12px 14px;border-radius:18px}
.sns3-bh .sns3-n{display:flex;align-items:center;gap:8px}
.sns3-bh .sns3-n b{font-size:1.05rem;font-weight:800;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sns3-bh .sns3-v{display:flex;align-items:baseline;gap:8px;margin-top:6px;font-variant-numeric:tabular-nums}
.sns3-bh .sns3-v strong{font-size:1.45rem;font-weight:900;line-height:1}
.sns3-bh .sns3-v span{font-size:.72rem;color:var(--text-muted)}
.sns3-sets{padding:4px 0;border-radius:18px;overflow:hidden}
.sns3-set{padding:8px 14px;border-top:1px solid var(--card-border)}
.sns3-set:first-child{border-top:0}
.sns3-r1{display:flex;align-items:center;gap:8px;min-width:0}
.sns3-r1 .sns3-sn{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;font-size:.82rem}
.sns3-r1 .sns3-c{font-weight:800;font-size:.86rem;font-variant-numeric:tabular-nums;white-space:nowrap}
.sns3-r2{font-size:.68rem;color:var(--text-muted);margin-top:2px;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sns3-off summary{cursor:pointer;padding:8px 14px;border-top:1px solid var(--card-border);font-size:.74rem;font-weight:700;color:var(--text-muted)}
.sns3-off[open] summary{border-bottom:0}
.sns3-none{padding:12px 14px;font-size:.78rem;color:var(--text-muted)}
@media (max-width:900px){.sns3-cols{grid-template-columns:1fr}.sns3-extra{grid-template-columns:1fr}}
</style>`;

//  맨 위 공통 머리(제목 + 어제/누적 토글 하나)
export function snsHeadHtml({ period = 'yesterday', now = Date.now(), loading = false, error = false } = {}) {
    const yday = addDays(kstDay(now), -1);
    const tog = `<div class="ap-tog">${[['yesterday', '어제'], ['cum', '누적']].map(([k, l]) => `<button class="${period === k ? 'on' : ''}" onclick="app.adPanelPeriod('${k}')">${l}</button>`).join('')}</div>`;
    return `${AP_CSS}${SNS3_CSS}<div class="glass ap-wrap" style="margin-bottom:14px"><div class="ap-head"><div class="ap-title"><i class="ph ph-user-plus"></i> 광고 판정 · 팔로우당 비용</div>${loading || error ? '' : tog}</div>
        <div class="ap-sub">${period === 'yesterday' ? `어제(${md(yday)}) 하루` : `세트 시작일 ~ 어제(${md(yday)})`} · 1명당 = 지출 ÷ 광고로 생긴 인스타 팔로우 · 오늘 수치는 빼고 판정${loading ? ' · 불러오는 중...' : error ? ' · 광고 수치를 불러올 수 없어요.' : ''}</div></div>`;
}

//  한 브랜드 열의 광고 부분(머리 + 세트 목록). group 이 없으면 '집행 세트 없음'.
export function snsBrandAdsHtml(name, g, { loading = false, error = false } = {}) {
    const head = `<div class="glass sns3-bh"><div class="sns3-n"><b>${esc(name)}</b>${g ? badge(g.kind) : ''}</div>
        ${g ? `<div class="sns3-v"><strong>${cpfTxt(g.cpf, g.spend)}</strong><span>1명당 · ${won(g.spend)}원 ÷ ${won(g.follows)}명</span></div>
        <div class="ap-rule" style="margin-top:4px">${esc(g.rules ? `${won(g.rules.up_max)}원 이하 증액 · ${won(g.rules.stop_over)}원까지 유지 · 넘으면 중단` : '판정선 없음')}</div>` : ''}</div>`;
    if (!g) return `${head}<div class="glass sns3-sets"><div class="sns3-none">${loading ? '불러오는 중...' : error ? '광고 수치를 불러올 수 없어요.' : '이 기간에 집행된 광고 세트가 없어요.'}</div></div>`;
    const row = s => {
        const [stt, stc] = STATUS[s.status] || [s.status || '—', '#64748b'];
        return `<div class="sns3-set" data-set="${esc(s.adset_id)}">
            <div class="sns3-r1"><span class="sns3-sn" title="${esc(s.name)}">${esc(s.name)}</span><span class="sns3-c">${cpfTxt(s.cpf, s.spend)}</span>${badge(s.kind)}</div>
            <div class="sns3-r2"><span style="color:${stc};font-weight:700">${esc(stt)}</span> · 지출 ${won(s.spend)}원 · 팔로우 ${won(s.follows)}명 · 예산 ${s.budget != null ? won(s.budget) : '—'} · ~${md(s.end)}</div></div>`;
    };
    //  진행 세트는 펼쳐 두고, 꺼진·종료 세트는 접어 둔다(수치는 그대로, 눌러서 펼침) — 인스타 카드가 너무 밀려나지 않게
    const on = g.sets.filter(s => s.status === 'ACTIVE'), off = g.sets.filter(s => s.status !== 'ACTIVE');
    const offHtml = off.length ? `<details class="sns3-off"${on.length ? '' : ' open'}><summary>꺼진·종료 세트 ${off.length}개</summary>${off.map(row).join('')}</details>` : '';
    return `${head}<div class="glass sns3-sets">${on.map(row).join('')}${offHtml}</div>`;
}

export function sns3Html({ groups = [], brands = [], igCards = [], period = 'yesterday', now = Date.now(), loading = false, error = false } = {}) {
    const { cols, extraGroups, extraIg } = snsColumns({ groups, brands, igCards });
    const colHtml = c => `<section class="sns3-col" data-brand="${esc(c.name)}">${snsBrandAdsHtml(c.name, c.group, { loading, error })}${c.ig.map(x => x.html).join('')}</section>`;
    const extra = extraGroups.length || extraIg.length
        ? `<div class="sns3-extra"><div class="sns3-xt">그 밖의 계정</div>${extraGroups.map(g => `<section class="sns3-col" data-brand="${esc(g.name)}">${snsBrandAdsHtml(g.name, g)}</section>`).join('')}${extraIg.map(x => x.html).join('')}</div>` : '';
    return `${snsHeadHtml({ period, now, loading, error })}<div class="sns3-cols">${cols.map(colHtml).join('')}</div>${extra}`;
}
