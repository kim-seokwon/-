//  게시물별 광고리포트 · 업로드 경보 — 화면 없이 계산만 하는 순수 함수 + HTML 조각 (기획 §3·§5, 105)
//   합산은 DB 뷰(ad_post_cards)가, 판정은 여기서만 한다. 판정선 숫자는 코드에 없다 — 전부 ad_report_rules 행.
//   화면에 나가는 모든 문자열은 esc() 를 거친다.

const DAY = 864e5;
const KST = 9 * 36e5;
export const STALE_HOURS = 6;           // 마지막 성공 수집이 이보다 오래면 '보류 · 데이터 지연'
export const PROVISIONAL_DAYS = 7;      // 마지막 완결일이 오늘-7 안이면 '잠정'
export const UPLOAD_ALERT = 4;          // N일 이상 무업로드 → 알림(주황)
export const UPLOAD_WARN = 7;           // N일 이상 → 경고(빨강)

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => Number(v) || 0;
export const won = v => Math.round(num(v)).toLocaleString('ko-KR');

//  IG timestamp('2026-11-07T16:30:00+0000') · ISO · ms → KST 날짜
export function kstDay(t) {
    if (t == null || t === '') return null;
    const ms = typeof t === 'number' ? t : Date.parse(String(t).replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
    return Number.isNaN(ms) ? null : new Date(ms + KST).toISOString().slice(0, 10);
}
export const dayDiff = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / DAY);
export const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const md = d => d ? `${d.slice(5, 7)}-${d.slice(8, 10)}` : '—';
const hm = iso => { const k = kstDay(iso); if (!k) return '—'; const t = new Date(Date.parse(iso) + KST); return `${md(k)} ${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`; };

// ── 업로드 경보 ─────────────────────────────────────────
//  브랜드마다 마지막 게시일(KST) → 오늘까지 N일. 1순위 ig_media, 없으면 ig_snapshots posts_delta>0 마지막 날('대략').
export function uploadLevel(n) { return n == null ? 'none' : n >= UPLOAD_WARN ? 'warn' : n >= UPLOAD_ALERT ? 'alert' : 'ok'; }
export function uploadAlerts({ accounts = [], media = [], snapshots = [], brandName = id => id, now = Date.now() } = {}) {
    const today = kstDay(now);
    return accounts.map(a => {
        const mine = media.filter(m => m.account_id === a.id || (!m.account_id && m.brand_id && m.brand_id === a.brand_id));
        let last = mine.map(m => m.posted_day || kstDay(m.posted_at)).filter(Boolean).sort().pop() || null;
        let approx = false;
        if (!last) {
            last = snapshots.filter(s => s.account_id === a.id && num(s.posts_delta) > 0).map(s => s.snap_date).sort().pop() || null;
            approx = !!last;
        }
        const n = last ? Math.max(0, dayDiff(today, last)) : null;
        return { account_id: a.id, brand_id: a.brand_id, name: brandName(a.brand_id), last, n, approx, level: uploadLevel(n) };
    });
}

// ── 판정 ────────────────────────────────────────────────
//  card = ad_post_cards 한 행, rules = 그 브랜드 ad_report_rules 행, state = ad_report_state 행
//  반환 { kind: up|keep|stop|wait|hold|final|none, label, cpf, reason, early, provisional }
export const VERDICT = {
    up: { label: '증액 추천', color: '#059669' }, keep: { label: '유지', color: '#2563eb' }, stop: { label: '중단 추천', color: '#dc2626' },
    wait: { label: '판정 대기', color: '#64748b' }, hold: { label: '보류', color: '#d97706' }, final: { label: '종료', color: '#475569' },
    none: { label: '판정선 없음', color: '#64748b' },
};
export const cpfOf = (spend, follows) => num(follows) > 0 ? Math.round(num(spend) / num(follows)) : null;

