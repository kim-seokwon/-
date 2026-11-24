//  마케팅 현황(개선요청 13) — 대시보드 숫자·빈 상태·다가오는 오픈. DB 를 부르지 않는다. 화면(main.js)과 시험이 같은 함수를 쓴다.
//   판정선·세트 판정(panelVerdict)·광고 탭은 건드리지 않는다(14 몫). 여기서는 대시보드에 올릴 때만
//   judge()(adReport.js)와 같은 최소 기준(완결 일수·지출)·1일차 조기 중단·수집 지연/권한/부분실패를 '보류'로 감싼다.
import { esc, won, kstDay, addDays, STALE_HOURS } from './adReport.js';
import { brandOfLink } from './adPanel.js';
import { stepDone } from './todoLink.js';

const num = v => Number(v) || 0;
const KST = 9 * 36e5;
const hm = iso => { const ms = Date.parse(iso || ''); if (Number.isNaN(ms)) return null;
    const t = new Date(ms + KST); return `${t.getUTCMonth() + 1}/${t.getUTCDate()} ${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`; };

//  진행 광고 = 세트 ACTIVE · 종료일(KST) 안 지남 — 대시보드 기존 isCurrent 와 같다
export const isCurrentSet = (s, now = Date.now()) => s.status === 'ACTIVE' && (!s.end || new Date(s.end + 'T23:59:59+09:00').getTime() >= now);

//  보류 사유
export const HOLD_LABEL = { days: '일수 미달', spend: '지출 미달', stale: '수집 지연', auth: '권한오류', error: '최근 수집 오류', partial: '이번 수집 실패', rules: '판정선 없음' };

//  세트 하나를 대시보드에 올릴 수 있나 — judge() 와 같은 기준(완결 = 어제까지 · 지출 있는 날 수 · 그 합)
//   반환 { ok, early, hold: 사유 | null, days, spend }
export function setReadiness(s, rules) {
    if (!rules) return { ok: false, early: false, hold: 'rules', days: 0, spend: 0 };
    const done = (s.daily || []).filter(d => num(d.spend) > 0);
    const days = done.length, spend = done.reduce((a, d) => a + num(d.spend), 0), fol = done.reduce((a, d) => a + num(d.follows), 0);
    const minDays = num(rules.min_days) || 2, minSpend = num(rules.min_spend);
    if (days >= minDays && spend >= minSpend) return { ok: true, early: false, hold: null, days, spend };
    //  1일차 조기 중단 — 하루 예산을 다 쓰고 팔로우 0 또는 1명당 > 종료선 × early_mult
    const budget = num(rules.test_daily_budget), mult = num(rules.early_mult) || 2;
    const cpf = fol > 0 ? spend / fol : null;
    if (days === 1 && budget > 0 && spend >= budget && (fol === 0 || cpf > num(rules.stop_over) * mult)) return { ok: true, early: true, hold: null, days, spend };
    return { ok: false, early: false, hold: days < minDays ? 'days' : 'spend', days, spend };
}

