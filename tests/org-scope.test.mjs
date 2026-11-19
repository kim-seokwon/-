//  M(A4) 활성 조직 — 감싸기(org-scope.js) 단위 시험 + main.js 배선 정적 검사.
//  실제 DB 에 넣어 보는 시험은 .work/재설계/M_활성org/M.test.mjs(로컬 PG).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { orgScopedClient, pickActiveOrg, withOrg, ORG_WRITE_TABLES, ORG_NO_PARENT, ORG_RPCS, ORG_2179 } from '../org-scope.js';

const MU = '00000000-0000-4000-8000-00000000a001';
const MAIN = readFileSync(new URL('../main.js', import.meta.url), 'utf8');

//  supabase-js 흉내 — 호출을 기록하고 체이닝(.select().single())도 된다
const fake = () => {
    const calls = [];
    const chain = rec => { const q = { select: () => q, single: () => q, eq: () => q, then: r => r({ data: rec, error: null }) }; return q; };
    return {
        calls,
        from: t => ({ insert: (v, o) => { calls.push({ t, op: 'insert', v, o }); return chain(v); },
                      upsert: (v, o) => { calls.push({ t, op: 'upsert', v, o }); return chain(v); },
                      update: v => { calls.push({ t, op: 'update', v }); return chain(v); },
                      select: () => chain([]) }),
        rpc: (f, a) => { calls.push({ rpc: f, a }); return Promise.resolve({ data: null, error: null }); },
        functions: { invoke: (name, opts) => { calls.push({ fn: name, opts }); return Promise.resolve({ data: null, error: null }); } },
        auth: { tag: 'auth' }, storage: { tag: 'storage' },
    };
};

test('활성 조직 고르기', () => {
    assert.equal(pickActiveOrg({ orgIds: [] }), null, '소속 모름 → null(안 넣음)');
    assert.equal(pickActiveOrg({ orgIds: [ORG_2179] }), ORG_2179);
    assert.equal(pickActiveOrg({ orgIds: [MU, ORG_2179], stored: MU, flag: false }), ORG_2179, '깃발 꺼짐이면 선택 무시');
    assert.equal(pickActiveOrg({ orgIds: [MU, ORG_2179], stored: MU, flag: true }), MU);
    assert.equal(pickActiveOrg({ orgIds: [ORG_2179], stored: MU, flag: true }), ORG_2179, '소속 아닌 선택 무시');
    assert.equal(pickActiveOrg({ orgIds: [MU] }), MU, '한 조직(2179 아님)이면 그 조직');
});

test('withOrg — 없을 때만 넣고, 배열도, 호출부 값 우선', () => {
    assert.deepEqual(withOrg({ a: 1 }, ORG_2179), { a: 1, org_id: ORG_2179 });
    assert.deepEqual(withOrg([{ a: 1 }, { a: 2, org_id: MU }], ORG_2179), [{ a: 1, org_id: ORG_2179 }, { a: 2, org_id: MU }]);
    assert.deepEqual(withOrg({ a: 1 }, null), { a: 1 }, 'null 이면 그대로');
});

test('2179 사용자 — D 표 insert/upsert 에 org_id=2179(기본값과 같은 값)만 더해진다', async () => {
    const f = fake(); const sb = orgScopedClient(f, () => ORG_2179);
    await sb.from('notes').insert({ title: 'x' }).select().single();
    await sb.from('note_folders').upsert({ name: 'a' }, { onConflict: 'name' });
    await sb.from('brand_settings').upsert({ brand_id: 'b', courier: 'c' }, { onConflict: 'brand_id' });
    await sb.from('notes').update({ title: 'y' }).eq('id', 1);
    await sb.from('ui_events').insert({ screen: 's', action: 'a' });           // 열 권한 없음 → 안 넣음
    await sb.from('companies').insert({ username: 'u' });                    // D 아님 → 안 넣음
    assert.deepEqual(f.calls.map(c => c.v), [
        { title: 'x', org_id: ORG_2179 }, { name: 'a', org_id: ORG_2179 }, { brand_id: 'b', courier: 'c', org_id: ORG_2179 },
        { title: 'y' }, { screen: 's', action: 'a' }, { username: 'u' },
    ]);
    assert.deepEqual(f.calls[1].o, { onConflict: 'name' }, '옵션 그대로');
    assert.equal(sb.auth.tag, 'auth'); assert.equal(sb.storage.tag, 'storage');
});