export function judge(card, rules, { state = null, now = Date.now() } = {}) {
    const today = kstDay(now);
    const out = (kind, extra = {}) => ({ kind, label: extra.label || VERDICT[kind].label, cpf: null, reason: '', early: false, provisional: false, ...extra });
    const curs = (card.currencies || []).filter(Boolean);
    if (curs.some(c => c !== 'KRW')) return out('hold', { label: '보류 · 통화 다름', reason: `통화 ${curs.join('/')} — 원화 계정만 판정한다(환산 안 함)` });
    if (state && state.auth_error) return out('hold', { label: '보류 · 권한오류', reason: '광고 권한오류 — 숫자는 마지막 성공 수집 기준' });
    const okAt = state && state.last_ok_at ? Date.parse(state.last_ok_at) : null;
    if (!okAt || now - okAt > STALE_HOURS * 36e5) return out('hold', { label: '보류 · 데이터 지연', reason: okAt ? `마지막 성공 수집 ${hm(state.last_ok_at)} (${Math.floor((now - okAt) / 36e5)}시간 전)` : '아직 성공한 수집이 없음' });
    if (card.any_failed) return out('hold', { label: '보류 · 갱신 실패', reason: '이 게시물 광고 중 이번 수집에 실패한 광고가 있음' });
    if (!rules) return out('none', { reason: '이 브랜드 판정선(ad_report_rules)이 없음' });

    const stamp = ` · 수집 ${hm(state.last_ok_at)}`;
    const upMax = num(rules.up_max), stopOver = num(rules.stop_over);
    const rangeTxt = card.first_day ? `${md(card.first_day)}~${md(card.done_until || card.last_day)}` : '';

    // 종료 카드: 판정 대신 최종 1명당
    if (!card.any_active) {
        const cpf = cpfOf(card.total_spend, card.total_follows);
        return out('final', { cpf, label: cpf != null ? `최종 팔로워당 비용 ${won(cpf)}원` : '최종 팔로우 0',
            reason: `${card.first_day ? `${md(card.first_day)}~${md(card.last_day)} ` : ''}지출 ${won(card.total_spend)}원 ÷ 팔로우 ${won(card.total_follows)}${cpf != null ? ` = ${won(cpf)}원` : ''}${stamp}` });
    }

    const days = num(card.done_days), spend = num(card.done_spend), fol = num(card.done_follows);
    const minDays = num(rules.min_days) || 2, minSpend = num(rules.min_spend);
    const provisional = !!card.done_until && dayDiff(today, card.done_until) <= PROVISIONAL_DAYS;
    const tail = provisional ? ' (최근 7일 수치는 Meta가 고칠 수 있음)' : '';
    const cpf = cpfOf(spend, fol);
    const verdictBy = c => c <= upMax ? 'up' : c <= stopOver ? 'keep' : 'stop';
    const sign = { up: `≤ ${won(upMax)}원`, keep: `≤ ${won(stopOver)}원`, stop: `> ${won(stopOver)}원` };

    if (days >= minDays && spend >= minSpend) {
        if (fol === 0) return out('stop', { reason: `${rangeTxt} 완결 ${days}일 · 지출 ${won(spend)}원에 팔로우 0 → 중단 추천${stamp}${tail}`, provisional });
        const k = verdictBy(cpf);
        return out(k, { cpf, provisional, reason: `${rangeTxt} 완결 ${days}일 · 지출 ${won(spend)}원 ÷ 팔로우 ${won(fol)} = ${won(cpf)}원 ${sign[k]} → ${VERDICT[k].label}${stamp}${tail}` });
    }
    // 1일차 조기 중단: 하루 예산을 다 쓰고 (팔로우 0 또는 1명당 > 종료선 × early_mult) — 표시만
    const budget = num(rules.test_daily_budget);
    const mult = num(rules.early_mult) || 2;
    if (days === 1 && budget > 0 && spend >= budget && (fol === 0 || cpf > stopOver * mult)) {
        return out('stop', { cpf, early: true, provisional, label: '중단 추천 · 1일차',
            reason: `${rangeTxt} 1일차 · 지출 ${won(spend)}원 ÷ 팔로우 ${won(fol)}${cpf != null ? ` = ${won(cpf)}원 > ${won(stopOver * mult)}원(종료선 ${mult}배)` : ''} → 조기 중단 추천${stamp}${tail}` });
    }
    return out('wait', { cpf, provisional, reason: `완결 ${Math.min(days, minDays)}/${minDays}일 · 지출 ${won(spend)}/${won(minSpend)}원${cpf != null ? ` · 현재 팔로워당 비용 ${won(cpf)}원(참고)` : ''}${stamp}` });
}

