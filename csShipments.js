// CS 원송장(처음 출고된 송장) + 합배송 — cs_order_shipments RPC(097) 결과를 송장별로 묶는다.
//  한 행 = 주문 상품 하나(카페24 raw.items · 29cm raw.items/칸). 키디키디는 주문당 빈 행 하나(channel 만).

const COURIER_SHORT = [[/우체국/, '우체국'], [/CJ|대한통운/i, 'CJ'], [/한진/, '한진'], [/롯데/, '롯데'], [/로젠/, '로젠'], [/경동/, '경동']];
export const courierShort = c => {
    const s = String(c || '').trim();
    for (const [re, v] of COURIER_SHORT) if (re.test(s)) return v;
    return s.replace(/택배$/, '');
};

//  조회 링크는 우체국·CJ 만(지시서). 그 외 택배사는 복사만.
export const trackUrl = (courier, no) => {
    const n = String(no || '').replace(/[^0-9A-Za-z]/g, '');
    if (!n) return '';
    const c = courierShort(courier);
    if (c === '우체국') return `https://service.epost.go.kr/trace.RetrieveDomRigiTraceList.comm?sid1=${n}`;
    if (c === 'CJ') return `https://trace.cjlogistics.com/next/tracking.html?wblNo=${n}`;
    return '';
};

//  옵션 "배송=프리오더 (마감 후 배송3-4주), color=크림, size=XL" → "크림 · XL" (배송 방식은 빼고 값만)
export const optionText = o => String(o || '').split(/,\s*/)
    .map(p => p.trim()).filter(p => p && !/^배송\s*=/.test(p))
    .map(p => p.replace(/^[^=]*=\s*/, '').replace(/^\[[^\]]*\]\s*/, '')).filter(Boolean).join(' · ');

//  rows(한 주문 것) → { none, shipments:[{tracking_no, courier, shipped_date, items}], unshipped:[items] }
//   none = 송장 정보 자체가 없음(키디키디 · 상품 행 없음)
export function groupShipments(rows) {
    const rs = (rows || []).filter(Boolean);
    const item = r => ({ product_name: r.product_name || '', option_name: r.option_name || '', quantity: r.quantity ?? 1 });
    const by = new Map(), unshipped = [];
    for (const r of rs) {
        if (r.tracking_no) {
            const k = String(r.tracking_no);
            if (!by.has(k)) by.set(k, { tracking_no: k, courier: r.courier || '', shipped_date: r.shipped_date || '', items: [] });
            const g = by.get(k);
            if (!g.courier && r.courier) g.courier = r.courier;
            if (r.shipped_date && (!g.shipped_date || r.shipped_date < g.shipped_date)) g.shipped_date = r.shipped_date;
            if (r.product_name) g.items.push(item(r));
        } else if (r.product_name) unshipped.push(item(r));
    }
    //  처음 출고된 송장이 먼저(원송장)
    const shipments = [...by.values()].sort((a, b) => String(a.shipped_date || '9').localeCompare(String(b.shipped_date || '9')));
    return { none: !shipments.length && !unshipped.length, shipments, unshipped };
}

//  목록 한 줄: "우체국 6890175291569" · 2개 이상이면 " 외 1" · 미출고 · 정보 없으면 ''
export function shipSummary(g) {
    if (!g || g.none) return { kind: 'none', text: '' };
    if (!g.shipments.length) return { kind: 'unshipped', text: '미출고' };
    const s = g.shipments[0];
    const more = g.shipments.length - 1;
    return { kind: 'ship', text: `${courierShort(s.courier)} ${s.tracking_no}`.trim() + (more ? ` 외 ${more}` : '') };
}
