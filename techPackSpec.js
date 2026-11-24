//  8 작업지시서 — 품목별 양식 · 사이즈별 치수(측정 위치·허용오차) · 원단/부자재 규격 · 가공 · 라벨 위치 · 봉제 지시
//               · 이전 버전과 변경점 비교 · 패턴 기능의 검증 범위 안내 (순수 함수 — 그림 모듈(sampleMaker)을 부르지 않는다)
//  설정은 tech_packs.config.spec 한 칸에 담는다(새 DB 칸 없음). 비어 있으면 품목별 기본값으로 채워 보인다.

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };

//  부위별 측정 위치 · 기본 허용오차(±cm) · 기본 사이즈 편차(cm)
//  출처: 아동복 봉제 공장 통상 측정법(단면=좌우 끝 사이 직선, 평평하게 놓고 늘리지 않음)
export const MEASURE_GUIDE = {
    shoulder:    { how: '어깨솔기 끝 ↔ 끝 직선', tol: 0.5, step: 2 },
    chest:       { how: '암홀 아래 1cm 지점, 좌우 옆선 사이 직선', tol: 0.5, step: 2 },
    armhole:     { how: '어깨솔기 끝 → 겨드랑이 봉제점, 곡선 따라', tol: 0.5, step: 1 },
    length:      { how: '옆목점(HPS)부터 밑단 끝까지 수직', tol: 1.0, step: 3 },
    sleeve:      { how: '어깨솔기 끝부터 소매부리 끝까지 바깥선', tol: 1.0, step: 2.5 },
    cuffOpening: { how: '소매부리 끝 단면(리브는 늘리지 않고)', tol: 0.5, step: 0.5 },
    hem:         { how: '밑단 끝 좌우 단면', tol: 0.5, step: 2 },
    neck:        { how: '옆목점 ↔ 옆목점 직선(시접 제외)', tol: 0.5, step: 0.5 },
    hood:        { how: '옆목점부터 후드 정수리까지 수직', tol: 1.0, step: 1 },
    waist:       { how: '허리 위끝 좌우 단면(밴딩 늘리지 않고)', tol: 0.5, step: 2 },
    hip:         { how: '허리 위끝에서 밑위 2/3 아래 지점 단면', tol: 0.5, step: 2 },
    thigh:       { how: '가랑이 봉제점 아래 2.5cm 단면', tol: 0.5, step: 1.5 },
    rise:        { how: '앞중심 허리 위끝 → 가랑이 봉제점', tol: 0.5, step: 1.5 },
    inseam:      { how: '가랑이 봉제점 → 밑단 끝(안솔기)', tol: 1.0, step: 3 },
    bibHeight:   { how: '허리선부터 가슴받이 위끝까지 수직', tol: 0.5, step: 1.5 },
    bibWidth:    { how: '가슴받이 위끝 좌우 단면', tol: 0.5, step: 1 },
    strap:       { how: '뒤 멜빵 시작점 → 앞 단추구멍 중심', tol: 1.0, step: 2 },
    headCirc:    { how: '땀받이 안쪽 둘레(줄자로 한 바퀴)', tol: 0.5, step: 1 },
    capDepth:    { how: '앞중심 챙 이음선 → 정수리 단추 아래', tol: 0.5, step: 0.5 },
    brimLen:     { how: '챙 이음선 중앙 → 챙 앞끝', tol: 0.3, step: 0.3 },
    brimWidth:   { how: '챙 좌우 끝 직선', tol: 0.5, step: 0.5 },
};
//  니트는 늘어나는 원단이라 둘레·길이 허용을 1.0으로 넓힌다
const KNIT_TOL = { chest: 1.0, hem: 1.0, shoulder: 1.0, armhole: 1.0, cuffOpening: 1.0 };