// ── 목록 ────────────────────────────────────────────────
const ORDER = { stop: 0, up: 1, keep: 2, wait: 3, hold: 4, none: 5, final: 6 };
//  rulesBy = { brand_id: rules }. 진행중 먼저 → 판정 급한 순(중단·증액·유지·대기·보류) → 최근 지출일
export function buildCards(cards, rulesBy, ctx) {
    return (cards || []).map(c => ({ card: c, v: judge(c, rulesBy[c.brand_id], ctx) }))
        .sort((a, b) => (b.card.any_active === true) - (a.card.any_active === true) || ORDER[a.v.kind] - ORDER[b.v.kind]
            || String(b.card.last_day || '').localeCompare(String(a.card.last_day || '')));
}
//  기간 칩: active=진행중만 · 30=최근 30일 지출 · all=전체
export function filterCards(list, { brand = 'all', period = 'active', now = Date.now() } = {}) {
    const since = addDays(kstDay(now), -29);
    return list.filter(({ card: c }) => (brand === 'all' || c.brand_id === brand)
        && (period === 'all' || (period === 'active' ? c.any_active : (c.any_active || (c.last_day && c.last_day >= since)))));
}
//  수집 상태 → 머리 띠
export function stateBand(state, { now = Date.now(), failedCount = 0 } = {}) {
    if (!state) return { kind: 'none', text: '아직 광고 수집 기록이 없어요 — 첫 수집 뒤에 숫자가 보여요' };
    const okAt = state.last_ok_at ? Date.parse(state.last_ok_at) : null;
    if (state.auth_error) return { kind: 'auth', text: `광고 권한오류 — 숫자는 마지막 성공(${okAt ? hm(state.last_ok_at) : '없음'}) 기준이고 판정은 보류예요. 팀장이 토큰을 확인합니다.` };
    if (!okAt || now - okAt > STALE_HOURS * 36e5) return { kind: 'stale', text: `광고 수치가 늦어지고 있어요 — 마지막 성공 ${okAt ? hm(state.last_ok_at) : '없음'}. 판정은 보류예요.` };
    if (state.result === 'partial' || failedCount) return { kind: 'partial', text: `광고 ${(state.failed_ads || []).length || failedCount}개 수치를 이번에 못 받았어요 — 그 카드는 '보류'로 보여요.` };
    return { kind: 'ok', text: `수집 ${hm(state.last_ok_at)}` };
}

