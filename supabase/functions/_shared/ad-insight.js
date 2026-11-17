//  광고 인사이트(110) — 순수 판정. 화면(main.js)·수집기(ad-report-sync)·테스트가 같이 쓴다. LLM 없음.
//  사장님(11-17): "브랜드마다 광고 성과 데이터가 쌓이니까 그걸로 브랜드에 맞는 광고를 찾아가는 형태도 있어야돼.
//                  그리고 광고는 피로도가 쌓이면서 효율이 떨어지니 그것도 객관적 검증할 방법이 필요해"
//
//  1) 피로도 판정 fatigueOf(days, opts)
//     · 1명당 비용(cpf) = 3일 합 지출 ÷ 3일 합 팔로우(지출 있는 날 3개, 팔로우 합 FATIGUE.minFollows3 이상일 때만 값).
//     · 기준 = 시작 이후(예산이 바뀌었으면 바뀐 뒤) 가장 좋았던 3일 cpf.
//         11-17 실측(hhh_1010): 캠페인 예산 5만→8만(10-15) 뒤 cpf 가 249→480원으로 한 번에 올라 그대로 유지.
//         예산을 올리면 단가가 오르는 건 피로가 아니라 규모 효과 → 예산이 바뀌면 기준을 그 뒤로 다시 잡는다.
//     · 나쁜 날 = cpf 가 기준보다 30%↑. 예산이 바뀐 날·다음날은 판정하지 않는다(연속도 끊는다).
//     · 피로 = 나쁜 날 2일 연속 + 누적 빈도 상승 + 링크 CTR 하락. 셋 다 근거로 남긴다.
//       주의 = 마지막 날이 나쁘거나(1일), 2일 연속인데 빈도·CTR 근거가 안 맞거나 없음.  신선 = 그 밖.
//       보류 = 기준을 아직 못 잡음(지출 3일 미만이거나 팔로우가 적어 cpf 없음).
//     · 빈도는 '누적'(광고 시작~그날) 값을 쓴다. 일별 빈도는 실측 1.00~1.13 으로 거의 움직이지 않아 신호가 아니다.
//  2) 브랜드 × 속성 성과 attrTable(creatives) → 형식·상품·요일·첫 줄별 첫 3일 cpf 중앙값 + 표본.
//     팔로우 합 30명 미만 = 표본 부족(값은 보여도 문장·순위에 안 쓴다). brandSentences 가 3문장으로 요약.

export const FATIGUE = Object.freeze({ worse: 0.30, run: 2, minFollows3: 10, freqRise: 0.05, ctrDrop: 0.10 });
export const MIN_SAMPLE = 30;
export const STATE_LABEL = Object.freeze({ fresh: '신선', warn: '주의', tired: '피로', hold: '보류' });

const num = v => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

//  예산이 바뀐 날 목록 — budgets: [{ day, daily_budget }] (하루 1행 스냅샷, 수집기가 쌓는다)
export function budgetChangeDays(budgets = []) {
    const rows = [...budgets].filter(b => b && b.day).sort((a, b) => String(a.day).localeCompare(String(b.day)));
    const out = [];
    for (let i = 1; i < rows.length; i++) {
        const a = num(rows[i - 1].daily_budget), b = num(rows[i].daily_budget);
        if (a != null && b != null && a !== b) out.push(String(rows[i].day));
    }
    return out;
}

//  3일 창 — 지출 있는 날 기준 연속 3개
function window3(rows, i) {
    if (i < 2) return null;
    const w = rows.slice(i - 2, i + 1);
    const spend = w.reduce((s, r) => s + (num(r.spend) || 0), 0);
    const follows = w.reduce((s, r) => s + (num(r.follows) || 0), 0);
    const imp = w.reduce((s, r) => s + (num(r.impressions) || 0), 0);
    const lc = w.reduce((s, r) => s + (num(r.link_clicks) || 0), 0);
    const hasLc = w.some(r => num(r.link_clicks) != null);
    return {
        from: w[0].day, to: w[2].day, spend, follows,
        cpf: follows >= FATIGUE.minFollows3 ? Math.round(spend / follows) : null,
        ctr: hasLc && imp > 0 ? +(lc / imp * 100).toFixed(2) : null,
        freq: num(w[2].cum_frequency),
    };
}