//  ads = { loaded, error, groups(buildPanel 'three' 결과), links, daily, state(ad_report_state 행) }
//  ds = this.ds.ads(dataState: checkedAt · lastGood) · brand = 'all' | brand_id
//  반환 {
//    empty: loading|failed|auth|error|stale|none|nodata|clear|todo — 빈 자리에 무엇을 말할지
//    active, judgeable, idle, hold: { days, spend, stale, auth, partial, rules, total }, excluded: { sets, spend, follows, reason },
//    todo: [set + kind/early], lastOk, checkedAt, partialCount }
export function mktStatus({ ads = {}, ds = null, brand = 'all', now = Date.now() } = {}) {
    const state = ads.state || null;
    const lastOk = state?.last_ok_at || null, checkedAt = ds?.checkedAt || null;
    const base = { active: 0, judgeable: 0, idle: 0, hold: { days: 0, spend: 0, stale: 0, auth: 0, error: 0, partial: 0, rules: 0, total: 0 },
        excluded: { sets: 0, spend: 0, follows: 0, reason: null }, todo: [], lastOk, checkedAt, partialCount: 0 };
    if (!ads.loaded) return { ...base, empty: 'loading' };
    //  자료를 못 받음(카드·상태 실패 또는 일별 실패 → groups 비어 있음) — '할 일 없음'으로 보이면 안 된다
    if (ads.error || !ads.groups) return { ...base, empty: 'failed' };

    const mine = b => brand === 'all' || String(b) === String(brand);
    const sets = ads.groups.flatMap(g => g.sets.map(s => ({ ...s, brand_id: s.brand_id ?? g.brand_id, brand: g.name, rules: g.rules })))
        .filter(s => mine(s.brand_id) && isCurrentSet(s, now));

    //  제외(108) — 브랜드별로 다시 센다(buildPanel 의 .excluded 는 전 브랜드 합)
    const yday = addDays(kstDay(now), -1), from3 = addDays(yday, -2);
    const exSet = new Map(), exAd = new Map();
    for (const l of ads.links || []) {
        if (!l.excluded) continue;
        const b = brandOfLink(l, ads.brands || []);
        if (!mine(b)) continue;
        const id = l.adset_id || 'ad:' + l.ad_id;
        exSet.set(id, l.excluded_reason || null); exAd.set(String(l.ad_id), id);
    }
    const excluded = { sets: exSet.size, spend: 0, follows: 0, reason: [...exSet.values()].find(Boolean) || null };
    for (const d of ads.daily || []) if (exAd.has(String(d.ad_id)) && d.day && d.day <= yday && d.day >= from3) { excluded.spend += num(d.spend); excluded.follows += num(d.follows); }

    //  수집 상태 — 권한오류·지연이면 전부 보류, 부분 실패면 그 광고가 든 세트만 보류
    const okAt = lastOk ? Date.parse(lastOk) : null;
    //  최근 전체 수집이 오류(result=error)면 마지막 정상 숫자는 보여도 판정·추천은 보류(반려1 ①)
    const collectErr = state?.result === 'error';
    const auth = !!state?.auth_error, stale = !state || !okAt || now - okAt > STALE_HOURS * 36e5;
    const failed = new Set((state?.failed_ads || []).map(String));
    const failedSets = new Set((ads.links || []).filter(l => failed.has(String(l.ad_id))).map(l => l.adset_id || 'ad:' + l.ad_id));

    //  못 받은 광고 수도 고른 브랜드 것만(전체면 전부)
    const partialCount = brand === 'all' ? failed.size : new Set((ads.links || []).filter(l => failed.has(String(l.ad_id)) && mine(brandOfLink(l, ads.brands || []))).map(l => String(l.ad_id))).size;
    const out = { ...base, excluded, active: sets.length, partialCount, byBrand: {} };
    for (const s of sets) {
        out.byBrand[s.brand_id] = (out.byBrand[s.brand_id] || 0) + 1;
        if (num(s.spend) <= 0) { out.idle++; continue; }                      // 최근 3일 집행 없음 — 판정 대상 아님
        const why = auth ? 'auth' : collectErr ? 'error' : stale ? 'stale' : failedSets.has(s.adset_id) ? 'partial' : null;
        if (why) { out.hold[why]++; continue; }
        const r = setReadiness(s, s.rules);
        if (!r.ok) { out.hold[r.hold]++; continue; }
        out.judgeable++;
        //  조기 중단은 '중단'으로만 올린다(judge 와 같이). 그 밖은 세트 판정(최근 3일) 그대로
        const kind = r.early ? 'stop' : s.kind;
        if (kind === 'stop' || kind === 'up') out.todo.push({ ...s, kind, early: r.early });
    }
    out.hold.total = Object.entries(out.hold).filter(([k]) => k !== 'total').reduce((a, [, v]) => a + v, 0);
    out.empty = auth ? 'auth' : collectErr ? 'error' : stale ? 'stale' : !out.active ? 'none' : !out.judgeable ? 'nodata' : out.todo.length ? 'todo' : 'clear';
    return out;
}