//  품목별 양식 — 그 품목에서만 묻는 칸 · 봉제 지시 · 라벨 위치 · 가공 기본값
const COMMON_LABELS = { main: '후넥 중앙(넥 테이프 아래 1cm)', care: '좌측 옆선 밑단 위 10cm', size: '메인라벨 아래 겹침', hang: '메인라벨 고리 · 택끈' };
export const TP_FORMS = {
    top: {
        label: '상의', extra: [],
        sewing: '본봉 땀수 3cm당 12땀 · 시접 1cm 오버록 4사\n어깨 테이프 보강\n밑단·소매부리 삼봉 2/4"',
        labels: COMMON_LABELS, process: '',
    },
    dress: {
        label: '원피스', extra: [{ key: 'closure', label: '여밈(단추·지퍼 위치)', ph: '뒤 중심 콘솔지퍼 35cm' }],
        sewing: '본봉 3cm당 12땀 · 시접 1cm 오버록 4사\n허리 절개선 가름솔\n밑단 말아박기 1cm',
        labels: COMMON_LABELS, process: '',
    },
    knit: {
        label: '니트', extra: [
            { key: 'yarn', label: '원사(번수·혼용)', ph: '울 30% 아크릴 70% 2/48' },
            { key: 'gauge', label: '게이지', ph: '12GG' },
            { key: 'stitch', label: '조직', ph: '몸판 평편 · 밑단 1x1 고무단' },
            { key: 'linking', label: '링킹·마감', ph: '어깨·옆선 링킹, 넥 1x1 링킹' },
        ],
        sewing: '몸판·소매 성형 편직(재단 금지)\n어깨·옆선·소매 링킹\n넥 1x1 고무단 링킹 후 실밥 정리',
        labels: { ...COMMON_LABELS, main: '후넥 중앙 손바느질(링킹 위)', care: '좌측 옆선 밑단 위 8cm 손바느질' },
        process: '편직 후 축융(스팀) · 치수 고정 후 측정',
    },
    pants: {
        label: '바지', extra: [],
        sewing: '본봉 3cm당 12땀 · 시접 1cm 오버록 4사\n가랑이·밑위 이중 본봉(쌍침)\n밑단 삼봉 2/4"',
        labels: { ...COMMON_LABELS, main: '뒤 허리 중앙(밴드 안쪽)', care: '좌측 옆선 허리 아래 10cm' }, process: '',
    },
    overall: {
        label: '오버롤', extra: [
            { key: 'buckle', label: '멜빵 조절(버클·단추)', ph: '오버롤 버클 25mm · 단추 2단 조절' },
            { key: 'sideOpen', label: '옆트임·여밈', ph: '좌우 옆트임 12cm · 단추 2개' },
        ],
        sewing: '본봉 3cm당 12땀 · 시접 1cm 오버록 4사\n가슴받이 겉감·안단 겹박음 후 상침 0.5cm\n멜빵 끝 바텍 보강 · 밑위 쌍침',
        labels: { ...COMMON_LABELS, main: '뒤 허리 중앙 안쪽', care: '좌측 옆트임 아래 5cm' }, process: '',
    },
    cap: {
        label: '모자', extra: [
            { key: 'panels', label: '패널 수·구조', ph: '6패널 · 앞 2패널 심지' },
            { key: 'brimCore', label: '챙 심지', ph: 'PE 심지 1.2mm · 8줄 스티치' },
            { key: 'closure', label: '조절', ph: '뒤 스트랩 금속 버클' },
            { key: 'sweatband', label: '땀받이', ph: '면 테이프 30mm' },
        ],
        sewing: '패널 이음 가름솔 후 양쪽 상침\n이음선 안쪽 테이핑\n챙 상침 8줄 · 정수리 단추 감싸기',
        labels: { main: '땀받이 뒤 중앙', care: '땀받이 왼쪽 안쪽', size: '메인라벨 옆', hang: '조절 스트랩 · 택끈' }, process: '',
    },
};
//  옷 종류 → 양식
export function formOf(type, category) {
    if (TP_FORMS[type]) return type;
    if (category === 'cap') return 'cap';
    if (category === 'pants') return 'pants';
    return 'top';
}
export const DEFAULT_SIZES = ['90', '100', '110', '120'];