// ── HTML ────────────────────────────────────────────────
export const AR_CSS = `<style>
.ar-wrap{min-width:0}
.ar-chips{display:flex;gap:6px;flex-wrap:wrap}.ar-filters{display:flex;flex-direction:column;gap:6px;margin-top:10px}
.ar-chip{flex-shrink:0;display:inline-flex;align-items:center;gap:5px;padding:6px 10px;border-radius:999px;font-size:.76rem;font-weight:700;border:1px solid var(--card-border);background:transparent;color:var(--text-main);cursor:pointer;white-space:nowrap}
.ar-chip.on{background:var(--primary,#6366f1);border-color:var(--primary,#6366f1);color:#fff}
.ar-up{display:flex;gap:5px;flex-wrap:wrap}.ar-up .ar-chip{padding:4px 8px;font-size:.72rem}
.ar-up .ar-chip{cursor:default}
.ar-band{padding:9px 12px;border-radius:10px;font-size:.78rem;font-weight:600;line-height:1.45;margin:8px 0}
.ar-band.auth{background:rgba(220,38,38,.1);color:#b91c1c;border:1px solid rgba(220,38,38,.35)}
.ar-band.partial,.ar-band.stale{background:rgba(245,158,11,.12);color:#b45309;border:1px solid rgba(245,158,11,.35)}
.ar-band.none{background:rgba(148,163,184,.1);color:var(--text-muted)}
.ar-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:10px;margin-top:10px}
.ar-card{min-width:0;border:1px solid var(--card-border);border-radius:14px;padding:11px;cursor:pointer;background:var(--card-bg,transparent)}
.ar-top{display:flex;gap:10px;min-width:0}
.ar-thumb{width:64px;height:80px;border-radius:8px;object-fit:cover;flex-shrink:0;background:rgba(148,163,184,.18)}
.ar-main{flex:1;min-width:0}
.ar-meta{font-size:.7rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ar-badge{display:inline-block;padding:3px 8px;border-radius:6px;font-size:.74rem;font-weight:800;color:#fff;margin-top:4px}
.ar-cpf{font-size:1.25rem;font-weight:900;font-variant-numeric:tabular-nums;line-height:1.1;margin-top:3px}
.ar-cpf small{font-size:.7rem;font-weight:600;color:var(--text-muted)}
.ar-line{font-size:.76rem;margin-top:3px;font-variant-numeric:tabular-nums}
.ar-why{font-size:.7rem;color:var(--text-muted);margin-top:8px;line-height:1.5;overflow-wrap:anywhere}
.ar-more-btn{margin-top:6px;font-size:.72rem;color:var(--text-muted);background:none;border:0;padding:4px 0;cursor:pointer}
.ar-more{display:none;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin-top:6px}
.ar-card.open .ar-more{display:grid}
.ar-more div{background:rgba(148,163,184,.09);border-radius:8px;padding:6px;text-align:center;font-size:.7rem;color:var(--text-muted)}
.ar-more b{display:block;font-size:.86rem;color:var(--text-main);font-variant-numeric:tabular-nums}
.ar-sk{height:118px;border-radius:14px;background:linear-gradient(90deg,rgba(148,163,184,.12),rgba(148,163,184,.24),rgba(148,163,184,.12));background-size:200% 100%;animation:arsk 1.2s infinite}
@keyframes arsk{to{background-position:-200% 0}}
.ar-empty{padding:18px;text-align:center;color:var(--text-muted);font-size:.8rem;border:1px dashed var(--card-border);border-radius:12px;margin-top:10px}
.ar-unl{margin-top:10px;font-size:.74rem;color:var(--text-muted)}
@media (min-width:900px){.ar-grid{grid-template-columns:repeat(auto-fill,minmax(300px,1fr))}.ar-more{display:grid}.ar-more-btn{display:none}}
.ar-sheet-bg{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9000;display:flex;align-items:flex-end;justify-content:center}
.ar-sheet{width:100%;max-width:560px;max-height:85vh;overflow-y:auto;background:var(--bg-color,#fff);color:var(--text-main);border-radius:16px 16px 0 0;padding:16px 16px 24px;box-sizing:border-box}
.ar-sheet table{width:100%;border-collapse:collapse;font-size:.78rem;font-variant-numeric:tabular-nums}
.ar-sheet td,.ar-sheet th{padding:6px 4px;border-top:1px solid var(--card-border);text-align:right}
.ar-sheet td:first-child,.ar-sheet th:first-child{text-align:left}
</style>`;

const UP_COL = { ok: '#059669', alert: '#d97706', warn: '#dc2626', none: '#64748b' };
export function uploadChipsHtml(alerts) {
    if (!alerts.length) return '';
    const txt = a => a.n == null ? '기록 없음' : a.n === 0 ? '오늘' : `${a.n}일${a.approx ? '(대략)' : ''}`;
    return `<div class="ar-up"><span style="font-size:.72rem;color:var(--text-muted);font-weight:700;align-self:center">마지막 업로드</span>${alerts.map(a =>
        `<span class="ar-chip" style="border-color:${UP_COL[a.level]};color:${UP_COL[a.level]}" title="마지막 게시 ${esc(a.last || '—')}">${esc(a.name)} ${txt(a)}</span>`).join('')}</div>`;
}