//  days: [{ day, spend, follows, impressions, link_clicks, cum_frequency }] (한 광고)
//  opts.budgets: [{ day, daily_budget }]  opts.changeDays: ['YYYY-MM-DD'] (둘 중 하나)
export function fatigueOf(days = [], opts = {}) {
    const rows = days.filter(r => r && r.day && (num(r.spend) || 0) > 0).sort((a, b) => String(a.day).localeCompare(String(b.day)));
    const changes = opts.changeDays || budgetChangeDays(opts.budgets || []);
    const lastChange = changes.length ? [...changes].sort().pop() : null;
    const skip = new Set(changes.flatMap(d => [d, addDays(d, 1)]));
    const hold = (why) => ({ state: 'hold', label: STATE_LABEL.hold, reasons: [why], baseline: null, current: null, run: 0, series: [] });
    if (rows.length < 3) return hold('지출 있는 날 3일 미만');

    const series = [];
    let base = null;   // { cpf, from, to, ctr, freq }
    for (let i = 2; i < rows.length; i++) {
        const w = window3(rows, i);
        //  예산이 바뀌면 기준을 다시 잡는다 — 창이 바뀐 날 이후로만 이뤄졌을 때부터
        const afterChange = !lastChange || w.from >= lastChange;
        const inSkip = skip.has(rows[i].day);
        if (w.cpf != null && afterChange && !inSkip && (!base || w.cpf < base.cpf)) base = { cpf: w.cpf, from: w.from, to: w.to, ctr: w.ctr, freq: w.freq };
        series.push({ ...w, day: rows[i].day, skip: inSkip, beforeChange: !afterChange });
    }
    if (!base) return { ...hold(lastChange ? `예산 변경(${lastChange}) 뒤 3일 cpf 아직 없음` : '팔로우가 적어 3일 cpf 없음'), series };

    //  피로는 한 번 걸리면 그 나쁜 구간이 끝날 때까지 유지한다(11-17 실측: CTR 이 경계 ±3% 를 오가며
    //  피로↔주의가 하루 단위로 뒤집혔다. 소재 피로는 저절로 낫지 않는다 — 단가가 기준 +30% 안으로 돌아와야 풀린다).
    let run = 0, latched = null;   // 피로 조건을 다 채운 날
    for (const s of series) {
        s.worse = s.cpf != null ? +(s.cpf / base.cpf - 1).toFixed(3) : null;
        const eligible = !s.skip && !s.beforeChange && s.to > base.to;
        s.bad = eligible && s.worse != null && s.worse >= FATIGUE.worse;
        //  예산 변경 제외일은 연속을 끊지도 잇지도 않는다(그날은 판정 없음)
        if (s.skip && !s.beforeChange) { s.run = run; s.tiredSince = latched; continue; }
        run = s.bad ? run + 1 : 0;
        if (!s.bad) latched = null;
        s.run = run;
        s.freqUp = base.freq != null && s.freq != null ? s.freq - base.freq >= FATIGUE.freqRise - 1e-9 : null;
        s.ctrDown = base.ctr != null && s.ctr != null ? s.ctr <= base.ctr * (1 - FATIGUE.ctrDrop) : null;
        if (!latched && run >= FATIGUE.run && s.freqUp === true && s.ctrDown === true) latched = s.day;
        s.tiredSince = latched;
    }
    const cur = series[series.length - 1];
    const freqUp = cur.freqUp ?? null, ctrDown = cur.ctrDown ?? null;
    const reasons = [];
    const pct = x => `${x >= 0 ? '+' : ''}${Math.round(x * 100)}%`;
    if (cur.worse != null) reasons.push(`1명당 ${base.cpf.toLocaleString()}원 → ${cur.cpf.toLocaleString()}원(${pct(cur.worse)})`);
    reasons.push(freqUp == null ? '누적 빈도 미확인' : `누적 빈도 ${base.freq.toFixed(2)} → ${cur.freq.toFixed(2)}${freqUp ? '(상승)' : '(그대로)'}`);
    reasons.push(ctrDown == null ? 'CTR 미확인' : `링크 CTR ${base.ctr}% → ${cur.ctr}%${ctrDown ? '(하락)' : '(유지)'}`);
    if (cur.skip) reasons.push('오늘은 예산 변경 직후라 판정 제외');

    let state = 'fresh';
    if (cur.tiredSince) state = 'tired';
    else if (cur.run >= 1) state = 'warn';
    if (cur.tiredSince && cur.tiredSince !== cur.day) reasons.push(`${cur.tiredSince} 에 피로 조건(2일 연속·빈도↑·CTR↓)을 다 채웠고 단가가 아직 기준+30% 위라 유지`);
    return {
        state, label: STATE_LABEL[state], run: cur.run, tiredSince: cur.tiredSince || null, reasons,
        baseline: base, current: { day: cur.day, from: cur.from, to: cur.to, cpf: cur.cpf, ctr: cur.ctr, freq: cur.freq, worse: cur.worse },
        freqUp, ctrDown, lastChange, series,
    };
}

