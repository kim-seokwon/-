//  전 화면 공통 자료 상태(⑤) — 설계: .work/개선요청/공통상태-설계.md
//  로더는 실패를 빈 배열(정상 0건)로 덮지 않는다. 블록마다 아래 계약 하나를 들고 같은 순서로 판정한다.
//    phase: idle | loading | ready | failed
//    error / errorKind: 마지막 실패(원문은 화면에 안 보임) · network | permission | schema | collector | unknown
//    checkedAt: 이 브라우저가 조회를 끝낸 시각(성공·실패 모두) · okAt: 마지막 성공 조회 시각
//    sourceSuccessAt: 원본 수집·동기화의 마지막 성공 시각(모르면 null — 지금 시각으로 대신하지 않음)
//    lastGood: 화면에 마지막 정상 자료를 유지 중인지
export const newState = () => ({ phase: 'idle', error: null, errorKind: null, checkedAt: null, okAt: null, sourceSuccessAt: null, lastGood: false });

export const errorKind = e => {
    const m = String(e?.message || e?.msg || e || '').toLowerCase(), c = String(e?.code || '');
    if (c === '42501' || /permission|not allowed|jwt|rls|401|403|unauthor/.test(m)) return 'permission';
    if (/^42p01|^42703|^pgrst2/.test(c.toLowerCase()) || /does not exist|schema cache|relation|column/.test(m)) return 'schema';
    if (/fetch|network|timeout|failed to fetch|load failed|abort/.test(m)) return 'network';
    return 'unknown';
};

//  상태 전이 — 원본 상태 객체를 고치지 않고 새로 돌려준다
export const begin = (st) => ({ ...(st || newState()), phase: 'loading' });
export const succeed = (st, now = new Date(), sourceSuccessAt) => ({
    ...(st || newState()), phase: 'ready', error: null, errorKind: null, checkedAt: iso(now), okAt: iso(now), lastGood: true,
    sourceSuccessAt: sourceSuccessAt === undefined ? (st?.sourceSuccessAt ?? null) : (sourceSuccessAt ? iso(sourceSuccessAt) : null),
});
//  실패: 전에 받아 둔 정상 자료가 있으면 lastGood 그대로(화면은 그 자료 + 지연 배너), 없으면 실패 카드
export const fail = (st, e, now = new Date()) => ({
    ...(st || newState()), phase: 'failed', error: String(e?.message || e || '오류'), errorKind: errorKind(e), checkedAt: iso(now),
});

//  로더 공통 — 실패해도 리스트를 []로 덮지 않는다. keep: 마지막 정상 자료(없으면 null → 화면은 실패 카드)
//    run: async () => rows(throw 하면 실패) · 반환 { rows, state }
export const loadInto = async (st, run, now = () => new Date()) => {
    try { const rows = await run(); return { rows: rows || [], state: succeed(st, now()) }; }
    catch (e) { return { rows: null, state: fail(st, e, now()) }; }
};

const iso = d => (d instanceof Date ? d : new Date(d)).toISOString();
const mins = (a, b) => (new Date(a) - new Date(b)) / 60000;