export function cardHtml({ card: c, v }, { brandName = id => id, i = 0 } = {}) {
    const col = VERDICT[v.kind].color;
    const fol = num(c.done_follows), spend = num(c.done_spend);
    const big = v.kind === 'final' ? (v.cpf != null ? `${won(v.cpf)}<small>원/명</small>` : '—')
        : v.cpf != null ? `${won(v.cpf)}<small>원/명</small>` : (v.kind === 'stop' && fol === 0 && spend > 0 ? '—' : '<small>팔로워당 비용 —</small>');
    const posted = c.posted_day ? `게시 ${md(c.posted_day)}` : '';
    const period = c.first_day ? `광고 ${md(c.first_day)}~${c.any_active ? '진행중' : md(c.last_day)}` : (c.any_active ? '광고 진행중 · 지출 전' : '');
    const today = c.any_active && (num(c.today_spend) || num(c.today_follows)) ? `<div class="ar-line" style="color:var(--text-muted)">오늘(진행 중) ${won(c.today_spend)}원 · 팔로우 ${won(c.today_follows)}</div>` : '';
    const thumb = c.thumb_url ? `<img class="ar-thumb" src="${esc(c.thumb_url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">` : `<div class="ar-thumb"></div>`;
    return `<div class="ar-card" data-media="${esc(c.media_id)}" onclick="app.adDetail(${i})">
        <div class="ar-top">${thumb}
            <div class="ar-main">
                <div class="ar-meta">${esc(brandName(c.brand_id))}${posted ? ' · ' + posted : ''}${period ? ' · ' + period : ''}</div>
                <span class="ar-badge" style="background:${col}">${esc(v.label)}</span>
                <div class="ar-cpf">${big}</div>
                <div class="ar-line">${v.kind === 'final' ? '전체' : '완결'} 지출 <b>${won(v.kind === 'final' ? c.total_spend : spend)}원</b> · 팔로우 <b>${won(v.kind === 'final' ? c.total_follows : fol)}</b>${c.daily_budget ? ` · 하루 ${won(c.daily_budget)}원` : ''}</div>
                ${today}
            </div>
        </div>
        <div class="ar-why">${esc(v.reason)}</div>
        <button class="ar-more-btn" onclick="event.stopPropagation();this.closest('.ar-card').classList.toggle('open')">노출·도달·프로필방문 ▾</button>
        <div class="ar-more"><div>노출<b>${won(c.total_impressions)}</b></div><div>도달<b>${c.reach != null ? won(c.reach) : '—'}</b></div><div>프로필방문<b>${won(c.total_visits)}</b></div></div>
    </div>`;
}

//  광고리포트 블록 전체. loading 이면 뼈대만.
export function reportHtml({ loading = false, error = false, list = [], alerts = [], state = null, brands = [], brand = 'all', period = 'active', activeAds = 0, unlinked = [], brandName = id => id, now = Date.now() } = {}) {
    const head = `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap">
        <div style="font-size:1.02rem;font-weight:800"><i class="ph ph-megaphone-simple"></i> 게시물별 광고 리포트${loading ? '' : ` <span style="font-size:.8rem;color:var(--text-muted);font-weight:600">· 진행중 광고 ${activeAds}개</span>`}</div>
        ${!loading && state && state.last_ok_at ? `<div style="font-size:.7rem;color:var(--text-muted)">수집 ${hm(state.last_ok_at)}</div>` : ''}</div>`;
    if (loading) return `${AR_CSS}<div class="glass ar-wrap" style="padding:1.1rem;border-radius:18px;margin-bottom:1.3rem">${head}
        <div class="ar-grid"><div class="ar-sk"></div><div class="ar-sk"></div><div class="ar-sk"></div></div></div>`;
    const band = stateBand(state, { now });
    const bandHtml = band.kind === 'ok' ? '' : `<div class="ar-band ${band.kind}">${esc(band.text)}</div>`;
    const chip = (on, label, call) => `<button class="ar-chip${on ? ' on' : ''}" onclick="${call}">${esc(label)}</button>`;
    //  브랜드 줄 · 기간 줄을 나눠 감싼다(가로 스크롤 없음 — 390px에서 칩이 잘려 보이던 반려 대응)
    const chips = `<div class="ar-filters"><div class="ar-chips" data-row="brand">${chip(brand === 'all', '전체', "app.adFilter('brand','all')")}${brands.map(b => chip(brand === b.id, b.name, `app.adFilter('brand','${esc(b.id)}')`)).join('')}</div>
        <div class="ar-chips" data-row="period">${chip(period === 'active', '진행중', "app.adFilter('period','active')")}${chip(period === '30', '최근 30일', "app.adFilter('period','30')")}${chip(period === 'all', '전체 기간', "app.adFilter('period','all')")}</div></div>`;
    const shown = filterCards(list, { brand, period, now });
    const emptyTxt = error ? '광고 리포트를 아직 불러올 수 없어요(수집 준비 중).' : !list.length ? '아직 게시물에 연결된 광고 수치가 없어요.'
        : period === 'active' ? '지금 진행중인 광고가 없어요 — "최근 30일"에서 지난 광고를 볼 수 있어요.' : '조건에 맞는 광고가 없어요.';
    const cards = shown.length ? `<div class="ar-grid">${shown.map(x => cardHtml(x, { brandName, i: list.indexOf(x) })).join('')}</div>` : `<div class="ar-empty">${esc(emptyTxt)}</div>`;
    const unl = unlinked.length ? `<details class="ar-unl"><summary>게시물 미연결 광고 ${unlinked.length}개</summary>${unlinked.map(u => `<div style="padding:3px 0">${esc(u.ad_name || u.ad_id)}${u.effective_status === 'ACTIVE' ? ' · 진행중' : ''}</div>`).join('')}</details>` : '';
    return `${AR_CSS}<div class="glass ar-wrap" style="padding:1.1rem;border-radius:18px;margin-bottom:1.3rem">
        ${uploadChipsHtml(alerts)}
        <div style="margin-top:${alerts.length ? 12 : 0}px">${head}</div>
        ${bandHtml}${chips}${cards}${unl}
        <p style="margin:.8rem 2px 0;font-size:.66rem;color:var(--text-muted)">* 판정은 어제(KST)까지 완결일만 · 팔로워 1명 획득비용 = 지출 ÷ 광고로 생긴 팔로우. 판정선은 브랜드별 설정값. 카드를 누르면 일자별 표가 열려요.</p>
    </div>`;
}