//  ---- 속성 ----
const FORMAT = { REELS: '릴스', CAROUSEL_ALBUM: '캐러셀', IMAGE: '사진', VIDEO: '영상' };
export function formatOf(m = {}) {
    if (String(m.media_product_type || '').toUpperCase() === 'REELS') return '릴스';
    return FORMAT[String(m.media_type || '').toUpperCase()] || '미상';
}
//  상품 — ad_links.product_tag(손으로 지정)가 먼저, 없으면 세트·광고 이름 규칙(brand_MMDD상품_PV)에서 뽑는다
export function productOf(link = {}) {
    if (link.product_tag && String(link.product_tag).trim()) return String(link.product_tag).trim();
    const raw = String(link.adset_name || link.ad_name || '').normalize('NFC');
    let s = raw.replace(/\s*-\s*사본.*$/, '').replace(/^(hhh|lohi|tovee|하헤호|로하이|토비)[_\s]*/i, '')
        .replace(/[_\s]*(PV|boost|광고)([_\s].*)?$/i, '').replace(/[_\s]*광고([_\s].*)?(세트)?$/, '')
        .replace(/^\d{3,4}/, '').replace(/^[_\s]+|[_\s]+$/g, '');
    if (/^\d*$/.test(s)) return '미상';
    return s.slice(0, 20);
}
const WD = ['일', '월', '화', '수', '목', '금', '토'];
export const weekdayOf = day => (day && /^\d{4}-\d{2}-\d{2}/.test(day) ? WD[new Date(String(day).slice(0, 10) + 'T00:00:00Z').getUTCDay()] + '요일' : '미상');
export function firstLineOf(caption) {
    const line = String(caption || '').split(/\r?\n/).map(s => s.trim()).find(Boolean);
    if (!line) return '미상';
    return line.length > 30 ? line.slice(0, 30) + '…' : line;
}