//  ── 지연 기준: 실제 수집 주기(cron)에서 산출 ─────────────────────────────
//  분·시 두 칸만 본다(일·월·요일은 * 만 씀 — 지금 걸린 잡 전부 확인 11-20). UTC 기준.
const field = (f, lo, hi) => {
    const out = new Set();
    for (const part of String(f).split(',')) {
        const [rng, stepS] = part.split('/'); const step = stepS ? +stepS : 1;
        let [a, b] = rng === '*' ? [lo, hi] : rng.split('-').map(Number);
        if (b === undefined) b = stepS ? hi : a;
        for (let v = a; v <= b; v += step) out.add(v);
    }
    return [...out].sort((x, y) => x - y);
};
//  하루 안 실행 분(0~1439) 목록
export const cronRuns = expr => {
    const [m, h, ...rest] = String(expr).trim().split(/\s+/);
    if (rest.length !== 3 || rest.some(x => x !== '*')) throw new Error('일·월·요일 칸은 * 만: ' + expr);
    const out = []; for (const hh of field(h, 0, 23)) for (const mm of field(m, 0, 59)) out.push(hh * 60 + mm);
    return out.sort((a, b) => a - b);
};
//  가장 긴 실행 간격(분) — 하루를 넘겨 다음 날 첫 실행까지 포함
export const maxGapMin = expr => {
    const r = cronRuns(expr); let g = 0;
    for (let i = 0; i < r.length; i++) g = Math.max(g, (i + 1 < r.length ? r[i + 1] : r[0] + 1440) - r[i]);
    return g;
};
//  지연 기준 = 가장 긴 간격 + 여유(간격의 절반, 5~60분). 한 번 빠지면 바로 지연으로 본다.
//  여러 잡이 같은 자료를 채우면 가장 촘촘한 잡 기준(하나라도 돌면 최신).
export const staleAfterMin = (...exprs) => {
    const g = Math.min(...exprs.map(maxGapMin));
    return g + Math.min(60, Math.max(5, Math.round(g / 2)));
};
//  자료원별 수집 잡(운영 cron.job · .github/workflows 의 schedule, 읽기 전용 확인 2026-11-20)
export const SOURCE_CRON = {
    orders_cafe24: ['*/5 * * * *'],                  // pg_cron cafe24-sync
    orders_29cm: ['17 21 * * *'],                    // GH 29cm-sync
    orders_kidikidi: ['0 0,6 * * *'],                // GH kidikidi-sync
    ads: ['0 0,3,6,9,12 * * *'],                     // pg_cron ad-report-sync
    ig: ['0 * * * *'],                               // pg_cron instagram-sync-daily(sync_log ig:sync). apify-ig-sync(*/10)는 경쟁사(ig:competitors)만 — 자사 지연 판단에서 뺌
    news: ['20 23 * * *', '30 22 * * *'],            // pg_cron news-sync-daily · GH news-collect
    product_sales: ['3-59/10 * * * *'],              // pg_cron product-sales-refresh
};
export const STALE_MIN = Object.fromEntries(Object.entries(SOURCE_CRON).map(([k, v]) => [k, staleAfterMin(...v)]));
//  몰 채널 → 지연 기준 키(malls.channel 실제 값 cafe24·29cm·eland, 11-20 읽기 확인)
export const ORDER_SRC = { cafe24: 'orders_cafe24', '29cm': 'orders_29cm', eland: 'orders_kidikidi' };

//  주문 원본 신선도 — 몰마다 마지막 수집 성공을 채널 지연 기준과 비교
//  lastOkOf(m): 시각 | null(성공 기록 없음) | undefined(기록을 못 읽음 → 판단 보류, 지연으로 단정하지 않음)
//  멈춘 몰(active=false)·연결 끊긴 몰(connected=false)만 뺀다. 알림 끈 몰(alert_enabled=false)도 화면 지연 판정엔 넣는다(111: 알림만 끔)
export const mallsFreshness = (malls, lastOkOf, now = new Date()) => {
    const linked = (malls || []).filter(m => m && m.active !== false && m.connected !== false);
    if (!linked.length) return { linked: false, stale: [], oldest: null };
    const stale = [];
    for (const m of linked) {
        const lim = STALE_MIN[ORDER_SRC[m.channel]];
        //  alert_enabled 는 알림만 끈다(111) — 화면 상태 판정에는 쓰지 않는다
        if (lim == null) continue;
        const at = lastOkOf(m);
        if (at === undefined) continue;
        if (!at || mins(now, at) > lim) stale.push({ mall: m, at: at || null, limitMin: lim });
    }
    //  가장 오래 멈춘 몰 기준(기록 없음이 있으면 null — '기록 없음' 문구)
    const oldest = stale.some(x => !x.at) ? null : stale.map(x => x.at).sort()[0] || null;
    return { linked: true, stale, oldest };
};

//  ── 판정: 미연동 → 최초 로딩 → 실패(정상본 없음) → 지연/새로고침 실패(정상본 있음) → 조건 해당 없음 → 정상 0건 → 정상 ──
//  ctx: { linked: true|false|undefined, total, visible, staleMin, now }
export const classify = (st, ctx = {}) => {
    const s = st || newState(), now = ctx.now || new Date();
    if (ctx.linked === false) return 'unlinked';
    if (!s.lastGood && (s.phase === 'idle' || s.phase === 'loading')) return 'loading';
    if (!s.lastGood && s.phase === 'failed') return 'failed';
    if (s.lastGood && s.phase === 'failed') return 'stale';
    if (ctx.staleMin != null && s.sourceSuccessAt && mins(now, s.sourceSuccessAt) > ctx.staleMin) return 'stale';
    //  외부 수집 자료는 0건이어도 성공 기록이 없으면 '정상 0건'이 아니라 지연(기록 없음)
    if (ctx.staleMin != null && s.lastGood && !s.sourceSuccessAt && ctx.requireSource) return 'stale';
    if ((ctx.total ?? 0) > 0 && ctx.visible === 0) return 'filtered';
    if (ctx.total === 0) return 'empty';
    return 'ready';
};