//  빈 자리 문구 — '할 일 없음'은 판정할 수 있는 세트가 있고 그중 중단·증액이 0일 때만
export function mktEmptyText(st) {
    const why = Object.entries(HOLD_LABEL).map(([k, t]) => st.hold?.[k] ? `${t} ${st.hold[k]}` : '').filter(Boolean).join(' · ');
    switch (st.empty) {
        case 'loading': return { tone: 'muted', text: '광고 자료를 불러오는 중…' };
        case 'failed': return { tone: 'bad', text: '광고 자료를 받지 못했습니다 — 할 일이 없는 게 아니라 확인할 수 없는 상태입니다.' };
        case 'auth': return { tone: 'bad', text: '광고 권한오류로 판정을 보류했습니다 — 숫자는 마지막 성공 수집 기준입니다.' };
        case 'error': return { tone: 'bad', text: '최근 광고 수집이 실패해 판정을 보류했습니다 — 숫자는 마지막 성공 수집 기준입니다.' };
        case 'stale': return { tone: 'warn', text: `광고 수집이 ${STALE_HOURS}시간 넘게 늦어 판정을 보류했습니다.` };
        case 'none': return { tone: 'muted', text: '진행 중인 광고가 없습니다.' };
        case 'nodata': return { tone: 'warn', text: `판정할 자료가 부족합니다${why ? ` — ${why}` : ''}. 할 일이 없는 게 아닙니다.` };
        case 'clear': return { tone: 'ok', text: `오늘 할 일 없음 — 판정한 ${st.judgeable}개 모두 유지${st.hold?.total ? ` (보류 ${st.hold.total}개 별도)` : ''}` };
        default: return { tone: '', text: '' };
    }
}

//  KPI 한 줄 — 진행 · 판정 가능 · 보류 · 집행 없음 · 제외 · 마지막 수집(원본 성공) · 화면 확인
export function mktKpiHtml(st) {
    const dash = ['loading', 'failed'].includes(st.empty);
    const n = v => dash ? '—' : String(v);
    const why = Object.entries(HOLD_LABEL).map(([k, t]) => st.hold?.[k] ? `${t} ${st.hold[k]}` : '').filter(Boolean).join(' · ');
    const cell = (k, label, v, sub = '', cls = '') => `<div class="mk-k${cls}" data-k="${k}"><span>${esc(label)}</span><b>${esc(v)}</b>${sub ? `<em>${esc(sub)}</em>` : ''}</div>`;
    const unk = st.empty === 'loading' ? '불러오는 중' : '확인 불가';   // 받기 전·실패 땐 '없음'이라 말하지 않는다
    const ok = hm(st.lastOk), chk = hm(st.checkedAt);
    const stale = ['stale', 'auth', 'error'].includes(st.empty);
    return `<div class="mk-kpis">
        ${cell('active', '진행 광고', n(st.active), '세트 · 종료일 안 지남')}
        ${cell('judgeable', '판정 가능', n(st.judgeable), '완결 일수·지출 충족')}
        ${cell('hold', '판정 보류', n(st.hold?.total || 0), dash ? unk : (why || '자료 부족 없음'), st.hold?.total ? ' warn' : '')}
        ${cell('idle', '집행 없음', n(st.idle), '최근 3일 지출 0')}
        ${cell('excluded', '제외', n(st.excluded?.sets || 0), dash ? unk : st.excluded?.sets ? `목표 오류 · 3일 지출 ${won(st.excluded.spend)}원` : '판정·합계에서 뺀 세트')}
        <div class="mk-k mk-time${stale ? ' warn' : ''}" data-k="time"><span>마지막 수집</span><b>${esc(ok || '없음')}</b><em>원본 성공 시각${chk ? ` · 화면 확인 ${esc(chk)}` : ''}${st.partialCount ? ` · ${st.partialCount}개 광고 못 받음` : ''}</em></div>
    </div>`;
}

// ── 다가오는 오픈 ↔ 콘텐츠 준비 ─────────────────────────────
//  오픈일 = 시즌 기본 페이지(season-home) 마감, 없으면 시즌 마감일(due_date). 오늘 ~ +days 안의 시즌만.
//  콘텐츠 = 시즌 단계 메모 중 '촬영'·'마케팅'(season_steps 이름). 완료는 C-c stepDone 그대로(체크줄 전부 끝남 / 없으면 메모 상태).
export const LAUNCH_DAYS = 21;
export const CONTENT_STEPS = ['촬영', '마케팅'];
const d10 = v => { const m = String(v || '').match(/(\d{4})[.\-/\s]+(\d{1,2})[.\-/\s]+(\d{1,2})/);
    return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null; };
const dDiff = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 864e5);