//  사이즈 목록 — 쉼표·공백 구분 입력을 정리(빈 칸·중복 제거)
export function parseSizes(text) {
    const out = [];
    String(text || '').split(/[,\s/]+/).map(s => s.trim()).filter(Boolean).forEach(s => { if (!out.includes(s) && out.length < 10) out.push(s); });
    return out;
}

//  기준 사이즈 — '110 (5~6세)' 처럼 적어도 사이즈 목록의 '110'에 맞춘다
export function baseSizeOf(sizes, sizeText) {
    const t = String(sizeText || '').trim();
    const hit = sizes.find(s => s === t) || sizes.find(s => t.startsWith(s + ' ') || t.startsWith(s + '(')) || sizes.find(s => t.includes(s));
    return hit || sizes[Math.min(2, sizes.length - 1)] || '';
}

//  정리된 사양 — 저장된 spec 위에 품목 기본값을 덮어 빈 칸이 없게
//  def = 그림 모듈의 옷 정의({ id, category, measure:[{key,label}] })
export function specOf(cfg, def) {
    const s = (cfg && cfg.spec) || {};
    const form = formOf(def?.id || cfg?.type, def?.category);
    const F = TP_FORMS[form];
    const sizes = Array.isArray(s.sizes) && s.sizes.length ? s.sizes.map(String) : DEFAULT_SIZES;
    const points = {};
    (def?.measure || []).forEach(m => {
        const g = MEASURE_GUIDE[m.key] || { how: '', tol: 0.5, step: 1 };
        const p = (s.points || {})[m.key] || {};
        const tol0 = form === 'knit' && KNIT_TOL[m.key] != null ? KNIT_TOL[m.key] : g.tol;
        points[m.key] = {
            how: p.how != null && p.how !== '' ? String(p.how) : g.how,
            tol: num(p.tol) != null ? num(p.tol) : tol0,
            step: num(p.step) != null ? num(p.step) : g.step,
        };
    });
    return {
        form, formLabel: F.label, sizes, base: baseSizeOf(sizes, cfg?.size),
        points,
        grade: s.grade && typeof s.grade === 'object' ? s.grade : {},
        fabric: { comp: cfg?.fabric || '', weight: '', width: '', shrink: '', ...(s.fabric || {}) },
        trims: Array.isArray(s.trims) ? s.trims : null,   // null = 자동 목록(옷 정의에서 계산)
        process: s.process != null ? String(s.process) : F.process,
        labels: { ...F.labels, ...(s.labels || {}) },
        sewing: s.sewing != null ? String(s.sewing) : F.sewing,
        extra: { ...(s.extra || {}) },
        extraDefs: F.extra,
    };
}

//  사이즈별 치수표 — 기준 사이즈는 ④ 상세 치수 값, 나머지는 편차로 계산하되 직접 넣은 칸(grade)이 우선
export function gradeRows(cfg, def) {
    const sp = specOf(cfg, def);
    const bi = Math.max(0, sp.sizes.indexOf(sp.base));
    const rows = (def?.measure || []).map(m => {
        const p = sp.points[m.key];
        const baseV = num((cfg?.measure || {})[m.key]);
        const vals = sp.sizes.map((sz, i) => {
            const manual = num(((sp.grade || {})[m.key] || {})[sz]);
            if (i === bi) return { size: sz, v: baseV, manual: false, base: true };
            if (manual != null) return { size: sz, v: manual, manual: true };
            return { size: sz, v: baseV == null ? null : +(baseV + (i - bi) * p.step).toFixed(1), manual: false };
        });
        return { key: m.key, label: m.label, how: p.how, tol: p.tol, step: p.step, vals };
    });
    return { sizes: sp.sizes, baseIdx: bi, rows };
}

