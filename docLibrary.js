//  ㉒ 자료실 — 원본 분류 상속 · 원본/사본 · 최신본/이전 버전 · 미리보기·내려받기·공유·접근 (순수 함수)
//  자료실은 따로 파일을 쌓는 곳이 아니라 흩어진 원본(작업지시서·견적·회의록·시즌 자료·브랜드 문서)을 모아 보여주는 창이다.
//  그래서 브랜드·시즌은 자료실이 정하지 않고 원본에서 받아 온다.

//  이름 비교용 — 공백·대소문자·흔한 꼬리표(v2, _최종, (1), 사본)를 걷어낸 '같은 문서' 열쇠
export function docSeriesKey(name) {
    let s = String(name || '').normalize('NFC').toLowerCase().replace(/\.[a-z0-9]{1,5}$/i, '');
    s = s.replace(/[\s_\-]*(\(\d+\)|사본|복사본|copy|최종|final|수정본?|v\s*\d+|ver\s*\d+|\d+차)$/gi, '');
    s = s.replace(/[\s_\-]*(\(\d+\)|사본|복사본|copy|최종|final|수정본?|v\s*\d+|ver\s*\d+|\d+차)$/gi, '');
    return s.replace(/[\s_\-]+/g, ' ').trim();
}

//  브랜드 상속 — 원본이 가진 브랜드가 먼저, 없으면 원본이 속한 시즌의 브랜드
export function docBrandId(d, products) {
    if (!d) return null;
    if (d.brandId) return String(d.brandId);
    const p = d.productId ? (products || []).find(x => String(x.id) === String(d.productId)) : null;
    return p && p.brand_id ? String(p.brand_id) : null;
}

//  올린 파일(사본 후보)이 이미 있는 원본(작업지시서·견적)과 같은 문서인지 — 같은 시즌(없으면 같은 브랜드) + 같은 열쇠
export function docCopyOf(d, originals, products) {
    if (!d || d.origin !== 'file') return null;
    const k = docSeriesKey(d.name); if (!k) return null;
    const b = docBrandId(d, products);
    return (originals || []).find(o => o.origin !== 'file' && docSeriesKey(o.name) === k
        && (d.productId ? String(o.productId || '') === String(d.productId) : (b && docBrandId(o, products) === b))) || null;
}

//  올린 파일끼리 버전 — 같은 위치(시즌·없으면 브랜드)·같은 열쇠 묶음에서 가장 최근 것이 최신, 나머지는 이전 버전
export function fileVersionMap(files, products) {
    const groups = {};
    (files || []).forEach(d => {
        const k = docSeriesKey(d.name); if (!k) return;
        const g = (d.productId ? 'p' + d.productId : 'b' + (docBrandId(d, products) || '-')) + '|' + k;
        (groups[g] = groups[g] || []).push(d);
    });
    const out = {};
    Object.values(groups).forEach(list => {
        if (list.length < 2) return;
        const sorted = [...list].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.id).localeCompare(String(a.id)));
        sorted.forEach((d, i) => { out[String(d.id)] = { latest: i === 0, n: list.length, newest: sorted[0] }; });
    });
    return out;
}

//  미리보기 · 내려받기 · 공유 — 무엇이 되고 안 되는지, 왜 그런지
export function docActions(d, { isImg, isPdf, isPrivate } = {}) {
    const id = String(d?.id || '');
    const url = d?.url || '';
    if (id.startsWith('tp:')) return {
        preview: d.uploadKind === 'pdf' || d.uploadKind === 'image' ? '가능(원본 파일)' : d.uploadKind ? '불가 — 내려받아 열기' : '가능(도식)',
        download: d.uploadKind ? '작업지시서 화면에서(비공개 파일)' : '작업지시서 화면에서 PDF 저장',
        share: '작업지시서 화면에서 — 공장 전달은 확정본만',
    };
    if (id.startsWith('q:')) return { preview: '가능(견적서 화면)', download: '견적서 화면에서 PDF 저장', share: '견적서 화면에서' };
    if (id.startsWith('mt:')) return { preview: '가능(메모 화면)', download: '없음(메모)', share: '메모 공유 범위를 따름' };
    if (!url) return { preview: '불가 — 파일 주소 없음', download: '불가', share: '불가' };
    const priv = isPrivate ? isPrivate(url) : false;
    return {
        preview: (isImg && isImg(url)) || (isPdf && isPdf(url)) ? '가능' : '불가 — 내려받아 열기',
        download: priv ? '가능(1시간짜리 링크)' : '가능',
        share: priv ? '링크 복사 — 1시간 뒤 만료' : '링크 복사 — 주소를 아는 사람은 열람 가능',
    };
}

//  ㉒ 반려1 — 누가 볼 수 있나는 '화면에 보이는 범위'가 아니라 서버(RLS)가 실제로 허용하는 범위로 말한다.
//  운영 RLS(2026-11-20 실측): global_documents·tech_packs·quotes = 같은 회사 직원(MASTER·STAFF) 누구나, 브랜드로 막지 않음.
//  CLIENT 는 세 표 모두 RESTRICTIVE partner_guard_select(is_staff()) 에 막힌다 — gdocs_select 가 auth.uid() 만 봐도 AND 로 걸려 0건.
//  (롤백 실측: 같은 계정을 STAFF→CLIENT 로 바꾸면 tech_packs 14→0 · quotes 2→0)
//  시즌 사진·시즌 문서 = products 권한(브랜드 담당 + 전사 공용, 브랜드 없는 시즌은 직원 누구나). 메모 = 메모 공유 범위.
//  화면은 담당 브랜드만 보여주지만(보조 필터) 그건 권한이 아니므로 따로 적는다.
export function docAccess(d, users, groups, brandName) {
    const staff = (users || []).filter(u => u && u.username && u.active !== false && u.role !== 'CLIENT');
    const src = d?.src || (String(d?.id || '').startsWith('tp:') ? 'techpack' : String(d?.id || '').startsWith('q:') ? 'quote' : String(d?.id || '').startsWith('mt:') ? 'note' : 'season');
    const screen = d?.brandKey ? `화면: ${brandName || '이 브랜드'} 담당·전사 공용 계정에만 목록 표시` : '화면: 직원 모두에게 목록 표시';
    if (src === 'note') return { server: '메모 공유 범위를 따름(서버가 메모별로 막음)', screen };
    if (src === 'gdoc' || src === 'techpack' || src === 'quote')
        return { server: `같은 회사 직원(관리자·직원) 누구나 ${staff.length}명 — 브랜드로는 안 막음 · 거래처 계정은 서버가 막음`, screen, open: true };
    if (!d?.brandKey) return { server: `브랜드 없는 시즌 — 직원 누구나 ${staff.length}명`, screen };
    const common = (groups?.common || []).length, ded = ((groups?.byBrand || {})[String(d.brandKey)] || []).length;
    return { server: `${brandName || '이 브랜드'} 담당 ${ded}명 + 전사 공용 ${common}명(시즌 권한으로 서버가 막음)`, screen };
}