//  크리에이티브(게시물) 단위 첫 3일 — links·daily·media 로 만든다. 같은 게시물에 광고가 여럿이면 합친다.
//  반환: [{ key, brand_id, media_id, format, product, weekday, first_line, days, spend3, follows3, cpf3 }]
export function creativesOf({ links = [], daily = [], media = [] } = {}) {
    const mById = new Map(media.map(m => [String(m.media_id), m]));
    const groups = new Map();
    for (const l of links) {
        if (l.excluded) continue;
        const key = l.media_id ? 'm:' + l.media_id : 'a:' + l.ad_id;
        if (!groups.has(key)) groups.set(key, { key, brand_id: l.brand_id ?? null, media_id: l.media_id ?? null, link: l, ads: new Set() });
        groups.get(key).ads.add(String(l.ad_id));
    }
    const out = [];
    for (const g of groups.values()) {
        const byDay = new Map();
        for (const d of daily) if (g.ads.has(String(d.ad_id)) && (num(d.spend) || 0) > 0) {
            const v = byDay.get(d.day) || { spend: 0, follows: 0 };
            v.spend += num(d.spend) || 0; v.follows += num(d.follows) || 0; byDay.set(d.day, v);
        }
        const ds = [...byDay.keys()].sort();
        if (!ds.length) continue;
        const first = ds.slice(0, 3);
        const spend3 = first.reduce((s, d) => s + byDay.get(d).spend, 0), follows3 = first.reduce((s, d) => s + byDay.get(d).follows, 0);
        const m = g.media_id ? mById.get(String(g.media_id)) || {} : {};
        out.push({
            key: g.key, brand_id: g.brand_id, media_id: g.media_id,
            format: formatOf(m), product: productOf(g.link), weekday: weekdayOf(m.posted_day), first_line: firstLineOf(m.caption),
            days: first.length, spend3, follows3, cpf3: follows3 > 0 ? Math.round(spend3 / follows3) : null,
        });
    }
    return out;
}

export function median(xs) {
    const a = xs.filter(x => Number.isFinite(x)).sort((p, q) => p - q);
    if (!a.length) return null;
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
}

export const ATTRS = Object.freeze([['format', '형식'], ['product', '상품'], ['weekday', '게시 요일'], ['first_line', '캡션 첫 줄']]);
//  브랜드 × 속성 표 — 첫 3일을 다 채운 크리에이티브만(3일 미만은 아직 진행 중이라 뺀다)
export function attrTable(creatives = []) {
    const full = creatives.filter(c => c.days >= 3);
    const rows = [];
    for (const [attr, label] of ATTRS) {
        const g = new Map();
        for (const c of full) {
            const k = `${c.brand_id}|${c[attr]}`;
            if (!g.has(k)) g.set(k, { brand_id: c.brand_id, attr, attr_label: label, value: c[attr], items: [] });
            g.get(k).items.push(c);
        }
        for (const v of g.values()) {
            const follows = v.items.reduce((s, c) => s + c.follows3, 0), spend = v.items.reduce((s, c) => s + c.spend3, 0);
            rows.push({
                brand_id: v.brand_id, attr: v.attr, attr_label: v.attr_label, value: v.value,
                n: v.items.length, follows, spend, median_cpf: median(v.items.map(c => c.cpf3)),
                enough: follows >= MIN_SAMPLE, note: follows >= MIN_SAMPLE ? null : '표본 부족',
            });
        }
    }
    return rows.sort((a, b) => String(a.brand_id).localeCompare(String(b.brand_id)) || a.attr.localeCompare(b.attr) || (a.median_cpf ?? 1e12) - (b.median_cpf ?? 1e12));
}

//  브랜드 한 곳을 3문장으로 — 형식 · 상품 · 요일. 표본 충분한 값이 2개 이상일 때만 비교 문장.
export function brandSentences(rows = [], brandId, brandName = '') {
    const who = brandName || '이 브랜드';
    const won = n => `${Number(n).toLocaleString()}원`;
    const one = (attr, label) => {
        const ok = rows.filter(r => r.brand_id === brandId && r.attr === attr && r.enough && r.median_cpf != null && r.value !== '미상')
            .sort((a, b) => a.median_cpf - b.median_cpf);
        if (ok.length >= 2) {
            const best = ok[0], worst = ok[ok.length - 1];
            return `${label}은 '${best.value}'가 1명당 ${won(best.median_cpf)}(게시물 ${best.n}개·팔로우 ${best.follows}명)으로 '${worst.value}' ${won(worst.median_cpf)}보다 싸다.`;
        }
        if (ok.length === 1) return `${label}은 '${ok[0].value}'만 표본이 차서(팔로우 ${ok[0].follows}명) 아직 비교할 상대가 없다.`;
        if (!rows.some(r => r.brand_id === brandId && r.attr === attr && r.value !== '미상'))
            return `${label}은 아직 데이터 없음(게시물 정보가 안 붙은 광고뿐).`;
        return `${label}은 표본 부족(값마다 팔로우 ${MIN_SAMPLE}명 미만)이라 아직 판단하지 않는다.`;
    };
    return [one('format', `${who} 형식`), one('product', '상품'), one('weekday', '게시 요일')];
}