//  화면 입력 하나를 spec 에 반영(새 객체) — path 예: 'points.chest.tol' · 'grade.chest.120' · 'fabric.weight' · 'labels.care' · 'sewing'
export function setSpec(cfg, path, value) {
    const spec = JSON.parse(JSON.stringify((cfg && cfg.spec) || {}));
    const keys = String(path).split('.');
    if (keys[0] === 'sizes') { spec.sizes = parseSizes(value); return spec; }
    let o = spec;
    for (let i = 0; i < keys.length - 1; i++) { if (!o[keys[i]] || typeof o[keys[i]] !== 'object') o[keys[i]] = {}; o = o[keys[i]]; }
    const last = keys[keys.length - 1];
    const v = typeof value === 'string' ? value : String(value ?? '');
    if (v.trim() === '' && (keys[0] === 'grade' || keys[0] === 'points')) delete o[last];   // 비우면 계산값·기본값으로
    else o[last] = v;
    return spec;
}

//  부자재 표 — 직접 고친 목록이 없으면 자동 목록을 처음 고칠 때 복사해 쓴다
export function trimsFor(sp, autoTrims) {
    return sp.trims ? sp.trims : (autoTrims || []).map(t => ({ item: t.item, spec: t.spec, qty: t.qty, pos: t.pos || '' }));
}
export function setTrim(cfg, autoTrims, idx, field, value, def) {
    const sp = specOf(cfg, def);
    const list = trimsFor(sp, autoTrims).map(t => ({ ...t }));
    if (field === '_del') list.splice(idx, 1);
    else if (field === '_add') list.push({ item: '', spec: '', qty: '', pos: '' });
    else if (list[idx]) list[idx][field] = String(value ?? '');
    return { ...((cfg && cfg.spec) || {}), trims: list };
}

//  ── 패턴 기능 검증 범위 ───────────────────────────────────────────
//  화면 '패턴' 탭은 ④ 치수로 그린 1차 드래프트다. 생산용으로 검증된 것은 아래 범위뿐.
export const PATTERN_OK = ['기준 사이즈 1벌 완성선(앞·뒤판·소매 / 바지 앞·뒤)', '시접 1cm 점선 표시', '절개선 기준 조각 나누기'];
export const PATTERN_NO = ['사이즈 그레이딩(다른 사이즈 패턴)', '식서·노치(맞춤표시)·요척', '원단 수축률 보정', '니트·모자·오버롤 가슴받이 패턴'];
export function patternScope(form) {
    const unsupported = form === 'cap' || form === 'knit';
    return {
        supported: !unsupported,
        title: unsupported ? `${TP_FORMS[form]?.label || ''} 패턴은 지원하지 않습니다 — 패턴사 패턴으로 진행` : '패턴 = 1차 드래프트(생산 패턴 아님)',
        ok: unsupported ? [] : PATTERN_OK,
        no: PATTERN_NO,
        note: '공장 전달 전 반드시 패턴사가 실물 패턴으로 다시 그리고, 샘플 1벌로 치수를 확인하세요.',
    };
}
export function patternScopeHTML(form) {
    const s = patternScope(form);
    return `<div class="tp-pscope${s.supported ? '' : ' no'}"><b>${esc(s.title)}</b>
        ${s.ok.length ? `<span>검증된 범위: ${s.ok.map(esc).join(' · ')}</span>` : ''}
        <span>지원 안 함: ${s.no.map(esc).join(' · ')}</span><span>${esc(s.note)}</span></div>`;
}

