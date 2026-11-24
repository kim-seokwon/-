//  27 메뉴 권한 — 사이드 메뉴 · 사용자·권한 체크 · 메뉴 권한 화면이 같은 이름을 쓰게 하는 한 곳 (순수 함수)
//  이름은 지금 사이드 메뉴(MAC_SIDE_GROUPS)에 보이는 이름을 기준으로 한다. 사이드에 없는 옛 화면만 옛 이름을 둔다.
//  id 는 서버 128 can_menu · auth.ts 와 같은 값이라 바꾸지 않는다(이름만 통일).

export const MENU_GROUPS = [
    { g: '판매', items: [['orders', '주문·배송'], ['cs', '교환·반품·CS'], ['analysis', '고객 분석']] },
    { g: '상품·생산', items: [['dashboard', '시즌'], ['timeline', '타임라인'], ['sample_maker', '작업지시서 작성'],
        ['tech_packs', '작업지시서'], ['vendors', '생산 관리'], ['inventory', '재고 관리']] },
    { g: '재무', items: [['sales', '매출 분석'], ['expenses', '지출 관리'], ['quotes', '견적서']] },
    { g: '마케팅', items: [['sns', '마케팅']] },
    { g: '업무·자료', items: [['calendar', '통합 캘린더'], ['notes', '메모'], ['documents', '자료실'], ['contacts', '거래처'],
        ['pages', '페이지'], ['kanban', '보드'], ['table', '표']] },
    { g: '연동', items: [['integrations', '외부 서비스 연동']] },
];
//  끌 수 없는 메뉴 — 128 can_menu · auth.ts MENU_ALWAYS 와 같다
export const MENU_ALWAYS = ['all_todos', 'reminders', 'settings', 'items'];
export const ALWAYS_SHOWN = [['items', '상품 관리'], ['reminders', '할 일'], ['settings', '설정']];

const NAME = Object.fromEntries([...MENU_GROUPS.flatMap(s => s.items), ...ALWAYS_SHOWN,
    ['user_management', '사용자·권한'], ['brand_management', '브랜드'], ['feedback', '불편접수']]);
export const menuName = (id, fallback) => NAME[id] || fallback || id;
export const assignableIds = () => MENU_GROUPS.flatMap(s => s.items.map(i => i[0]));

//  저장할 menu_access — 고를 수 있는 id 만, 순서는 목록 순서로(같은 선택이면 같은 배열)
export function normalizeMenuAccess(ids) {
    const want = new Set(ids || []);
    return assignableIds().filter(id => want.has(id));
}

//  계정 하나의 메뉴 상태 — { mode:'all'|'role'|'custom', on:Set, off:[id] }
//  대표(MASTER)는 전부. menu_access 가 null(정한 적 없음)이면 역할 기본값(직원 = 전부).
//  빈 배열 [] 은 '전부 끔'이다 — 사이드(_menuItems)·서버(128 can_menu)와 같은 해석(코덱스 반려 11-20).
export function menuAccessOf(user) {
    const all = assignableIds();
    if (!user || user.role === 'MASTER') return { mode: 'all', on: new Set(all), off: [] };
    const ma = Array.isArray(user.menu_access) ? user.menu_access : null;
    if (!ma) return user.role === 'STAFF'
        ? { mode: 'role', on: new Set(all), off: [] }
        : { mode: 'role', on: new Set(['dashboard']), off: all.filter(x => x !== 'dashboard') };
    const on = new Set(ma.filter(x => all.includes(x)));
    return { mode: 'custom', on, off: all.filter(x => !on.has(x)) };
}
