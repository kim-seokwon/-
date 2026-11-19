//  M(A4) — 활성 조직. 앱이 D 표(앱이 쓰는데 org 를 정해 줄 부모가 없거나 비어도 되는 표)에 넣을 때
//  org_id 를 명시해 넘긴다. 안 넘기면 DB 기본값(2179)으로 들어가서, 두 조직 사람이 머문 일을 해도 2179 에 쌓였다.
//  · 활성 조직은 '화면 선택'일 뿐 권한 근거가 아니다 — 권한은 RLS(소속 org 전부 허용)가 정한다(설계안 4).
//  · 지금 사용자는 모두 2179(한 명만 2179+머문) → 기본값과 같은 2179 를 넣으니 데이터·화면 변화 없음.
//  · 조직 고르기는 깃발(localStorage orca_org_switch=1) 뒤. 깃발이 꺼져 있으면 2179 소속이면 늘 2179.
//  · 부모가 있는 표는 DB 트리거(zz_113_org)가 부모 org 로 덮어쓴다 → 넘긴 값은 부모가 비었을 때만 쓰인다.

export const ORG_2179 = '00000000-0000-4000-8000-000000002179';
export const ORG_KEY = 'orca_active_org';
export const ORG_FLAG = 'orca_org_switch';

//  D 46표 중 authenticated 가 org_id 열 INSERT 권한이 있는 41표(운영 카탈로그 11-19 읽기 전용 확인).
//  빠진 5표: coupon_audit·operation_audit(서비스·definer 가 씀) · ui_events·ui_events_config·ui_usage_summary(열 권한 없음 — 넣으면 42501)
export const ORG_WRITE_TABLES = new Set([
    'ad_status', 'apify_runs', 'board_cards', 'brand_settings', 'brands', 'calendar_routines', 'channel_orders', 'clients',
    'competitors', 'cs_tickets', 'cs_tickets_trash', 'documents', 'expenses', 'feedback', 'feedback_reports', 'global_documents',
    'history', 'inventory_items', 'malls', 'material_items', 'memos', 'news_items', 'news_sources', 'note_folders', 'notes',
    'notices', 'pages', 'photos', 'product_items', 'product_stages', 'products', 'quotes', 'reminders', 'season_steps',
    'shipment_jobs', 'sync_log', 'tech_packs', 'todos', 'vendor_categories', 'vendor_jobs', 'vendors',
]);
//  그중 부모 트리거가 없는 14표 — upsert 가 기존 행과 부딪히면 그 행의 org 를 활성 조직으로 '옮긴다'.
//  (예: note_folders 는 name 이 전역 유일 → 머문에서 같은 이름 폴더를 저장하면 2179 폴더가 머문으로 넘어감)
//  그래서 2179 가 아닌 조직이 활성일 때 이 표 upsert 는 막는다(DB 유일키를 (org_id, …)로 바꾸는 후속 전까지).
export const ORG_NO_PARENT = new Set([
    'apify_runs', 'brands', 'calendar_routines', 'clients', 'competitors', 'cs_tickets_trash', 'expenses', 'feedback',
    'feedback_reports', 'note_folders', 'notices', 'sync_log', 'vendor_categories', 'vendors',
]);
//  앱이 부르는 엣지 함수 중 본문의 org_id 를 쓰는 것(소속 확인 뒤). 나머지 함수 본문은 건드리지 않는다.
export const ORG_FUNCTIONS = new Set(['courier-issue']);
//  앱이 부르는 RPC 중 D 표에 '부모 없이' 넣을 수 있는 것 → 넘길 인자 이름(코덱스 반려 11-19, 운영 카탈로그로 33개 전수 확인).
//  · create_material_item: brand 비우면 material_items 가 기본값 2179 로 샌다 → p_org_id(DB 가 소속 확인, brand 있으면 부모 org 우선).
//  · cs_trash 는 앱 인자 없이 DB 트리거(zz_m_trash_org)가 원본 CS 의 org 를 휴지통 행에 복사한다.
//  · 나머지(create_product·coupon_rule_save·set_ad_report_rule·cs_restore)는 brand 필수 또는 원본 org 그대로라 해당 없음.
//  2179 가 활성일 땐 넣지 않는다(기본값과 같음) → 옛 DB 함수(인자 없음)여도 2179 사용자는 그대로 동작.
export const ORG_RPCS = new Map([['create_material_item', 'p_org_id']]);