//  ── 변경점 비교 ───────────────────────────────────────────────────
//  이전 버전(a) → 이번 버전(b) 에서 바뀐 값 [{ sec, label, from, to }]. 칸 이름만이 아니라 값까지.
export function specDiff(a, b, defOf) {
    const out = [];
    const ca = (a && a.config) || a || {}, cb = (b && b.config) || b || {};
    const push = (sec, label, x, y) => { const f = x == null || x === '' ? '—' : String(x), t = y == null || y === '' ? '—' : String(y); if (f !== t) out.push({ sec, label, from: f, to: t }); };
    const da = defOf(ca.type), db = defOf(cb.type);
    push('기본', '옷 종류', da?.label, db?.label);
    push('기본', '기준 사이즈', ca.size, cb.size);
    push('기본', '색상', ca.color?.name, cb.color?.name);
    const sa = specOf(ca, da), sb = specOf(cb, db);
    push('치수', '사이즈 전개', sa.sizes.join(' / '), sb.sizes.join(' / '));
    const ga = gradeRows(ca, da), gb = gradeRows(cb, db);
    const keys = [...new Set([...ga.rows.map(r => r.key), ...gb.rows.map(r => r.key)])];
    keys.forEach(k => {
        const ra = ga.rows.find(r => r.key === k), rb = gb.rows.find(r => r.key === k);
        const lb = (rb || ra).label;
        const sizes = [...new Set([...(ra ? ra.vals.map(v => v.size) : []), ...(rb ? rb.vals.map(v => v.size) : [])])];
        sizes.forEach(sz => push('치수', `${lb} ${sz}`, ra?.vals.find(v => v.size === sz)?.v, rb?.vals.find(v => v.size === sz)?.v));
        push('측정', `${lb} 허용오차`, ra ? '±' + ra.tol : null, rb ? '±' + rb.tol : null);
        push('측정', `${lb} 측정 위치`, ra?.how, rb?.how);
    });
    const FL = { comp: '혼용률', weight: '중량', width: '폭', shrink: '수축률' };
    Object.keys(FL).forEach(k => push('원단', FL[k], sa.fabric[k], sb.fabric[k]));
    const ta = JSON.stringify(sa.trims || 'auto'), tb = JSON.stringify(sb.trims || 'auto');
    if (ta !== tb) {
        const la = (sa.trims || []).map(t => `${t.item} ${t.spec}`.trim()), lb2 = (sb.trims || []).map(t => `${t.item} ${t.spec}`.trim());
        const add = lb2.filter(x => !la.includes(x)), del = la.filter(x => !lb2.includes(x));
        out.push({ sec: '부자재', label: '부자재 표', from: del.length ? '뺌: ' + del.join(', ') : (sa.trims ? '직접 입력' : '자동'), to: add.length ? '더함: ' + add.join(', ') : (sb.trims ? '직접 입력(규격·수량 수정)' : '자동') });
    }
    push('가공', '가공', sa.process, sb.process);
    const LL = { main: '메인라벨', care: '케어라벨', size: '사이즈라벨', hang: '행택' };
    Object.keys(LL).forEach(k => push('라벨', LL[k] + ' 위치', sa.labels[k], sb.labels[k]));
    push('봉제', '봉제 지시', sa.sewing, sb.sewing);
    [...new Set([...sa.extraDefs, ...sb.extraDefs].map(x => x.key))].forEach(k => {
        const d = [...sb.extraDefs, ...sa.extraDefs].find(x => x.key === k);
        push('양식', d.label, sa.extra[k], sb.extra[k]);
    });
    const det = c => Object.keys(c.details || {}).filter(k => c.details[k]).sort().join(',');
    if (det(ca) !== det(cb)) out.push({ sec: '디테일', label: '디테일 선택', from: det(ca) || '—', to: det(cb) || '—' });
    push('배치', '로고·프린트 배치 수', (ca.placements || []).length, (cb.placements || []).length);
    if (JSON.stringify(ca.placements || []) !== JSON.stringify(cb.placements || []) && (ca.placements || []).length === (cb.placements || []).length)
        out.push({ sec: '배치', label: '로고·프린트 위치·크기', from: '이전', to: '바뀜' });
    push('비고', '메모', ca.note, cb.note);
    return out;
}
//  비교 대상 — 같은 계보에서 이 문서 바로 앞 버전
export function prevVersionOf(t, same) {
    const v = Number(t?.version || 1);
    return (same || []).filter(x => x !== t && Number(x.version || 1) < v).sort((a, b) => Number(b.version || 1) - Number(a.version || 1))[0] || null;
}

