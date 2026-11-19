//  P0-03 연결 누락 — 데이터·동작 계약(순수 함수). DB 를 직접 부르지 않는다.
//  화면(디자이너)은 이 함수의 결과만 그리고, 저장은 호출하는 쪽이 `store` 로 넘긴다.
//  근거: .work/개선요청-1118/연결누락.md (11-18 운영 읽기 전용 실측)
//  원칙: 자동 지정 금지(후보만 제시) · 미완료 먼저 · 이름으로 테스트 판정 금지 · 삭제 없음.

export const DONE_STATUS = '출고완료';
export const MAIN_STATUS = '메인투입';
const s = v => String(v ?? '').trim();
const isDone = it => s(it?.status) === DONE_STATUS;
const ts = v => { const t = Date.parse(v || ''); return Number.isNaN(t) ? 0 : t; };

// ── (1) 시즌 없음 · 생산처 없음 ─────────────────────────────
//  시즌 = product_items.product_id(→products), 생산처 = product_items.vendor_id(→vendors)
export const GAP_FIELDS = { season: 'product_id', vendor: 'vendor_id' };
export const hasGap = (it, gap) => !s(it?.[GAP_FIELDS[gap]]);

//  미완료 → 메인투입 먼저 → 오래된 것 먼저. 출고완료는 includeDone 일 때만(보관 정리 묶음).
export function gapList(items, gap, { includeDone = false } = {}) {
    if (!GAP_FIELDS[gap]) throw new Error(`unknown gap: ${gap}`);
    return (items || []).filter(it => it && hasGap(it, gap) && (includeDone || !isDone(it)))
        .sort((a, b) => isDone(a) - isDone(b)
            || (s(b.status) === MAIN_STATUS) - (s(a.status) === MAIN_STATUS)
            || ts(a.created_at) - ts(b.created_at));
}
export function gapCounts(items) {
    const o = {};
    for (const g of Object.keys(GAP_FIELDS)) {
        const all = (items || []).filter(it => it && hasGap(it, g));
        o[g] = { open: all.filter(it => !isDone(it)).length, done: all.filter(isDone).length, total: all.length };
    }
    return o;
}

//  후보 — 보여주기만 한다. 고르는 건 사람. (같은 브랜드 시즌, 시작일 가까운 순)
export function seasonCandidates(item, seasons, limit = 5) {
    const at = ts(item?.created_at);
    return (seasons || []).filter(p => p && (!item?.brand_id || !p.brand_id || p.brand_id === item.brand_id))
        .map(p => ({ id: p.id, name: p.name, brand_id: p.brand_id, sameBrand: !!item?.brand_id && p.brand_id === item.brand_id,
            gapDays: Math.round(Math.abs(at - ts(p.start_date || p.created_at)) / 864e5) }))
        .sort((a, b) => b.sameBrand - a.sameBrand || a.gapDays - b.gapDays).slice(0, limit);
}
//  생산처 후보 — 같은 브랜드 제품에 쓰인 횟수 순. 거래 중단(status 'inactive'/'중단') 생산처는 뺀다.
export function vendorCandidates(item, vendors, items, limit = 5) {
    const used = {};
    for (const it of items || []) if (it?.vendor_id && (!item?.brand_id || it.brand_id === item.brand_id)) used[it.vendor_id] = (used[it.vendor_id] || 0) + 1;
    return (vendors || []).filter(v => v && !/inactive|중단/.test(s(v.status)))
        .map(v => ({ id: v.id, name: v.name, uses: used[v.id] || 0 }))
        .sort((a, b) => b.uses - a.uses || s(a.name).localeCompare(s(b.name), 'ko')).slice(0, limit);
}

//  선택 일괄 연결 계획 — 사람이 고른 ids 와 사람이 고른 대상 하나만. 이미 연결된 건 덮어쓰지 않는다.
//  반환 { updates:[{id, patch}], skipped:[{id, reason}] } — 호출자가 updates 만 저장한다.
export function planBulkLink({ items, ids, gap, value, targets }) {
    const field = GAP_FIELDS[gap];
    if (!field) throw new Error(`unknown gap: ${gap}`);
    if (!s(value)) throw new Error('대상을 직접 골라야 합니다(자동 지정 금지)');
    if (!(targets || []).some(t => String(t.id) === String(value))) throw new Error('없는 대상입니다');
    if (!Array.isArray(ids) || !ids.length) throw new Error('선택한 제품이 없습니다');
    const byId = new Map((items || []).map(it => [String(it.id), it]));
    const updates = [], skipped = [];
    for (const id of new Set(ids.map(String))) {
        const it = byId.get(id);
        if (!it) skipped.push({ id, reason: 'not_found' });
        else if (!hasGap(it, gap)) skipped.push({ id, reason: 'already_linked' });
        else updates.push({ id, patch: { [field]: value } });
    }
    return { updates, skipped };
}

