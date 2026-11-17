//  110 광고 인사이트 DB — PGlite 에 105·107·108·110 을 깔고 칸·뷰·권한·되돌리기를 본다.
//  v_ad_creative_3d 가 ad-insight.js creativesOf 와 같은 숫자를 내는지 대조한다(규칙이 두 군데라 어긋나면 안 된다).
//  돌리려면: PGLITE_PATH=<@electric-sql/pglite 폴더>/dist/index.js npm test  (없으면 건너뜀)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { creativesOf } from '../supabase/functions/_shared/ad-insight.js';

const rd = p => readFileSync(new URL('../supabase/' + p, import.meta.url), 'utf8');
const [M105, M107, M108, M110, D110] = ['migrations/105_ad_report.sql', 'migrations/107_ad_adset.sql', 'migrations/108_ad_exclude.sql',
    'migrations/110_ad_insight.sql', 'rollbacks/110_ad_insight.down.sql'].map(rd);
const DRY = rd('rehearsals/110_ad_insight_dryrun.sql');
const P = process.env.PGLITE_PATH;
const STUB = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
create table public.brands (id uuid primary key default gen_random_uuid(), name text);
create table public.ig_accounts (id uuid primary key default gen_random_uuid(), brand_id uuid references public.brands(id), username text);
create function public.is_staff() returns boolean language sql stable as $$ select true $$;
`;

test('110 광고 인사이트 DB(PGlite)', { skip: !P && 'PGLITE_PATH 없음 — 건너뜀' }, async t => {
    const { PGlite } = await import(pathToFileURL(P).href);
    const db = new PGlite();
    const q = async (sql, p = []) => (await db.query(sql, p)).rows;
    await db.exec(STUB); await db.exec(M105); await db.exec(M107); await db.exec(M108);
    await q(`insert into ad_links (ad_id, ad_account_id, adset_name, media_id, created_time) values
             ('a1','919','hhh_1101가디건_PV','m1','2026-11-01'), ('a2','919','hhh_1101가디건_PV','m1','2026-11-02'),
             ('a3','919','hhh_1103니트_PV',null,'2026-11-03'), ('x1','919','hhh_x','m9','2026-11-01')`);
    await q(`update ad_links set excluded = true where ad_id = 'x1'`);
    await q(`insert into ad_daily (ad_id, day, media_id, spend, follows, impressions) values
             ('a1','2026-11-01','m1',10000,10,5000), ('a1','2026-11-02','m1',10000,8,5000), ('a2','2026-11-02','m1',5000,2,2000),
             ('a1','2026-11-03','m1',0,0,0), ('a1','2026-11-04','m1',12000,6,5000), ('a1','2026-11-05','m1',99999,1,9000),
             ('a3','2026-11-03','m',3000,1,1000), ('a3','2026-11-04','m',3000,0,1000),
             ('x1','2026-11-01','m9',50000,1,1000)`);
    const before = await q(`select * from ad_daily order by ad_id, day`);

    await db.exec(M110); await db.exec(M110);   // 재실행 안전
    await t.test('dry-run 은 읽기만 · 108 선행 확인 · 기존 행 값 그대로', async () => {
        const [r] = await q(DRY);
        assert.equal(Number(r.has_108_excluded), 1); assert.equal(Number(r.already_110_tables), 2);
        assert.equal(Number(r.live_ads), 3); assert.equal(Number(r.creatives), 2);
        const after = await q(`select ad_id, day, spend, follows, impressions from ad_daily order by ad_id, day`);
        assert.deepEqual(after, before.map(b => ({ ad_id: b.ad_id, day: b.day, spend: b.spend, follows: b.follows, impressions: b.impressions })));
        assert.equal((await q(`select count(*)::int n from ad_daily where cum_frequency is not null or clicks is not null`))[0].n, 0);
    });
    await t.test('v_ad_creative_3d == creativesOf (같은 게시물 합산 · 지출 0 날 건너뜀 · 앞 3일만 · 제외 광고 뺌)', async () => {
        const v = await q(`select key, days, spend3::int, follows3::int, cpf3::int from v_ad_creative_3d order by key`);
        const links = await q(`select * from ad_links`), daily = (await q(`select ad_id, day::text, spend, follows from ad_daily`));
        const js = creativesOf({ links, daily, media: [] }).map(c => ({ key: c.key, days: c.days, spend3: c.spend3, follows3: c.follows3, cpf3: c.cpf3 }))
            .sort((a, b) => a.key.localeCompare(b.key));
        assert.deepEqual(v, js);
        assert.deepEqual(v.find(r => r.key === 'm:m1'), { key: 'm:m1', days: 3, spend3: 37000, follows3: 26, cpf3: 1423 });
        assert.ok(!v.some(r => r.key === 'm:m9'));
    });
    await t.test('판정 저장 · 최신 판정 뷰 · 링크 CTR', async () => {
        await q(`update ad_daily set link_clicks = 400 where ad_id='a1' and day='2026-11-01'`);
        await q(`insert into ad_fatigue (ad_id, day, state, reasons) values ('a1','2026-11-04','fresh','["a"]'), ('a1','2026-11-05','warn','["b"]')`);
        const [f] = await q(`select ad_id, state, day::text from v_ad_fatigue_latest`);
        assert.deepEqual(f, { ad_id: 'a1', state: 'warn', day: '2026-11-05' });
        const [m] = await q(`select link_ctr::float, cpf::int from v_ad_daily_metrics where ad_id='a1' and day='2026-11-01'`);
        assert.deepEqual([m.link_ctr, m.cpf], [8, 1000]);
        await assert.rejects(q(`insert into ad_fatigue (ad_id, day, state) values ('a1','2026-11-06','bad')`));
    });
    await t.test('권한: anon 은 못 읽고 authenticated 는 select 만', async () => {
        for (const tb of ['ad_fatigue', 'ad_budget_log', 'v_ad_creative_3d', 'v_ad_fatigue_latest', 'v_ad_daily_metrics']) {
            const [p] = await q(`select has_table_privilege('anon', 'public.${tb}', 'select') a, has_table_privilege('authenticated', 'public.${tb}', 'select') s,
                                        has_table_privilege('authenticated', 'public.${tb}', 'insert') i`);
            assert.deepEqual([p.a, p.s, p.i], [false, true, false], tb);
        }
    });
    await t.test('되돌리기 — 110 칸·표·뷰만 사라지고 105~108 은 남는다, 두 번 돌려도 된다', async () => {
        await db.exec(D110); await db.exec(D110);
        const cols = (await q(`select column_name from information_schema.columns where table_name='ad_daily'`)).map(r => r.column_name);
        assert.ok(!cols.includes('cum_frequency') && cols.includes('follows'));
        assert.equal((await q(`select count(*)::int n from information_schema.tables where table_name in ('ad_fatigue','ad_budget_log')`))[0].n, 0);
        assert.equal((await q(`select count(*)::int n from ad_links where excluded`))[0].n, 1);
        await db.exec(M110);   // 다시 깔 수 있다
    });
});