test('머문 선택 — insert 는 a001, 부모 없는 표 upsert 는 막힘(기존 2179 행을 옮기지 않게)', async () => {
    const f = fake(); const sb = orgScopedClient(f, () => MU);
    await sb.from('brands').insert({ name: 'n' });
    const r = await sb.from('note_folders').upsert({ name: 'a' }, { onConflict: 'name' });
    assert.equal(r.error.code, 'ORG_UPSERT_BLOCKED');
    await sb.from('product_stages').upsert({ product_id: 1, stage_id: 's' });   // 부모 트리거 있는 표 → 통과
    assert.deepEqual(f.calls.map(c => [c.t, c.v.org_id]), [['brands', MU], ['product_stages', MU]]);
});

test('엣지 함수 — courier-issue 본문에만 org_id, 나머지 함수 본문은 그대로', async () => {
    const f = fake(); const sb = orgScopedClient(f, () => MU);
    await sb.functions.invoke('courier-issue', { body: { test: true } });
    await sb.functions.invoke('cafe24-shipping', { body: { mall: 'm' } });
    assert.deepEqual(f.calls.map(c => c.opts.body), [{ test: true, org_id: MU }, { mall: 'm' }]);
});

test('RPC — create_material_item 만 머문 선택 때 p_org_id, 2179·다른 RPC·호출부 값은 그대로', async () => {
    const mu = fake(), sb = orgScopedClient(mu, () => MU);
    await sb.rpc('create_material_item', { p_name: 'a', p_brand_id: null });
    await sb.rpc('create_material_item', { p_name: 'b', p_org_id: ORG_2179 });
    await sb.rpc('cs_trash', { p_id: 'x' });
    await sb.rpc('create_product', { p_brand_id: 'b' });
    const o = fake(); await orgScopedClient(o, () => ORG_2179).rpc('create_material_item', { p_name: 'c' });
    const n = fake(); await orgScopedClient(n, () => null).rpc('create_material_item', { p_name: 'd' });
    assert.deepEqual(mu.calls.map(c => [c.rpc, c.a]), [
        ['create_material_item', { p_name: 'a', p_brand_id: null, p_org_id: MU }], ['create_material_item', { p_name: 'b', p_org_id: ORG_2179 }],
        ['cs_trash', { p_id: 'x' }], ['create_product', { p_brand_id: 'b' }],
    ]);
    assert.deepEqual(o.calls[0].a, { p_name: 'c' }, '2179 는 안 넣음(옛 함수 호환)');
    assert.deepEqual(n.calls[0].a, { p_name: 'd' });
});

test('표 목록 — 부모 없는 표 ⊂ 쓰기 대상, 열 권한 없는 표 제외', () => {
    for (const t of ORG_NO_PARENT) assert.ok(ORG_WRITE_TABLES.has(t), t);
    for (const t of ['ui_events', 'ui_events_config', 'ui_usage_summary', 'coupon_audit', 'operation_audit']) assert.ok(!ORG_WRITE_TABLES.has(t), t);
    assert.equal(ORG_WRITE_TABLES.size, 41);
});

test('main.js 배선 — 진짜 클라이언트를 감싸고, 로그인·세션 확인 때 소속을 읽고, 감싸지 않은 쓰기가 없다', () => {
    assert.match(MAIN, /this\.supabase = orgScopedClient\(supabase, \(\) => this\._activeOrg\);/);
    assert.match(MAIN, /this\.currentUser = authData\.user;\n\s+await this\._loadOrgScope\(authData\.user\.id\);/);
    assert.match(MAIN, /this\._authOk = true;\n\s+await this\._loadOrgScope\(data\.session\.user\?\.id\);/);
    //  전역 supabase 로 D 표에 직접 쓰는 곳이 없어야(감싸기 우회 금지)
    const bypass = [...MAIN.matchAll(/(?<![.\w])supabase\s*\.\s*from\(\s*['"`](\w+)['"`]\s*\)\s*\.\s*(insert|upsert)/g)].filter(m => ORG_WRITE_TABLES.has(m[1]));
    assert.deepEqual(bypass.map(m => m[0]), []);
    //  ORG_RPCS 도 감싼 클라이언트(this.supabase)로만 부른다
    const rpcBypass = [...MAIN.matchAll(/(?<![.\w])supabase\s*\.\s*rpc\(\s*['"`](\w+)['"`]/g)].filter(m => ORG_RPCS.has(m[1]));
    assert.deepEqual(rpcBypass.map(m => m[0]), []);
    assert.ok(/this\.supabase\.rpc\('create_material_item'/.test(MAIN));
    //  호출부가 org_id 를 직접 정하는 곳이 없어야(있으면 활성 조직을 무시하게 됨) — 생기면 계약표에 올리고 이 검사를 고친다
    assert.equal((MAIN.match(/org_id\s*:/g) || []).length, 0);
});