//  카드 상세(바텀시트) — daily = 그 게시물 ad_daily 행들
export function detailHtml({ card: c, v }, daily, { brandName = id => id, now = Date.now() } = {}) {
    const today = kstDay(now);
    const byDay = {};
    for (const d of daily || []) { const k = d.day; const x = (byDay[k] ||= { spend: 0, follows: 0, visits: 0, imp: 0 }); x.spend += num(d.spend); x.follows += num(d.follows); x.visits += num(d.profile_visits); x.imp += num(d.impressions); }
    const rows = Object.keys(byDay).sort().reverse().map(k => { const x = byDay[k]; const cpf = cpfOf(x.spend, x.follows);
        return `<tr><td>${md(k)}${k === today ? ' <span style="color:#d97706;font-size:.68rem">진행 중</span>' : ''}</td><td>${won(x.spend)}</td><td>${won(x.follows)}</td><td>${cpf != null ? won(cpf) : '—'}</td><td>${won(x.visits)}</td></tr>`; }).join('');
    const acct = (c.ad_accounts || [])[0];
    const ids = (c.ad_ids || []).join(',');
    const amLink = acct ? `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${encodeURIComponent(acct)}&selected_ad_ids=${encodeURIComponent(ids)}` : null;
    return `<div class="ar-sheet" onclick="event.stopPropagation()">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
            <b style="font-size:.95rem">${esc(brandName(c.brand_id))} · 게시물 광고</b>
            <button onclick="app.adDetailClose()" aria-label="닫기" style="border:0;background:none;font-size:1.3rem;color:var(--text-muted);cursor:pointer">×</button></div>
        <div style="margin:6px 0 10px"><span class="ar-badge" style="background:${VERDICT[v.kind].color}">${esc(v.label)}</span>
            <div class="ar-why" style="margin-top:6px">${esc(v.reason)}</div></div>
        <table><thead><tr style="color:var(--text-muted)"><th>날짜</th><th>지출</th><th>팔로우</th><th>팔로워당 비용</th><th>프로필방문</th></tr></thead>
            <tbody>${rows || `<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">${daily == null ? '불러오는 중…' : '일자별 수치 없음'}</td></tr>`}</tbody></table>
        <div style="font-size:.72rem;color:var(--text-muted);margin-top:12px;line-height:1.6">
            도달(기간 전체, 중복 제외) ${c.reach != null ? won(c.reach) : '—'}${c.reach_since ? ` · ${md(c.reach_since)}~${md(c.reach_until)}` : ''}<br>
            광고 ${(c.ad_names || []).map(esc).join(' · ') || '—'}<br>
            광고 ID ${esc(ids || '—')} · 계정 ${esc((c.ad_accounts || []).join(', ') || '—')}<br>
            기여: 광고세트 설정 기준(광고관리자와 같음)</div>
        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
            ${c.permalink ? `<a href="${esc(c.permalink)}" target="_blank" rel="noopener" class="ar-chip">게시물 보기</a>` : ''}
            ${amLink ? `<a href="${esc(amLink)}" target="_blank" rel="noopener" class="ar-chip">광고관리자에서 보기</a>` : ''}</div>
    </div>`;
}