//  소속 org 목록 + 저장된 선택 + 깃발 → 활성 조직. 모르면 null(= 안 넣음 = 지금과 같음).
export function pickActiveOrg({ orgIds, stored, flag } = {}) {
    const ids = [...new Set((orgIds || []).filter(Boolean))].sort();
    if (!ids.length) return null;
    if (flag && stored && ids.includes(stored)) return stored;
    if (ids.includes(ORG_2179)) return ORG_2179;
    return ids[0];
}

//  행(또는 행 배열)에 org_id 를 넣는다. 이미 org_id 가 있으면 그대로(호출부가 정한 값이 우선).
export function withOrg(values, org) {
    if (!org) return values;
    const one = r => (r && typeof r === 'object' && !Array.isArray(r) && !Object.prototype.hasOwnProperty.call(r, 'org_id')) ? { ...r, org_id: org } : r;
    return Array.isArray(values) ? values.map(one) : one(values);
}

const blocked = table => Promise.resolve({
    data: null, status: 409, statusText: 'ORG_UPSERT_BLOCKED',
    error: { code: 'ORG_UPSERT_BLOCKED', message: `${table}: 다른 조직이 선택된 동안엔 이 저장(덮어쓰기)이 막혀 있습니다 — 2179 로 바꾼 뒤 저장하세요.` },
});

//  supabase 클라이언트를 감싼다. from(D표).insert/upsert · functions.invoke(ORG_FUNCTIONS) · rpc(ORG_RPCS) 만 바뀌고 나머지는 그대로.
export function orgScopedClient(client, getOrg) {
    if (!client) return client;
    const wrapBuilder = (qb, table) => new Proxy(qb, {
        get(q, p) {
            if (p === 'insert') return (values, opts) => q.insert(withOrg(values, getOrg()), opts);
            if (p === 'upsert') return (values, opts) => {
                const org = getOrg();
                if (org && org !== ORG_2179 && ORG_NO_PARENT.has(table)) return blocked(table);
                return q.upsert(withOrg(values, org), opts);
            };
            const v = Reflect.get(q, p, q);
            return typeof v === 'function' ? v.bind(q) : v;
        },
    });
    const fnWrap = fns => new Proxy(fns, {
        get(f, p) {
            if (p === 'invoke') return (name, opts = {}) => {
                const org = getOrg();
                if (org && ORG_FUNCTIONS.has(name) && opts.body && typeof opts.body === 'object' && !Array.isArray(opts.body) && !('org_id' in opts.body))
                    opts = { ...opts, body: { ...opts.body, org_id: org } };
                return f.invoke(name, opts);
            };
            const v = Reflect.get(f, p, f);
            return typeof v === 'function' ? v.bind(f) : v;
        },
    });
    return new Proxy(client, {
        get(c, p) {
            if (p === 'from') return table => {
                const qb = c.from(table);
                return ORG_WRITE_TABLES.has(table) ? wrapBuilder(qb, table) : qb;
            };
            if (p === 'functions') return fnWrap(c.functions);
            if (p === 'rpc') return (name, args, opts) => {
                const org = getOrg(), key = ORG_RPCS.get(name);
                if (key && org && org !== ORG_2179 && args && typeof args === 'object' && !Array.isArray(args) && !(key in args))
                    args = { ...args, [key]: org };
                return c.rpc(name, args, opts);
            };
            if (p === '__orgRaw') return c;
            const v = Reflect.get(c, p, c);
            return typeof v === 'function' ? v.bind(c) : v;
        },
    });
}