// ── (2) 메인투입인데 생산처/생산작업 없음 ────────────────────
export function mainInputGap(item, jobs) {
    if (s(item?.status) !== MAIN_STATUS) return null;
    const mine = (jobs || []).filter(j => String(j?.item_id) === String(item.id));
    const g = { id: item.id, noVendor: !s(item.vendor_id), noPack: !s(item.tech_pack_id), noJob: mine.length === 0 };
    return g.noVendor || g.noJob ? g : null;
}
export const mainInputAlerts = (items, jobs) => (items || []).map(it => mainInputGap(it, jobs)).filter(Boolean);

//  생산 투입 사전채움 — itemToVendor 와 같은 행 모양. 빠진 게 있으면 row 없이 missing 만.
export function prefillVendorJob(item) {
    const missing = [];
    if (!s(item?.vendor_id)) missing.push('vendor');
    if (!s(item?.tech_pack_id)) missing.push('tech_pack');
    if (missing.length) return { ok: false, missing };
    return { ok: true, missing, row: { vendor_id: item.vendor_id, title: s(item.name) || '무제', stage: '진행중',
        due_date: item.ship_date || null, tech_pack_id: item.tech_pack_id, item_id: item.id } };
}
//  확인 후 생성 — 이미 그 제품의 작업이 있거나 저장 중이면 만들지 않는다(중복 생성 방지).
//  store = { jobsOf(itemId): Promise<jobs[]>, insertJob(row): Promise<{error}> }  (테스트는 합성 store)
const inflight = new Set();
export async function createVendorJobOnce(store, item, { confirmed = false } = {}) {
    if (!confirmed) return { created: false, reason: 'need_confirm' };
    const pre = prefillVendorJob(item);
    if (!pre.ok) return { created: false, reason: 'missing', missing: pre.missing };
    const key = String(item.id);
    if (inflight.has(key)) return { created: false, reason: 'in_flight' };
    inflight.add(key);
    try {
        const existing = await store.jobsOf(item.id);
        if ((existing || []).length) return { created: false, reason: 'exists', jobs: existing };
        const { error } = await store.insertJob(pre.row);
        if (error) return { created: false, reason: 'error', error: s(error.message || error) };
        return { created: true, row: pre.row };
    } finally { inflight.delete(key); }
}

// ── (3) 실제/테스트 1회 판정 ───────────────────────────────
//  저장 모양(제안, 미적용): data_verdicts(org_id, target_table, target_id, verdict 'real'|'test', decided_by, decided_at, note)
//   unique(org_id, target_table, target_id). 판정은 사람 1회. 바꾸려면 change:true 로 명시.
//  이름은 '후보'를 고르는 데만 쓴다 — 집계 제외는 verdict === 'test' 만.
const TEST_WORD = /테스트|test|smoke|스모크|샘플데이터|dummy|더미/i;
export const verdictKey = (table, id) => `${table}:${id}`;
export function testCandidates(rows, table, verdicts) {
    const done = new Set((verdicts || []).map(v => verdictKey(v.target_table, v.target_id)));
    return (rows || []).filter(r => r && TEST_WORD.test(s(r.name ?? r.style_name ?? r.title)) && !done.has(verdictKey(table, r.id)))
        .map(r => ({ table, id: r.id, name: s(r.name ?? r.style_name ?? r.title) }));
}
export function decideVerdict(verdicts, { table, id, verdict, by, at = new Date().toISOString(), note = '', change = false }) {
    if (!['real', 'test'].includes(verdict)) throw new Error('verdict 는 real|test');
    if (!s(by)) throw new Error('판정한 사람이 필요합니다');
    const list = (verdicts || []).slice(), k = verdictKey(table, id);
    const i = list.findIndex(v => verdictKey(v.target_table, v.target_id) === k);
    const row = { target_table: table, target_id: id, verdict, decided_by: by, decided_at: at, note };
    if (i >= 0) {
        if (list[i].verdict === verdict) return { verdicts: list, changed: false };
        if (!change) throw new Error('이미 판정됨 — 바꾸려면 change:true');
        list[i] = row;
    } else list.push(row);
    return { verdicts: list, changed: true };
}
export function isTestByVerdict(verdicts, table, id) {
    return (verdicts || []).some(v => v.verdict === 'test' && verdictKey(v.target_table, v.target_id) === verdictKey(table, id));
}
export const excludeTests = (rows, verdicts, table) => (rows || []).filter(r => !isTestByVerdict(verdicts, table, r.id));

