//  ㉕ 브랜드 — 전사 공용 / 브랜드 전담 / 미배정 사용자 구분, 삭제 영향 정리 (순수 함수)
//  접근 규칙은 main.js _allowedBrandIds 와 같다:
//    brand_access 가 있으면 그 브랜드만 · 없으면 STAFF·CLIENT 는 brand_id 하나(없으면 아무것도 못 봄) · MASTER 는 전체.

export function brandAccessOf(u) {
    if (!u) return [];
    if (Array.isArray(u.brand_access) && u.brand_access.length) return u.brand_access.map(String);
    if (u.role === 'MASTER') return null;              // null = 전체(전사 공용)
    return u.brand_id ? [String(u.brand_id)] : [];
}

//  users → { common: 전사 공용, byBrand: {brandId: [전담]}, unassigned: 아무 브랜드도 못 보는 계정 }
//  퇴사·정지(active === false)와 로그인 없는 행(username 없음)은 뺀다.
export function brandUserGroups(users, brands) {
    const ids = new Set((brands || []).map(b => String(b.id)));
    const out = { common: [], byBrand: {}, unassigned: [] };
    (brands || []).forEach(b => { out.byBrand[String(b.id)] = []; });
    (users || []).filter(u => u && u.username && u.active !== false).forEach(u => {
        const acc = brandAccessOf(u);
        if (acc === null) { out.common.push(u); return; }
        const mine = acc.filter(id => ids.has(id));
        if (!mine.length) { out.unassigned.push(u); return; }
        //  모든 브랜드에 배정돼 있어도 '전담'이다 — 새 브랜드가 생기면 자동으로 보지 않기 때문
        mine.forEach(id => out.byBrand[id].push(u));
    });
    return out;
}

//  삭제 영향 — 서버 brand_delete_impact(133) 가 brands 를 참조하는 FK 표를 전부 세서 { tbl, rule, n } 로 준다.
//  (브라우저 권한으로는 channel_credentials 등을 못 세서 늘 '보류'가 됐다 — ㉕ 반려)
//  rule: block 삭제를 막음 · remove 함께 지워짐 · unlink 자료는 남고 브랜드 연결만 끊김
export const BRAND_TABLE_LABELS = {
    cs_tickets: 'CS 접수', coupon_rules: '쿠폰 규칙',
    products: '시즌(사진·문서·메모·할 일 포함)', companies: '이 브랜드 소속 계정',
    global_documents: '브랜드 문서', channel_credentials: '쇼핑몰 연동 키', ig_accounts: '인스타 계정 연결',
    season_steps: '시즌 단계 설정', ad_report_rules: '광고 보고 규칙',
    product_items: '상품', tech_packs: '작업지시서', malls: '쇼핑몰', inventory_items: '재고 품목', notes: '메모',
    ad_links: '광고 연결', ig_media: '인스타 게시물', news_items: '뉴스 기사', news_sources: '뉴스 출처',
    material_items: '원단·부자재', board_cards: '보드 카드', pages: '페이지', expenses: '지출(귀속 브랜드)',
};
export const brandTableLabel = t => BRAND_TABLE_LABELS[String(t).replace(/^public\./, '')] || String(t);

export function brandDeleteImpact(rows) {
    const res = { block: [], remove: [], unlink: [] };
    (rows || []).forEach(r => {
        const n = Number(r.n) || 0;
        if (n > 0 && res[r.rule]) res[r.rule].push({ label: brandTableLabel(r.tbl), n });
    });
    return res;
}
