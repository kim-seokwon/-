//  캘린더 브랜드 판정 — 날짜 붙은 한 건이 어느 브랜드 것인지. 모르면 null(= 공통).
//  화면(main.js _allDated)과 테스트가 같은 함수를 쓴다. DB 를 부르지 않는다.
//
//  고리: 시즌(products.brand_id) ← 제품(product_items.brand_id, 없으면 시즌) ← 작업지시서(brand_id, 없으면 제품)
//        메모 = brand_id → 제품(item_id) → 시즌(product_id·메타 proj) / 할 일 = item_id → product_id → source_kind·source_id
//        생산 작업 = item_id → 작업지시서 / 고정 루틴·거래처 메모 = 공통
export const CAL_BRAND_ALL = 'ALL';
export const CAL_BRAND_NONE = 'NONE';

const key = v => (v === null || v === undefined || v === '') ? null : String(v);

export function makeBrandResolver({ seasons = [], items = [], techPacks = [], notes = [], noteSeason = () => null } = {}) {
    const byId = list => new Map(list.filter(x => x && key(x.id)).map(x => [key(x.id), x]));
    const S = byId(seasons), I = byId(items), T = byId(techPacks), N = byId(notes);
    const season = id => key(S.get(key(id))?.brand_id);
    const item = id => {
        const it = I.get(key(id)); if (!it) return null;
        return key(it.brand_id) || season(it.product_id);
    };
    const itemOfPack = new Map();
    items.forEach(it => { if (key(it?.tech_pack_id)) itemOfPack.set(key(it.tech_pack_id), it); });
    const techPack = id => {
        const t = T.get(key(id));
        if (t) return key(t.brand_id) || item(t.item_id) || item(itemOfPack.get(key(t.id))?.id);
        return item(itemOfPack.get(key(id))?.id);
    };
    const note = n => {
        if (!n || typeof n !== 'object') return null;
        const full = N.get(key(n.id)) || n;
        return key(full.brand_id) || item(full.item_id) || season(full.product_id || noteSeason(full));
    };
    const noteId = id => { const n = N.get(key(id)); return n ? note(n) : null; };
    const reminder = r => {
        if (!r) return null;
        const direct = key(r.brand_id) || item(r.item_id) || season(r.product_id);
        if (direct) return direct;
        const sid = r.source_id;
        if (r.source_kind === 'season') return season(sid);
        if (r.source_kind === 'item') return item(sid);
        if (r.source_kind === 'note') return noteId(sid);
        return null;
    };
    const job = j => j ? (item(j.item_id) || techPack(j.tech_pack_id)) : null;
    //  _lineTodos 한 건 — src: item(제품 기록) · note(메모) · vendor(거래처 메모=공통)
    const lineTodo = t => {
        if (!t || t.src === 'vendor') return null;
        if (t.src === 'item') return item(t.srcId) || noteId(t.noteId) || season(t.seasonId);
        return noteId(t.noteId) || season(t.seasonId);
    };
    return { season, item, techPack, note, noteId, reminder, job, lineTodo };
}

//  고른 칩으로 거른다 — ALL 은 다, NONE 은 브랜드 없는 것만, 그 밖엔 그 브랜드만
export function calBrandMatch(x, sel) {
    if (!sel || sel === CAL_BRAND_ALL) return true;
    const b = key(x?.brand_id);
    if (sel === CAL_BRAND_NONE) return !b;
    return b === String(sel);
}

//  저장돼 있던 선택이 지금 없는 브랜드면 전체로 돌린다
export function calBrandValid(sel, brands = []) {
    if (sel === CAL_BRAND_ALL || sel === CAL_BRAND_NONE) return sel;
    return (brands || []).some(b => String(b.id) === String(sel)) ? String(sel) : CAL_BRAND_ALL;
}