//  확정 정보 줄 — 137 전이면 확정일을 따로 모른다(최종 수정일로 대신하고 그렇게 적는다)
export function confirmLine(t) {
    if (!t) return '';
    const st = t.status || '작성 중';
    if (!['확정', '공장 전달'].includes(st)) return `${st} — 확정 전`;
    if (t.confirmed_at) return `${String(t.confirmed_at).slice(0, 10)} · ${t.confirmed_by || '확정자 기록 없음'}`;
    return `확정일 기록 없음(서버 업데이트 137 전) · 최종 수정 ${String(t.updated_at || t.created_at || '').slice(0, 10)} ${t.updated_by || ''}`.trim();
}

//  ── 편집 화면(⑨ 생산 사양) ─────────────────────────────────────────
export function specEditorHTML(cfg, def, autoTrims) {
    const sp = specOf(cfg, def), gr = gradeRows(cfg, def);
    const inp = (path, val, ph = '', cls = '') => `<input type="text" class="sm-spec ${cls}" data-path="${esc(path)}" value="${esc(val)}" placeholder="${esc(ph)}">`;
    const head = gr.sizes.map((s, i) => `<th class="${i === gr.baseIdx ? 'base' : ''}">${esc(s)}</th>`).join('');
    const rows = gr.rows.map(r => `<tr><td class="lbl">${esc(r.label)}</td>
        ${r.vals.map(v => v.base ? `<td class="base" title="기준 사이즈 — ④ 상세 치수에서 고칩니다">${v.v ?? ''}</td>`
            : `<td><input type="text" inputmode="decimal" class="sm-spec sm-spec-cell${v.manual ? ' manual' : ''}" data-path="grade.${r.key}.${esc(v.size)}" value="${v.manual ? v.v : ''}" placeholder="${v.v ?? ''}" aria-label="${esc(r.label)} ${esc(v.size)}"></td>`).join('')}
        <td><input type="text" inputmode="decimal" class="sm-spec sm-spec-cell" data-path="points.${r.key}.tol" value="${r.tol}" aria-label="${esc(r.label)} 허용오차"></td>
        <td><input type="text" inputmode="decimal" class="sm-spec sm-spec-cell" data-path="points.${r.key}.step" value="${r.step}" aria-label="${esc(r.label)} 편차"></td></tr>
        <tr class="how"><td colspan="${gr.sizes.length + 3}">${inp(`points.${r.key}.how`, r.how, '측정 위치', 'how')}</td></tr>`).join('');
    const trims = trimsFor(sp, autoTrims);
    const trimRows = trims.map((t, i) => `<div class="sm-spec-trim">
        <input type="text" class="sm-trim" data-i="${i}" data-f="item" value="${esc(t.item)}" placeholder="품목" aria-label="부자재 품목">
        <input type="text" class="sm-trim" data-i="${i}" data-f="spec" value="${esc(t.spec)}" placeholder="규격" aria-label="부자재 규격">
        <input type="text" class="sm-trim q" data-i="${i}" data-f="qty" value="${esc(t.qty)}" placeholder="수량" aria-label="부자재 수량">
        <button class="sm-trim-del" data-i="${i}" title="빼기" aria-label="부자재 빼기"><i class="ph ph-x"></i></button></div>`).join('');
    const LL = { main: '메인라벨', care: '케어라벨', size: '사이즈라벨', hang: '행택' };
    return `<div class="sm-spec-box">
        <div class="sm-spec-form">양식: <b>${esc(sp.formLabel)}</b> <span class="sm-hint">(② 의류 종류를 따라 바뀜)</span></div>
        ${sp.extraDefs.length ? `<div class="sm-spec-sub">${esc(sp.formLabel)} 전용</div>${sp.extraDefs.map(x => `<div class="sm-field"><label>${esc(x.label)}</label>${inp('extra.' + x.key, sp.extra[x.key] || '', x.ph)}</div>`).join('')}` : ''}
        <div class="sm-spec-sub">사이즈별 치수 (cm) <span class="sm-hint">빈 칸 = 편차로 계산 · 숫자 넣으면 그 값</span></div>
        <div class="sm-field"><label>사이즈 전개</label>${inp('sizes', sp.sizes.join(', '), '90, 100, 110, 120')}</div>
        <div class="sm-spec-tablewrap"><table class="sm-spec-table"><thead><tr><th>부위</th>${head}<th>허용±</th><th>편차</th></tr></thead><tbody>${rows}</tbody></table></div>
        <div class="sm-spec-sub">원단 규격</div>
        <div class="sm-field-row">
            <div class="sm-field"><label>중량</label>${inp('fabric.weight', sp.fabric.weight, '280g/㎡')}</div>
            <div class="sm-field"><label>폭</label>${inp('fabric.width', sp.fabric.width, '58"')}</div>
            <div class="sm-field"><label>수축률</label>${inp('fabric.shrink', sp.fabric.shrink, '경3% 위2%')}</div>
        </div>
        <div class="sm-spec-sub">부자재 규격 ${sp.trims ? '' : '<span class="sm-hint">(자동 목록 — 고치면 이 문서 목록으로 저장)</span>'}</div>
        ${trimRows}<button class="sm-trim-add"><i class="ph ph-plus"></i> 부자재 추가</button>
        <div class="sm-spec-sub">가공</div>${inp('process', sp.process, '워싱·기모·효소·프린트 후가공')}
        <div class="sm-spec-sub">라벨 위치</div>
        ${Object.keys(LL).map(k => `<div class="sm-field"><label>${LL[k]}</label>${inp('labels.' + k, sp.labels[k])}</div>`).join('')}
        <div class="sm-spec-sub">봉제 지시</div>
        <textarea class="sm-spec" data-path="sewing" rows="4" aria-label="봉제 지시">${esc(sp.sewing)}</textarea>
    </div>`;
}

