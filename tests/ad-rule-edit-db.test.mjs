//  116 광고 판정선 수정 RPC — 진짜 Postgres(PGlite)에 105 → 116 을 깔고 권한·검증·기록·되돌리기를 본다. 운영 DB 안 씀.
//  돌리려면: PGLITE_PATH=<@electric-sql/pglite 폴더>/dist/index.js npm test  (없으면 건너뜀)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const rd = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const M105 = rd('../supabase/migrations/105_ad_report.sql'), M116 = rd('../supabase/migrations/116_ad_rule_edit.sql'), DOWN = rd('../supabase/rollbacks/116_ad_rule_edit.down.sql');
const P = process.env.PGLITE_PATH;
const ORG = '00000000-0000-4000-8000-000000002179', ORG2 = '00000000-0000-4000-8000-00000000a001';
const U = { boss: '00000000-0000-0000-0000-00000000b055', owner: '00000000-0000-0000-0000-0000000000f1', member: '00000000-0000-0000-0000-0000000000f2', other: '00000000-0000-0000-0000-0000000000f3', client: '00000000-0000-0000-0000-0000000000f4' };
const HHH = '00000000-0000-0000-0000-0000000000a1', LOHI = '00000000-0000-0000-0000-0000000000a2', NEWB = '00000000-0000-0000-0000-0000000000a4';

