//  105 광고리포트 DB — 진짜 Postgres(PGlite)에 105 를 깔고 권한·판정선 시드·게시물 합산 뷰를 확인한다.
//  돌리려면: PGLITE_PATH=<@electric-sql/pglite 폴더>/dist/index.js npm test  (없으면 건너뜀)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SQL = readFileSync(new URL('../supabase/migrations/105_ad_report.sql', import.meta.url), 'utf8');
const DOWN = readFileSync(new URL('../supabase/rollbacks/105_ad_report.down.sql', import.meta.url), 'utf8');
const P = process.env.PGLITE_PATH;

//  Supabase·기존 마이그레이션이 깔아 둔 것만 흉내: 역할 · auth.jwt() · companies · brands · ig_accounts · is_staff(087 그대로)
const STUB = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema auth, public to anon, authenticated, service_role;
grant execute on function auth.jwt() to anon, authenticated, service_role;
create table public.companies (username text primary key, role text);
insert into public.companies values ('boss', 'MASTER'), ('kim', 'STAFF'), ('client1', 'CLIENT');
create table public.brands (id uuid primary key default gen_random_uuid(), name text);
insert into public.brands (id, name) values ('00000000-0000-0000-0000-0000000000a1', '하이헤이호'),
  ('00000000-0000-0000-0000-0000000000a2', '로하이스튜디오'), ('00000000-0000-0000-0000-0000000000a3', '토비'), ('00000000-0000-0000-0000-0000000000a4', '브하스');