// ── (4) 같은 이름·날짜 작업지시서 중복 후보 (삭제 없음) ───────────
const kstDay = v => { const t = ts(v); return t ? new Date(t + 9 * 36e5).toISOString().slice(0, 10) : ''; };
const normName = v => s(v).toLowerCase().replace(/\s+/g, ' ');
const stable = v => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, k) => (o[k] = x[k], o), {}) : x));
//  refs: product_items.tech_pack_id + vendor_jobs.tech_pack_id 로 센다. 기준(anchor) = 참조 많은 것 → 먼저 만든 것.
//  참조 0 이고 config 가 기준과 같으면 'merge_candidate', 아니면 'review'. 결과는 비교 화면용일 뿐 지우지 않는다.
export function duplicateTechPacks(packs, { items = [], jobs = [] } = {}) {
    const refs = id => ({ product: items.filter(i => String(i?.tech_pack_id) === String(id)).length,
        job: jobs.filter(j => String(j?.tech_pack_id) === String(id)).length });
    const groups = new Map();
    for (const p of packs || []) {
        if (!p || !normName(p.style_name) || !kstDay(p.created_at)) continue;
        const k = `${s(p.org_id)}|${normName(p.style_name)}|${kstDay(p.created_at)}`;
        (groups.get(k) || groups.set(k, []).get(k)).push(p);
    }
    const out = [];
    for (const list of groups.values()) {
        if (list.length < 2) continue;
        const rows = list.map(p => ({ p, r: refs(p.id) })).sort((a, b) => (b.r.product + b.r.job) - (a.r.product + a.r.job) || ts(a.p.created_at) - ts(b.p.created_at));
        const anchor = rows[0], cfg = stable(anchor.p.config ?? null);
        const span = Math.max(...list.map(p => ts(p.created_at))) - Math.min(...list.map(p => ts(p.created_at)));
        out.push({ name: s(anchor.p.style_name), day: kstDay(anchor.p.created_at), spanMs: span, anchorId: anchor.p.id,
            members: rows.map(({ p, r }) => ({ id: p.id, created_at: p.created_at, refs: r, sameConfig: stable(p.config ?? null) === cfg,
                role: p === anchor.p ? 'anchor' : (r.product + r.job === 0 && stable(p.config ?? null) === cfg ? 'merge_candidate' : 'review') })) });
    }
    return out;
}

// ── (5) 정산 #unknown 과 내부재고 미연결 — 다른 축, 섞지 않는다 ─────
//  unknown: rpc product_sales 행(brand_id, platform, gkey, ym, amt, qty) 중 gkey '#unknown') 금액. 키디키디는 원본이 주문당 상품 한 줄만 남겨 결제액 나머지가 남는 것 → 'source_single_line'.
//  inventory: channel_order_items.inventory_item_id 없음(배송비 줄 제외) → 'inventory_unmapped'. 금액이 아니라 줄·주문 수.
const SHIP_LINE = /배송비|택배비|shipping/i;
export function unknownCause(row) { return s(row?.platform ?? row?.channel) === 'kidikidi' ? 'source_single_line' : 'unclassified'; }
export function settlementUnknown(rows) {
    const by = {};
    let amount = 0;
    for (const r of rows || []) {
        if (r?.gkey !== '#unknown') continue;
        const a = Number(r.amt ?? r.amount ?? 0) || 0, c = unknownCause(r), k = `${c}|${s(r.platform ?? r.channel)}|${s(r.ym)}`;
        amount += a;
        (by[k] ||= { cause: c, channel: s(r.platform ?? r.channel), ym: s(r.ym), amount: 0 }).amount += a;
    }
    return { kind: 'settlement_unknown', amount, parts: Object.values(by).sort((a, b) => a.ym.localeCompare(b.ym)) };
}
export function inventoryUnmapped(lines) {
    const miss = (lines || []).filter(l => l && !s(l.inventory_item_id) && !SHIP_LINE.test(s(l.product_name)));
    return { kind: 'inventory_unmapped', cause: 'inventory_unmapped', lines: miss.length, orders: new Set(miss.map(l => l.channel_order_id)).size };
}
//  화면은 두 결과를 따로 보인다. 같은 경고·같은 합계로 합치지 않는다.
export const linkHealth = ({ salesRows, orderLines }) => ({ unknown: settlementUnknown(salesRows), inventory: inventoryUnmapped(orderLines) });