//  ---- 타기팅 요약(디자이너 요청: 화면 칸, 없으면 '—') — 광고세트 targeting 원본 → 사람 말 ----
const COUNTRY = { KR: '대한민국', JP: '일본', US: '미국', CN: '중국', TW: '대만' };
export function targetingOf(t) {
    if (!t || typeof t !== 'object') return { target_age: null, target_gender: null, target_region: null, target_summary: null };
    const lo = num(t.age_min), hi = num(t.age_max);
    const age = lo || hi ? `${lo ?? 18}-${hi && hi < 65 ? hi : '65+'}` : null;
    const g = Array.isArray(t.genders) ? t.genders.map(Number) : [];
    const gender = g.length === 1 ? (g[0] === 2 ? '여성' : g[0] === 1 ? '남성' : null) : '전체';
    const geo = t.geo_locations || {};
    const places = [
        ...(geo.cities || []).map(c => c && c.name), ...(geo.regions || []).map(r => r && r.name),
        ...(geo.countries || []).map(c => COUNTRY[c] || c),
    ].filter(Boolean);
    const region = places.length ? (places.length > 1 ? `${places[0]} 외 ${places.length - 1}` : places[0]) : null;
    const names = (arr) => (arr || []).map(x => x && x.name).filter(Boolean);
    const interests = (t.flexible_spec || []).flatMap(f => [...names(f.interests), ...names(f.behaviors)]);
    const customs = names(t.custom_audiences);
    const parts = [age && `${age}세`, gender, region];
    if (customs.length) parts.push(`맞춤 ${customs.slice(0, 2).join('·')}${customs.length > 2 ? ` 외 ${customs.length - 2}` : ''}`);
    if (interests.length) parts.push(`관심사 ${interests.slice(0, 2).join('·')}${interests.length > 2 ? ` 외 ${interests.length - 2}` : ''}`);
    if (t.targeting_automation && Number(t.targeting_automation.advantage_audience) === 1) parts.push('어드밴티지+');
    const summary = parts.filter(Boolean).join(' · ') || null;
    return { target_age: age, target_gender: gender, target_region: region, target_summary: summary };
}

//  수집기가 ad_fatigue 에 쓰는 행 — fatigueOf 결과 → 110 칸
export function fatigueRow(adId, r, judgedAt) {
    const day = r.current?.day || (r.series && r.series.length ? r.series[r.series.length - 1].day : null);
    if (!day) return null;
    return {
        ad_id: adId, day, state: r.state,
        baseline_cpf: r.baseline?.cpf ?? null, baseline_from: r.baseline?.from ?? null, baseline_to: r.baseline?.to ?? null,
        current_cpf: r.current?.cpf ?? null, worse_pct: r.current?.worse ?? null, run_days: r.run || 0,
        freq_from: r.baseline?.freq ?? null, freq_to: r.current?.freq ?? null, ctr_from: r.baseline?.ctr ?? null, ctr_to: r.current?.ctr ?? null,
        tired_since: r.tiredSince ?? null, last_change: r.lastChange ?? null, reasons: r.reasons || [], rule_version: '110-1', judged_at: judgedAt,
    };
}