create table public.ig_accounts (id uuid primary key default gen_random_uuid(), brand_id uuid references public.brands(id), username text);
create function public.is_staff() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from companies where username = split_part(auth.jwt()->>'email', '@', 1) and role in ('MASTER', 'STAFF')) $$;
revoke all on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated;
`;
const HHH = '00000000-0000-0000-0000-0000000000a1', LOHI = '00000000-0000-0000-0000-0000000000a2';

test('105 광고리포트 DB(PGlite)', { skip: !P && 'PGLITE_PATH 없음 — 건너뜀' }, async t => {
    const { PGlite } = await import(pathToFileURL(P).href);
    const db = new PGlite();
    await db.exec(STUB);
    await db.exec(SQL);
    await db.exec(SQL);                                     // 재실행 안전
    const q = async (sql, p = []) => (await db.query(sql, p)).rows;
    const as = async (who, sql, params = []) => {
        await db.exec(`reset role; select set_config('request.jwt.claims', '${who ? JSON.stringify({ email: `${who}@bhas.com` }) : ''}', false);`);
        await db.exec(who ? 'set role authenticated' : 'set role anon');
        try { return (await db.query(sql, params)).rows; } finally { await db.exec('reset role'); }
    };
    const denied = (p) => assert.rejects(p, /row-level security|permission denied/);

    await t.test('판정선 시드 = 사장님 확정값(하이헤이호 800/1300 · 로하이·토비 1000/1600), 재실행해도 3행', async () => {
        const rows = await q(`select b.name, r.test_daily_budget, r.min_days, r.min_spend, r.up_max, r.stop_over, r.early_mult::float m
                                from ad_report_rules r join brands b on b.id = r.brand_id order by b.name`);
        assert.deepEqual(rows.map(r => [r.name, r.test_daily_budget, r.min_days, r.min_spend, r.up_max, r.stop_over, r.m]), [
            ['로하이스튜디오', 10000, 2, 10000, 1000, 1600, 2], ['토비', 10000, 2, 10000, 1000, 1600, 2], ['하이헤이호', 20000, 2, 20000, 800, 1300, 2]]);
    });

    //  오늘(KST) 기준 날짜
    const [{ today }] = await q(`select (now() at time zone 'Asia/Seoul')::date::text today`);
    const day = n => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

    await t.test('같은 게시물 광고 2개 → 카드 1장 · 지출/팔로우 합산 · 완결은 어제까지 · 도달은 계정 조회값', async () => {
        await q(`insert into ad_links (ad_id, ad_account_id, currency, adset_id, ad_name, effective_status, daily_budget, media_id, media_src, brand_id)
                 values ('A1','919','KRW','S1','lohi_FW','ACTIVE',10000,'M1','source',$1), ('A2','919','KRW','S2','lohi_FW2','ACTIVE',10000,'M1','source',$1),
                        ('A3','919','KRW','S3','hhh_x','PAUSED',20000,'M2','source',$2)`, [LOHI, HHH]);
        await q(`insert into ad_daily (ad_id, day, media_id, spend, impressions, reach, profile_visits, follows) values
                 ('A1',$1,'M1',9000,1000,900,30,10), ('A2',$1,'M1',8000,800,700,20,6),
                 ('A1',$2,'M1',10000,1100,950,25,9), ('A2',$2,'M1',10000,900,800,22,5),
                 ('A1',$3,'M1',3000,300,280,5,1),
                 ('A3',$4,'M2',20000,2000,1800,60,0)`, [day(-2), day(-1), day(0), day(-20)]);
        await q(`insert into ad_post_reach (media_id, since, until, reach) values ('M1',$1,$2,3000)`, [day(-2), day(0)]);
        const [c] = await as('kim', `select * from ad_post_cards where media_id = 'M1'`);
        assert.deepEqual(c.ad_ids, ['A1', 'A2']);
        assert.equal(Number(c.done_spend), 37000); assert.equal(Number(c.done_follows), 30); assert.equal(c.done_days, 2);
        assert.equal(Number(c.today_spend), 3000); assert.equal(Number(c.total_spend), 40000);
        assert.equal(c.daily_budget, 20000, '진행중 세트 예산 합');
        assert.equal(c.reach, 3000); assert.notEqual(c.reach, 900 + 700 + 950 + 800 + 280, '광고별 도달 합이 아니다');
        assert.equal(c.any_active, true); assert.deepEqual(c.currencies, ['KRW']); assert.equal(c.brand_id, LOHI);
        const [c2] = await as('boss', `select any_active, done_days, total_follows from ad_post_cards where media_id = 'M2'`);
        assert.deepEqual([c2.any_active, c2.done_days, Number(c2.total_follows)], [false, 1, 0]);
    });

    await t.test('소급 변경: 같은 (ad_id, day) 를 다시 받으면 1행 · 최신 값', async () => {
        await q(`insert into ad_daily (ad_id, day, media_id, spend, follows) values ('A1',$1,'M1',9500,11)
                 on conflict (ad_id, day) do update set spend = excluded.spend, follows = excluded.follows, fetched_at = now()`, [day(-2)]);
        const rows = await q(`select spend, follows from ad_daily where ad_id = 'A1' and day = $1`, [day(-2)]);
        assert.deepEqual(rows.map(r => [r.spend, r.follows]), [[9500, 11]]);
    });

    await t.test('갱신 실패 표시: last_fail_at 이 last_ok_at 보다 늦으면 any_failed', async () => {
        await q(`update ad_links set last_ok_at = now() - interval '3 hours', last_fail_at = now() where ad_id = 'A2'`);
        const [c] = await q(`select any_failed from ad_post_cards where media_id = 'M1'`);
        assert.equal(c.any_failed, true);
    });

    await t.test('권한: 직원·대표만 읽고, 고객사·익명은 못 읽고, 직원도 못 쓴다', async () => {
        await q(`insert into ad_report_state (id, result, last_ok_at) values (1, 'ok', now())`);
        for (const tb of ['ig_media', 'ad_links', 'ad_daily', 'ad_post_reach', 'ad_report_rules', 'ad_report_state', 'ad_post_cards']) {
            assert.equal((await as('client1', `select * from ${tb}`)).length, 0, `${tb}: 고객사 0행`);
            await denied(as(null, `select * from ${tb}`));
        }
        assert.ok((await as('kim', `select * from ad_links`)).length === 3);
        assert.equal((await as('client1', `select * from ad_post_cards`)).length, 0);
        await denied(as('kim', `insert into ad_daily (ad_id, day, spend) values ('X', current_date, 1)`));
        await denied(as('boss', `update ad_report_rules set up_max = 1`));
        await denied(as('boss', `delete from ad_links`));
        assert.equal((await q(`select up_max from ad_report_rules where brand_id = $1`, [HHH]))[0].up_max, 800);
    });

    await t.test('되돌리기: 사람이 판정선을 바꿨으면 멈추고, 시드 그대로면 다 걷힌다', async () => {
        await q(`update ad_report_rules set up_max = 700, updated_by = 'boss' where brand_id = $1`, [HHH]);
        await assert.rejects(db.exec(DOWN), /사람이 바꾼 판정선/);
        await q(`update ad_report_rules set updated_by = 'seed-105'`);
        await db.exec(DOWN);
        const left = await q(`select count(*)::int n from pg_class where relname in ('ig_media','ad_links','ad_daily','ad_post_reach','ad_report_rules','ad_report_state','ad_post_cards')`);
        assert.equal(left[0].n, 0);
        await db.exec(SQL);                                 // 다시 깔 수 있다
    });
    await db.close();
});
