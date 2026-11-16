//  108 광고 데이터 제외 DB — PGlite 에 105·107·108 을 깔고 제외 표시·트리거·게시물 뷰·되돌리기를 본다.
//  돌리려면: PGLITE_PATH=<@electric-sql/pglite 폴더>/dist/index.js npm test  (없으면 건너뜀)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const rd = p => readFileSync(new URL('../supabase/' + p, import.meta.url), 'utf8');
const [M105, M107, M108, D108] = ['migrations/105_ad_report.sql', 'migrations/107_ad_adset.sql', 'migrations/108_ad_exclude.sql', 'rollbacks/108_ad_exclude.down.sql'].map(rd);
const P = process.env.PGLITE_PATH;
const STUB = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
create table public.brands (id uuid primary key default gen_random_uuid(), name text);
create table public.ig_accounts (id uuid primary key default gen_random_uuid(), brand_id uuid references public.brands(id), username text);
create function public.is_staff() returns boolean language sql stable as $$ select true $$;
`;
const EX = ['120255644017600038', '120255644017680038', '120255644017700038', '120255666999860038'];

test('108 광고 데이터 제외 DB(PGlite)', { skip: !P && 'PGLITE_PATH 없음 — 건너뜀' }, async t => {
    const { PGlite } = await import(pathToFileURL(P).href);
    const db = new PGlite();
    const q = async (sql, p = []) => (await db.query(sql, p)).rows;
    await db.exec(STUB); await db.exec(M105); await db.exec(M107);
    //  108 전: 제외 세트 광고 1개(X1, 게시물 M1) + 정상 광고 1개(N1, 같은 게시물 M1)
    await q(`insert into ad_links (ad_id, ad_account_id, adset_id, ad_name, effective_status, daily_budget, media_id) values
             ('X1','919',$1,'hhh_멜로우오버롤','ACTIVE',30000,'M1'), ('N1','919','S-OK','hhh_멜로우오버롤_PV','ACTIVE',20000,'M1')`, [EX[0]]);
    await q(`insert into ad_daily (ad_id, day, media_id, spend, follows) values
             ('X1', current_date - 2, 'M1', 30000, 6), ('N1', current_date - 2, 'M1', 20000, 40)`);
    const before = (await q(`select done_spend, done_follows, daily_budget from ad_post_cards where media_id='M1'`))[0];
    assert.deepEqual([Number(before.done_spend), Number(before.done_follows), before.daily_budget], [50000, 46, 50000]);

    await db.exec(M108); await db.exec(M108);              // 재실행 안전
    await t.test('4세트만 제외 표시 · 사유 기록 · 나머지는 그대로', async () => {
        const r = await q(`select ad_id, excluded, excluded_reason from ad_links order by ad_id`);
        assert.deepEqual(r.map(x => [x.ad_id, x.excluded]), [['N1', false], ['X1', true]]);
        assert.match(r[1].excluded_reason, /목표 오류/);
    });
    await t.test('게시물 뷰는 제외분을 뺀다(지출·팔로우·예산·광고목록) — 원본 ad_daily 는 그대로', async () => {
        const [c] = await q(`select ad_ids, done_spend, done_follows, daily_budget from ad_post_cards where media_id='M1'`);
        assert.deepEqual([c.ad_ids, Number(c.done_spend), Number(c.done_follows), c.daily_budget], [['N1'], 20000, 40, 20000]);
        assert.equal((await q(`select count(*)::int n from ad_daily`))[0].n, 2);
    });
    await t.test('같은 세트에 새 광고가 들어오면 제외가 따라간다 · 다른 세트는 아니다 · 수집 upsert 가 제외를 덮지 않는다', async () => {
        await q(`insert into ad_links (ad_id, ad_account_id, adset_id, ad_name) values ('X2','919',$1,'새광고'), ('N2','919','S-OK','새광고2')`, [EX[0]]);
        //  ad-report-sync 와 같은 모양의 upsert(excluded 열 없음)
        await q(`insert into ad_links (ad_id, ad_account_id, adset_id, ad_name, effective_status) values ('X1','919',$1,'hhh_멜로우오버롤','PAUSED')
                 on conflict (ad_id) do update set ad_name = excluded.ad_name, effective_status = excluded.effective_status`, [EX[0]]);
        const r = Object.fromEntries((await q(`select ad_id, excluded, excluded_reason from ad_links`)).map(x => [x.ad_id, x]));
        assert.equal(r.X2.excluded, true); assert.match(r.X2.excluded_reason, /목표 오류/);
        assert.equal(r.N2.excluded, false); assert.equal(r.N2.excluded_reason, null);
        assert.equal(r.X1.excluded, true, 'upsert 뒤에도 제외 유지');
    });
    await t.test('되돌리기: 열·트리거 걷히고 뷰는 105 그대로(제외분 다시 합산) · 다시 깔 수 있다', async () => {
        await db.exec(D108);
        const cols = await q(`select column_name from information_schema.columns where table_name='ad_links' and column_name like 'excluded%'`);
        assert.equal(cols.length, 0);
        const [c] = await q(`select done_spend, done_follows from ad_post_cards where media_id='M1'`);
        assert.deepEqual([Number(c.done_spend), Number(c.done_follows)], [50000, 46]);
        await db.exec(M108);
        assert.equal((await q(`select count(*)::int n from ad_links where excluded`))[0].n, 2);
    });
    await db.close();
});