//  ── 인쇄용 표 ─────────────────────────────────────────────────────
export function specPrintParts(cfg, def, autoTrims) {
    const sp = specOf(cfg, def), gr = gradeRows(cfg, def);
    const sizeHead = gr.sizes.map((sz, i) => `<th class="${i === gr.baseIdx ? 'base' : ''}">${esc(sz)}</th>`).join('');
    const sizeRows = gr.rows.map(r => `<tr><td class="lbl">${esc(r.label)}</td>${r.vals.map((v, i) => `<td class="${i === gr.baseIdx ? 'base' : ''}${v.manual ? ' man' : ''}">${v.v ?? ''}</td>`).join('')}<td class="tol">±${r.tol}</td></tr>`).join('');
    const howRows = gr.rows.map(r => `<tr><td class="lbl">${esc(r.label)}</td><td style="text-align:left">${esc(r.how)}</td><td class="tol">±${r.tol}</td></tr>`).join('');
    const trims = trimsFor(sp, autoTrims);
    const matRows = [`<tr><td class="lbl">겉감</td><td>${esc([sp.fabric.comp || '미지정', sp.fabric.weight, sp.fabric.width && '폭 ' + sp.fabric.width, sp.fabric.shrink && '수축 ' + sp.fabric.shrink].filter(Boolean).join(' · '))}</td><td class="qty">요척별</td></tr>`,
        ...trims.filter(t => t.item !== '겉감').map(t => `<tr><td class="lbl">${esc(t.item)}</td><td>${esc(t.spec)}</td><td class="qty">${esc(t.qty)}</td></tr>`)].join('');
    const LL = { main: '메인라벨', care: '케어라벨', size: '사이즈라벨', hang: '행택' };
    const labelRows = Object.keys(LL).map(k => `<tr><td class="lbl">${LL[k]}</td><td style="text-align:left">${esc(sp.labels[k])}</td></tr>`).join('');
    const extraRows = sp.extraDefs.map(x => `<tr><td class="lbl">${esc(x.label)}</td><td style="text-align:left">${esc(sp.extra[x.key] || '—')}</td></tr>`).join('');
    return { sp, gr, sizeHead, sizeRows, howRows, matRows, labelRows, extraRows };
}