//  Supabase·105·113 이 깔아 둔 것만 흉내
const STUB = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub', '')::uuid $$;
grant usage on schema auth, public to anon, authenticated, service_role;
grant execute on function auth.jwt(), auth.uid() to anon, authenticated, service_role;
create table public.companies (username text primary key, role text);
insert into public.companies values ('boss', 'MASTER'), ('owner', 'STAFF'), ('member', 'STAFF'), ('other', 'STAFF'), ('client', 'CLIENT');
create table public.orgs (id uuid primary key);
insert into public.orgs values ('${ORG}'), ('${ORG2}');
create table public.brands (id uuid primary key, name text, org_id uuid references public.orgs(id));
insert into public.brands values ('${HHH}', '하이헤이호', '${ORG}'), ('${LOHI}', '로하이스튜디오', '${ORG}'), ('00000000-0000-0000-0000-0000000000a3', '토비', '${ORG}'), ('${NEWB}', '새 고객 브랜드', '${ORG2}');
create table public.ig_accounts (id uuid primary key default gen_random_uuid(), brand_id uuid references public.brands(id), username text);
create table public.platform_admins (user_id uuid primary key);
insert into public.platform_admins values ('${U.boss}');
create table public.org_memberships (org_id uuid, user_id uuid, role text, primary key (org_id, user_id));
insert into public.org_memberships values ('${ORG}', '${U.owner}', 'admin'), ('${ORG}', '${U.member}', 'member'), ('${ORG2}', '${U.other}', 'owner'), ('${ORG2}', '${U.client}', 'owner');
create function public.is_staff() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from companies where username = split_part(auth.jwt()->>'email', '@', 1) and role in ('MASTER', 'STAFF')) $$;
grant execute on function public.is_staff() to authenticated;
`;

test('116 광고 판정선 수정 RPC(PGlite)', { skip: !P && 'PGLITE_PATH 없음 — 건너뜀' }, async t => {
    const { PGlite } = await import(pathToFileURL(P).href);
    const db = new PGlite();
    await db.exec(STUB);
    await db.exec(M105);
    await db.exec(M116);
    await db.exec(M116);                                    // 재실행 안전
    const q = async (sql, p = []) => (await db.query(sql, p)).rows;
    const as = async (who, sql, params = []) => {
        const claims = who ? JSON.stringify({ email: `${who}@bhas.com`, sub: U[who] }) : '';
        await db.exec(`reset role; select set_config('request.jwt.claims', '${claims}', false);`);
        await db.exec(who ? 'set role authenticated' : 'set role anon');
        try { return (await db.query(sql, params)).rows; } finally { await db.exec('reset role'); }
    };
    const set = (who, brand, up, stop, days = null, spend = null) =>
        as(who, `select up_max, stop_over, min_days, min_spend, updated_by from public.set_ad_report_rule($1, $2, $3, $4, $5)`, [brand, up, stop, days, spend]);
    const rule = async b => (await q(`select up_max, stop_over, min_days, min_spend from ad_report_rules where brand_id = $1`, [b]))[0];
    const logs = async () => q(`select brand_id, before, after, changed_email from ad_report_rule_log order by id`);

    await t.test('표를 직접 update 하는 길은 여전히 막혀 있다', async () => {
        await assert.rejects(as('boss', `update ad_report_rules set up_max = 1`), /permission denied|row-level security/);
    });

    await t.test('플랫폼관리자: 하이헤이호 1000/1300 → 1000/1000 거부, 1000/1300 저장 + 전후 기록', async () => {
        await assert.rejects(set('boss', HHH, 1000, 1000), /증액선은 0보다 크고 유지선보다 작아야/);
        await assert.rejects(set('boss', HHH, 0, 1300), /증액선/);
        await assert.rejects(set('boss', HHH, null, 700), /증액선/, '유지선만 바꿔도 증액선(800)보다 작으면 거부');
        const [r] = await set('boss', HHH, null, 1000);
        assert.deepEqual([r.up_max, r.stop_over, r.min_days, r.min_spend, r.updated_by], [800, 1000, 2, 20000, 'boss@bhas.com'], 'null 칸은 지금 값 유지');
        const l = await logs();
        assert.equal(l.length, 1);
        assert.deepEqual([l[0].before.stop_over, l[0].after.stop_over, l[0].changed_email], [1300, 1000, 'boss@bhas.com']);
    });

    await t.test('같은 값이면 바꾸지도 기록하지도 않는다', async () => {
        await set('boss', HHH, 800, 1000);
        assert.equal((await logs()).length, 1);
    });

    await t.test('조직 admin 은 자기 조직만, member·다른 조직·비로그인은 거부', async () => {
        const [r] = await set('owner', LOHI, 1000, 1200);
        assert.equal(r.stop_over, 1200);
        await assert.rejects(set('member', LOHI, 1000, 1500), /조직 관리자만/);
        await assert.rejects(set('other', LOHI, 1000, 1500), /조직 관리자만/);
        await assert.rejects(set(null, LOHI, 1000, 1500), /permission denied/);
        assert.equal((await rule(LOHI)).stop_over, 1200);
    });

    await t.test('행이 없는 브랜드는 새로 만든다(before=null), 최소일수·지출 검증', async () => {
        await assert.rejects(set('other', NEWB, 900, 1500, 0), /최소 일수/);
        await assert.rejects(set('other', NEWB, 900, 1500, 2, -1), /최소 지출/);
        const [r] = await set('other', NEWB, 900, 1500, 3, 5000);
        assert.deepEqual([r.up_max, r.stop_over, r.min_days, r.min_spend], [900, 1500, 3, 5000]);
        const last = (await logs()).at(-1);
        assert.equal(last.before, null);
        await assert.rejects(set('boss', '00000000-0000-0000-0000-00000000dead', 1, 2), /브랜드가 없습니다/);
    });

    await t.test('보안: member 가 임시표 platform_admins 로 바꿔치기해도 타조직 브랜드를 못 고친다(코덱스 팀장 반려 재현)', async () => {
        const before = await rule(NEWB);
        //  member 세션에서 같은 이름의 임시표를 만들고 자기를 넣는다(반려 원문 재현) → 그 세션 그대로 RPC 호출
        await db.exec(`reset role; select set_config('request.jwt.claims', '${JSON.stringify({ email: 'member@bhas.com', sub: U.member })}', false); set role authenticated;
            create temp table platform_admins (user_id uuid); insert into pg_temp.platform_admins values ('${U.member}');
            create temp table org_memberships (org_id uuid, user_id uuid, role text); insert into pg_temp.org_memberships values ('${ORG2}', '${U.member}', 'owner');`);
        try { await assert.rejects(db.query(`select public.set_ad_report_rule($1, 1, 2)`, [NEWB]), /조직 관리자만/); }
        finally { await db.exec('reset role'); }
        await db.exec('reset role; drop table if exists pg_temp.platform_admins, pg_temp.org_memberships');
        assert.deepEqual(await rule(NEWB), before);
        const defs = await q(`select proname, proconfig::text c from pg_proc where proname in ('set_ad_report_rule', 'ad_rule_log_can_read') order by proname`);
        assert.equal(defs.length, 2);
        for (const d of defs) assert.match(d.c, /search_path=pg_catalog, ?pg_temp/, d.proname);
    });

    await t.test('기록 읽기는 자기 조직 브랜드만(플랫폼관리자는 전부), 쓰기는 막힘', async () => {
        const seen = async who => (await as(who, `select distinct brand_id::text b from ad_report_rule_log order by 1`)).map(r => r.b);
        assert.deepEqual(await seen('member'), [HHH, LOHI].sort());          // 같은 조직 구성원
        assert.deepEqual(await seen('other'), [NEWB]);                        // 고객 조직 owner = 자기 것만(STAFF 여도 타조직 못 봄)
        assert.deepEqual(await seen('boss'), [HHH, LOHI, NEWB].sort());
        assert.deepEqual(await as(null, `select 1 from ad_report_rule_log`).catch(() => []), []);
        await assert.rejects(as('member', `insert into ad_report_rule_log (brand_id, after) values ('${HHH}', '{}')`), /permission denied/);
    });

    await t.test('고객 조직 owner(CLIENT): 저장 전후 자기 판정선 1행·타조직 0행(코덱스 팀장 반려2 재현)', async () => {
        const seen = async () => (await as('client', `select brand_id::text b, up_max, stop_over from ad_report_rules order by 1`));
        const before = await seen();
        assert.deepEqual(before.map(r => r.b), [NEWB]);                       // 타조직(하이헤이호·로하이) 0
        const saved = await set('client', NEWB, 900, 1500);
        assert.deepEqual([saved[0].up_max, saved[0].stop_over], [900, 1500]);
        const after = await seen();
        assert.deepEqual(after, [{ b: NEWB, up_max: 900, stop_over: 1500 }]); // 저장값이 그대로 읽힌다
        assert.equal((await as('client', `select count(*)::int n from ad_report_rule_log where brand_id <> '${NEWB}'`))[0].n, 0);
    });

    await t.test('되돌리기: 함수·로그표만 지우고 판정선 값은 남긴다', async () => {
        await db.exec(DOWN);
        await db.exec(DOWN);
        const left = await q(`select (select count(*)::int from pg_proc where proname in ('set_ad_report_rule', 'ad_rule_log_can_read')) f, to_regclass('public.ad_report_rule_log')::text t, (select array_agg(policyname::text order by policyname) from pg_policies where tablename = 'ad_report_rules') pol`);
        assert.deepEqual(left[0].pol, ['ad_report_rules_staff_read']);          // 105 정책만 남음
        assert.deepEqual([left[0].f, left[0].t], [0, null]);
        assert.equal((await rule(HHH)).stop_over, 1000);
    });
});