//  seasons: [{id,name,brand_id,due_date}] · notes: [{id, product_id, meta, lines:[{done}]}] · steps: season_steps 행
//  uploads: uploadAlerts() 결과 · adsByBrand: { brand_id: 진행 광고 수 } · brandName(id)
export function launchContent({ seasons = [], notes = [], steps = [], uploads = [], adsByBrand = {}, brand = 'all', now = Date.now(), days = LAUNCH_DAYS, brandName = id => id } = {}) {
    const today = kstDay(now), until = addDays(today, days);
    const stepById = new Map(steps.map(s => [String(s.id), s]));
    const seaOf = n => String(n.meta?.proj || n.product_id || '');
    return seasons.filter(sea => brand === 'all' || String(sea.brand_id) === String(brand)).map(sea => {
        const mine = notes.filter(n => seaOf(n) === String(sea.id));
        const home = mine.find(n => n.meta?.embed === 'season-home' && d10(n.meta?.due));
        const open = d10(home?.meta?.due) || d10(sea.due_date);
        if (!open || open < today || open > until) return null;
        const content = CONTENT_STEPS.map(name => {
            const n = mine.find(x => { const st = stepById.get(String(x.meta?.step || '')); return st ? st.name === name : false; });
            if (!n) return { name, has: false };
            const lines = n.lines || [];
            const done = stepDone(n.meta, lines);
            const due = d10(n.meta?.due);
            return { name, has: true, id: n.id, done, due, lines: lines.length, linesDone: lines.filter(x => x.done).length,
                late: !done && !!due && due < today };
        });
        const up = uploads.find(u => String(u.brand_id) === String(sea.brand_id)) || null;
        const has = content.filter(c => c.has);
        const status = !has.length ? 'nostep' : has.some(c => c.late) ? 'late' : has.every(c => c.done) && has.length === CONTENT_STEPS.length ? 'ready' : 'prog';
        return { id: sea.id, name: sea.name, brand_id: sea.brand_id, brand: brandName(sea.brand_id), open, dday: dDiff(open, today),
            content, status, upload: up ? { n: up.n, level: up.level, approx: !!up.approx } : null, ads: adsByBrand ? num(adsByBrand[sea.brand_id]) : null };   // 광고 자료 없음 = null('—')
    }).filter(Boolean).sort((a, b) => a.open.localeCompare(b.open) || String(a.name).localeCompare(String(b.name)));
}

const LC_STATUS = { late: ['콘텐츠 준비 지연', 'bad'], prog: ['준비 중', ''], ready: ['준비 끝', 'ok'], nostep: ['단계 미설정', 'muted'] };
export function launchHtml(rows, { days = LAUNCH_DAYS } = {}) {
    if (!rows.length) return `<div class="mk-empty muted">${days}일 안에 오픈하는 시즌이 없습니다.</div>`;
    const stepTxt = c => !c.has ? `<span class="mk-st muted">${esc(c.name)} 없음</span>`
        : `<span class="mk-st${c.done ? ' ok' : c.late ? ' bad' : ''}">${esc(c.name)} ${c.lines ? `${c.linesDone}/${c.lines}` : c.done ? '완료' : '진행'}${c.late ? ' · 지남' : ''}</span>`;
    const upTxt = u => !u ? '<span class="mk-st muted">업로드 기록 없음</span>'
        : u.n == null ? '<span class="mk-st muted">업로드 기록 없음</span>'
        : `<span class="mk-st${u.level === 'warn' ? ' bad' : u.level === 'alert' ? ' warn' : ''}">마지막 업로드 ${u.n}일 전${u.approx ? '(대략)' : ''}</span>`;
    return `<ul class="mk-launch">${rows.map(r => {
        const [lab, cls] = LC_STATUS[r.status];
        const go = r.content.find(c => c.late) || r.content.find(c => c.has && !c.done) || r.content.find(c => c.has);   // 지난 단계 먼저
        return `<li${go ? ` data-note="${esc(go.id)}" onclick="app.findGo('notes','${esc(go.id)}')"` : ''}><div class="mk-lh"><b>${esc(r.name)}</b><em>${esc(r.brand || '')}</em>
            <span class="mk-d">오픈 ${esc(r.open.slice(5).replace('-', '/'))} · ${r.dday === 0 ? '오늘' : `D-${r.dday}`}</span>
            <span class="mk-st ${cls}">${esc(lab)}</span></div>
            <div class="mk-lb">${r.content.map(stepTxt).join('')}${upTxt(r.upload)}<span class="mk-st">진행 광고 ${r.ads == null ? '—' : r.ads}</span></div></li>`;
    }).join('')}</ul>`;
}
