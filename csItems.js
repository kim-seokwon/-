// CS 부분 반품·교환(10-27) — 주문에서 '신청한 상품'만 끌어오기 · 목록 "6개 중 3개" · 지우기 판정.
//  줄 모양은 098 cs_order_pick 과 같다: { code, name, option, qty, status, claim, reason }

//  같은 이름은 묶어 "이름 ×수량" · 주문 순서 · ', ' (098 cs_items_summary 와 같은 꼴)
export function itemsSummary(items) {
    const by = new Map();
    for (const it of items || []) {
        const nm = String(it?.name || '').trim(); if (!nm) continue;
        by.set(nm, (by.get(nm) || 0) + (Number(it.qty) || 1));
    }
    return [...by].map(([nm, q]) => q > 1 ? `${nm} ×${q}` : nm).join(', ') || null;
}

//  주문 줄 중 일부만이면 "6개 중 3개"(줄 기준), 전부거나 모르면 ''
export function partLabel(items, total) {
    const n = Array.isArray(items) ? items.length : 0, all = Number(total) || 0;
    return n && all > n ? `${all}개 중 ${n}개` : '';
}

//  끌어올 때 무엇을 쓸지:
//   claim  = 카페24 클레임 줄이 있다 → 그 줄만(자동)
//   one    = 주문 줄이 1개 → 그 줄(자동)
//   choose = 여러 줄 · 클레임 없음 → 직원이 고른다
//   none   = 줄 정보 없음 → 예전처럼(트리거가 나중에)
export function pickPlan(pick) {
    const claim = Array.isArray(pick?.claim) ? pick.claim : [], lines = Array.isArray(pick?.lines) ? pick.lines : [];
    if (claim.length) return { mode: 'claim', items: claim, kind: pick.kind || null, total: lines.length };
    if (lines.length === 1) return { mode: 'one', items: lines, kind: null, total: 1 };
    if (lines.length > 1) return { mode: 'choose', items: [], kind: null, total: lines.length };
    return { mode: 'none', items: [], kind: null, total: 0 };
}

//  직원이 고른 줄 → 저장할 칸. 자동이면 auto_fill 에 남겨 나중에 클레임이 오면 트리거가 바로잡게 한다(직원이 고른 건 안 남김).
export function itemsPatch(items, total, auto) {
    const it = (items || []).map(x => ({
        code: x.code ?? null, name: x.name ?? '', option: x.option ?? null, qty: Number(x.qty) || 1,
        status: x.status ?? null, claim: x.claim ?? null, reason: x.reason ?? null,
    }));
    const product_name = itemsSummary(it);
    return { items: it.length ? it : null, items_total: Number(total) || null, product_name,
        auto: auto && it.length ? { items: it, product_name } : null };
}

//  줄 구분값(체크 목록) — 카페24 품목코드, 없으면 순번
export const lineKey = (l, i) => l?.code ? `c:${l.code}` : `i:${i}`;

//  지울 수 있나(화면 판정 — 서버 cs_trash 가 다시 확인): 완료 아님 · 작성자 본인 또는 관리자
export function canTrash(t, user) {
    if (!t || !user || t.status === '완료') return false;
    return user.role === 'MASTER' || (!!user.name && t.created_by === user.name);
}

export const CLAIM_LABEL = s => /^R/.test(s || '') ? '반품 신청' : /^E/.test(s || '') ? '교환 신청' : /^C/.test(s || '') ? '취소 신청' : '';