//  화면에 보일 시각 — 모르면 '기록 없음'(현재 시각으로 대신하지 않음)
const pad = n => String(n).padStart(2, '0');
export const fmtAt = (at, now = new Date()) => {
    if (!at) return '기록 없음';
    const d = new Date(at), n = new Date(now);
    const t = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return d.toDateString() === n.toDateString() ? t : `${d.getMonth() + 1}/${d.getDate()} ${t}`;
};
//  지연 길이 글자(예: 3시간째)
export const agoText = (at, now = new Date()) => {
    const m = Math.floor(mins(now, at));
    return m < 60 ? `${Math.max(m, 1)}분째` : m < 1440 ? `${Math.floor(m / 60)}시간째` : `${Math.floor(m / 1440)}일째`;
};

//  조사 — 받침 있으면 a(을·이), 없으면 b(를·가). 영문·숫자는 읽는 소리로(CS=씨에스 → 를, 카페24=사 → 가)
export const josa = (w, a, b) => {
    const c = String(w || '').trim().slice(-1), code = c.charCodeAt(0) - 0xAC00;
    if (code >= 0 && code < 11172) return w + (code % 28 ? a : b);
    if (/[0-9]/.test(c)) return w + ('013678'.includes(c) ? a : b);
    if (/[a-z]/i.test(c)) return w + ('lmnr'.includes(c.toLowerCase()) ? a : b);
    return w + a + '(' + b + ')';
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ICON = { empty: 'check-circle', loading: 'spinner-gap', failed: 'warning-circle', stale: 'clock-countdown', unlinked: 'plugs', filtered: 'funnel-x' };
const KIND_TEXT = { network: '네트워크 연결 문제', permission: '권한 문제', schema: '서버 준비(SQL) 문제', collector: '수집기 문제', unknown: '알 수 없는 문제' };

//  DataState — 6상태 카드. what: '주문'·'CS' 같은 자료명. actions: [{label, on(onclick 문자열), primary}]
//  size: full | panel | table | inline
export const dataStateHtml = (kind, st, o = {}) => {
    if (kind === 'ready') return '';
    const s = st || newState(), now = o.now || new Date(), what = o.what || '자료';
    const T = {
        empty: [o.emptyTitle || `아직 ${josa(what, '이', '가')} 없습니다`, o.emptySub || (o.external ? '수집은 정상입니다.' : '')],
        loading: [`${josa(what, '을', '를')} 불러오는 중`, ''],
        failed: [`${josa(what, '을', '를')} 불러오지 못했습니다`, KIND_TEXT[s.errorKind] || KIND_TEXT.unknown],
        stale: s.phase === 'failed'
            ? [`새로 불러오지 못했습니다`, `${fmtAt(s.okAt, now)} 정상 자료를 표시 중`]
            : s.sourceSuccessAt
                ? [`수집이 ${agoText(s.sourceSuccessAt, now)} 멈췄습니다`, `${fmtAt(s.sourceSuccessAt, now)} 정상 자료를 표시 중`]
                : [`수집 성공 기록이 없습니다`, `원본이 언제 수집됐는지 확인되지 않아 최신이 아닐 수 있습니다`],
        unlinked: [o.unlinkedTitle || `${josa(o.source || what, '이', '가')} 연결되지 않았습니다`, o.unlinkedSub || ''],
        filtered: [`이 조건에 맞는 ${josa(what, '이', '가')} 없습니다`, o.filterText || ''],
    }[kind] || ['', ''];
    const acts = (o.actions || []).slice(0, 2).map(a => `<button class="ds-btn${a.primary ? ' is-primary' : ''}" onclick="${esc(a.on)}">${esc(a.label)}</button>`).join('');
    const note = o.note ? `<span class="ds-s">${esc(o.note)}</span>` : '';
    const times = kind === 'loading' ? '' : `<div class="ds-at"><span>화면 확인 ${esc(fmtAt(s.checkedAt, now))}</span>${o.external || s.sourceSuccessAt ? `<span>원본 ${o.external ? '수집 성공' : '최신 변경'} ${esc(fmtAt(s.sourceSuccessAt, now))}</span>` : ''}</div>`;
    return `<div class="ds ds-${kind} ds-${o.size || 'panel'}" role="${kind === 'failed' ? 'alert' : 'status'}" data-ds="${kind}">
        <i class="ph ph-${ICON[kind]} ds-ic"></i><div class="ds-body"><b class="ds-t">${esc(T[0])}</b>${T[1] ? `<span class="ds-s">${esc(T[1])}</span>` : ''}${note}${times}</div>
        ${acts ? `<div class="ds-acts">${acts}</div>` : ''}</div>`;
};
