//  103 재구매 쿠폰 1-A — 운영 스냅숏(fixtures/rls-snapshot-1028.sql) 위에 103 을 깔고 진짜 Postgres(PGlite)에서
//  규칙 → 회차(명단 고정) → 승인 → CSV → 수동 업로드 확인 → 쿨다운을 사람을 바꿔 가며 확인한다(기획 v2 10절).
//  PGlite 는 프로젝트 의존성이 아니다. 돌리려면: PGLITE_PATH=<@electric-sql/pglite 폴더>/dist/index.js npm test
//  순수 함수·정적 검사는 PGLITE_PATH 없이도 돈다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { nextRunAt, describeSchedule, validateRule, exportCSV, parseMemberIds, runActions, effectVerdict, DEFAULT_RULE, fmtKST }
    from '../repurchaseCoupon.js';

const rd = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const SNAP = rd('./fixtures/rls-snapshot-1028.sql');
const UP = rd('../supabase/migrations/103_repurchase_coupon.sql');
const DOWN = rd('../supabase/rollbacks/103_repurchase_coupon.down.sql');
const P = process.env.PGLITE_PATH;
const DAY = 864e5;

const STUB = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create schema storage;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;
grant usage on schema auth, storage, public to anon, authenticated, service_role;
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
`;
//  운영에는 brands.id 기본키가 있다(스냅숏은 칸만 떠 둠)
const AFTER_SNAP = 'alter table brands add primary key (id);';

// ---------------------------------------------------------------- 순수 함수
const T = s => new Date(s);
const SCHED_CASES = [
    // [이름, 일정, 기준 시각(UTC), 기대(UTC)]
    ['매월 31일 → 11월은 말일', { freq: 'monthly', monthday: 31, time_kst: '10:00' }, '2026-11-05T00:00:00Z', '2026-11-30T01:00:00Z'],
    ['매주 월 10:00 을 월 10:05 에 저장 → 다음 주 월', { freq: 'weekly', weekday: 1, time_kst: '10:00' }, '2026-11-02T01:05:00Z', '2026-11-09T01:00:00Z'],
    ['매주 월 10:00 을 월 09:59 에 → 오늘', { freq: 'weekly', weekday: 1, time_kst: '10:00' }, '2026-11-02T00:59:00Z', '2026-11-02T01:00:00Z'],
    ['KST 자정 넘김(UTC 일요일 15:30 = KST 월 00:30)', { freq: 'weekly', weekday: 1, time_kst: '10:00' }, '2026-11-01T15:30:00Z', '2026-11-02T01:00:00Z'],
    ['매월 31일 → 12월 31일', { freq: 'monthly', monthday: 31, time_kst: '10:00' }, '2026-11-30T02:00:00Z', '2026-12-31T01:00:00Z'],
    ['2월 말일(윤년 아님)', { freq: 'monthly', monthday: 30, time_kst: '09:00' }, '2027-02-01T00:00:00Z', '2027-02-28T00:00:00Z'],
    ['14일마다, 시작일 기준', { freq: 'every_n', every_days: 14, time_kst: '10:00', start_date: '2026-10-01' }, '2026-11-03T00:00:00Z', '2026-11-12T01:00:00Z'],
    ['시작일이 미래', { freq: 'weekly', weekday: 3, time_kst: '08:30', start_date: '2026-12-01' }, '2026-11-03T00:00:00Z', '2026-12-01T23:30:00Z'],
    ['종료일 넘으면 없음', { freq: 'weekly', weekday: 1, time_kst: '10:00', end_date: '2026-11-08' }, '2026-11-02T02:00:00Z', null],
];

test('다음 실행 계산(KST, 말일 보정, 종료일)', () => {
    for (const [name, s, after, want] of SCHED_CASES) {
        const got = nextRunAt(s, T(after));
        assert.equal(got ? got.toISOString() : null, want ? T(want).toISOString() : null, name);
    }
    assert.equal(fmtKST(T('2026-11-09T01:00:00Z')), '11/9(월) 10:00');
    assert.match(describeSchedule({ freq: 'monthly', monthday: 31, time_kst: '10:00' }), /말일/);
});

test('규칙 화면 검사 · CSV · 결과 파일 회원 ID', () => {
    assert.equal(validateRule({ ...DEFAULT_RULE }), '규칙 이름을 넣어 주세요');
    const ok = { ...DEFAULT_RULE, name: '휴면90', brand_id: 'b', coupon: { cafe24_coupon_no: '1234' } };
    assert.equal(validateRule(ok), null);
    assert.equal(validateRule({ ...ok, coupon: { cafe24_coupon_no: ' ' } }), '카페24 쿠폰 번호를 넣어 주세요');
    assert.equal(validateRule({ ...ok, target: {} }), '대상(묶음 또는 직접 조건)을 정해 주세요');
    assert.equal(validateRule({ ...ok, schedule: { ...ok.schedule, time_kst: '25:00' } }), '시각은 HH:MM');
    //  CSV = 회원 ID 한 칸(전화·이메일 없음)
    assert.equal(exportCSV(['a1', 'b"2']), '회원ID\r\n"a1"\r\n"b""2"');
    //  결과 파일: 머리글 있는 CSV · 머리글 없는 TXT · 중복 제거
    assert.deepEqual(parseMemberIds('﻿쿠폰번호,회원아이디,발급일\r\n1234,kim01,2026-11-09\r\n1234,lee02,2026-11-09\r\n1234,kim01,x'), ['kim01', 'lee02']);
    assert.deepEqual(parseMemberIds('kim01\nlee02\n\n'), ['kim01', 'lee02']);
    //  버튼: STAFF 는 아무것도, MASTER 는 상태별
    assert.deepEqual(runActions('awaiting_approval', false), []);
    assert.deepEqual(runActions('needs_review', true), ['reject', 'cancel']);
    assert.ok(runActions('exported', true).includes('confirm'));
    assert.ok(!runActions('approved_for_export', true).includes('confirm'), 'CSV 받기 전에는 확인 불가');
    //  효과 주장은 4회 이상 + 매번 같은 방향일 때만
    const r = (t, c) => ({ issued_n: 100, control_n: 10, treat_returned: t, control_returned: c });
    assert.equal(effectVerdict([r(20, 1), r(20, 1), r(20, 1)]).effect, null);
    assert.equal(effectVerdict([r(20, 1), r(20, 1), r(20, 1), r(20, 1)]).effect, true);
    assert.equal(effectVerdict([r(20, 1), r(20, 1), r(20, 1), r(5, 9)]).effect, false);
});

test('정적: 1-A 에 외부 발송·발급 호출이 없다', () => {
    const js = rd('../repurchaseCoupon.js');
    const noComments = src => src.replace(/--[^\n]*/g, '').replace(/\/\/[^\n]*/g, '');
    for (const [name, src] of [['103', noComments(UP)], ['repurchaseCoupon.js', noComments(js)]]) {
        assert.doesNotMatch(src, /net\.http|http_post|fetch\(|sms|alimtalk|kakao|sendmail|mailer|functions\/v1/i, name);
    }
    //  issued 를 만드는 곳은 수동 확인 함수 하나뿐
    const setsIssued = [...UP.matchAll(/set status = 'issued'/g)].length;
    const confirmBody = UP.slice(UP.indexOf('function public.coupon_run_confirm_manual'), UP.indexOf('-- 8) 성과'));
    assert.equal([...confirmBody.matchAll(/set status = 'issued'/g)].length, setsIssued);
    assert.ok(setsIssued >= 1);
});

// ---------------------------------------------------------------- DB
const B = 'b0000000-0000-4000-8000-000000000001', B2 = 'b0000000-0000-4000-8000-000000000002';
const U = { boss: 'cccccccc-0000-4000-8000-000000000001', staff: 'cccccccc-0000-4000-8000-000000000002', partner: 'cccccccc-0000-4000-8000-000000000003' };

test('103 재구매 쿠폰 1-A(PGlite, 운영 스냅숏)', { skip: !P && 'PGLITE_PATH 없음 — 건너뜀' }, async t => {
    const { PGlite } = await import(pathToFileURL(P).href);
    const db = new PGlite();
    await db.exec(STUB); await db.exec(SNAP); await db.exec(AFTER_SNAP);
    await db.exec(`
      insert into brands (id, name) values ('${B}', '하이헤이호'), ('${B2}', '다른브랜드');
      insert into companies (id, name, role, username, brand_id) values
        ('${U.boss}', '대표', 'MASTER', 'boss', null), ('${U.staff}', '직원', 'STAFF', 'staff', null), ('${U.partner}', '파트너', 'CLIENT', 'partner', '${B2}');
      insert into malls (mall_key, label, channel, brand_id, active) values
        ('hh', '하이헤이호', 'cafe24', '${B}', true), ('hh29', '29CM', '29cm', '${B}', true), ('other', '다른', 'cafe24', '${B2}', true);`);
    await db.exec(UP);

    const as = async (who, sql, params) => {
        await db.exec('reset role');
        const claims = who ? { role: 'authenticated', sub: U[who], email: `${who}@bhas.com` } : null;
        await db.query(`select set_config('request.jwt.claims', $1, false)`, [claims ? JSON.stringify(claims) : '']);
        if (who) await db.exec('set role authenticated');
        try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
    };
    const one = async (who, sql, params) => (await as(who, sql, params)).rows[0];
    const denied = async (who, sql, params, code = '42501') => {
        await assert.rejects(as(who, sql, params), e => e.code === code || new RegExp(code).test(e.message), `${who}: ${sql}`);
    };

    //  대조군/발송군 회원 ID 를 해시로 골라 둔다(같은 사람은 언제나 같은 군)
    const pick = async (pfx, ctl, n) => (await db.query(
        `select x from (select '${pfx}' || g x from generate_series(1, 3000) g) s where (coupon_bucket(x) < 10) = $1 order by x limit $2`, [ctl, n])).rows.map(r => r.x);
    const TREAT = await pick('t', false, 4), CTL = await pick('c', true, 1);
    const ago = n => new Date(Date.now() - n * DAY).toISOString();
    let oid = 0;
    const order = (mem, days, o = {}) => db.query(
        `insert into channel_orders (channel, order_id, order_date, buyer_name, receiver_phone, pay_amount, op_status, mall_key, raw)
         values ('cafe24', $1, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [`o${++oid}`, o.at || ago(days), o.name || `고객${mem}`, o.phone || `010-0000-${String(oid).padStart(4, '0')}`,
            o.amt ?? 50000, o.st || 'done', o.mall || 'hh', JSON.stringify({ member_id: mem })]);
    for (const m of [...TREAT, ...CTL]) await order(m, 100);
    await order('cancel_only', 100, { st: 'cancel' });            // 취소 주문만 → 대상 아님
    await order('ext_mall', 100, { mall: 'hh29' });               // 외부몰 → 대상 아님
    await order('ph1', 100, { phone: '010-1111-2222' });          // 번호 공유 두 회원 → 제외
    await order('ph2', 100, { phone: '01011112222' });
    const csOrder = (await order('cs_open', 100)).rows[0].id;     // 진행 중 CS → 제외
    await db.query(`insert into cs_tickets (channel_order_id, status, customer_name) values ($1, '수거접수', 'x')`, [csOrder]);
    await order('first40', 40);                                   // 첫구매30 + 직접 조건 둘 다

    const RULE = { name: '휴면90 매주 월', brand_id: B, target: { preset: 'dormant90' },
        coupon: { cafe24_coupon_no: '9001', memo: '15%·최대 1만', max_discount: 10000, valid_days: 7 },
        schedule: { freq: 'weekly', weekday: 1, time_kst: '10:00' }, control_pct: 10, cooldown_days: 90, max_targets: 500, priority: 100 };
    let ruleId, run1, run2;
    const forceDue = (id, minutesAgo) => db.query(`update coupon_rules set next_run_at = now() - make_interval(mins => $2) where id = $1`, [id, minutesAgo]);
    const tick = (offsetH = 0) => db.query(`select coupon_runs_tick(now() + make_interval(hours => $1)) r`, [offsetH]).then(r => r.rows[0].r);
    const members = async run => (await db.query(`select member_id, arm, status, exclude_reason, issue_path, issued_at, last_error from coupon_run_members where run_id = $1 order by member_id`, [run])).rows;
    const runRow = async run => (await db.query(`select * from coupon_runs where id = $1`, [run])).rows[0];

    await t.test('KST 경계: KST 11/1 08:30(UTC 10/31) 구매는 11/1 로 친다', async () => {
        await order('kst_edge', 0, { at: '2026-10-31T23:30:00Z' });
        const r = await db.query(`select last_date::text, gone_days from _coupon_member_stats($1, '2026-11-01') where member_id = 'kst_edge'`, [B]);
        assert.deepEqual(r.rows[0], { last_date: '2026-11-01', gone_days: 0 });
        const r2 = await db.query(`select count(*)::int n from _coupon_member_stats($1, '2026-10-31') where member_id = 'kst_edge'`, [B]);
        assert.equal(r2.rows[0].n, 0, '기준일 뒤 주문은 안 센다');
    });

    await t.test('다음 실행: SQL coupon_next_run = 화면 nextRunAt', async () => {
        for (const [name, s, after, want] of SCHED_CASES) {
            const r = await db.query(`select coupon_next_run($1, $2) v`, [JSON.stringify(s), after]);
            const got = r.rows[0].v ? new Date(r.rows[0].v).toISOString() : null;
            assert.equal(got, want ? T(want).toISOString() : null, name);
        }
    });

    await t.test('권한: 파트너 미리보기·STAFF 운영 시작 막힘, 직접 쓰기 막힘', async () => {
        await denied('partner', `select coupon_preview($1)`, [JSON.stringify(RULE)]);
        await denied(null, `select coupon_rule_save($1)`, [JSON.stringify(RULE)]);
        ruleId = (await one('staff', `select coupon_rule_save($1) id`, [JSON.stringify(RULE)])).id;   // STAFF 초안 가능
        await denied('staff', `select coupon_rule_set_status($1, 'active')`, [ruleId]);
        await denied('staff', `insert into coupon_rules (brand_id, name) values ('${B}', 'x')`, [], '42501|permission|row-level');
        await denied('authenticated' in U ? null : 'staff', `select coupon_runs_tick()`, [], '42501|permission');
        assert.equal((await as('partner', `select * from coupon_rules`)).rows.length, 0, '파트너는 규칙을 못 본다');
        assert.equal((await as('staff', `select * from coupon_rules`)).rows.length, 1);
    });

    await t.test('저장 검사·버전', async () => {
        await assert.rejects(as('boss', `select coupon_rule_save($1)`, [JSON.stringify({ ...RULE, coupon: { cafe24_coupon_no: '' } })]), /쿠폰 번호/);
        await assert.rejects(as('boss', `select coupon_rule_save($1)`, [JSON.stringify({ ...RULE, brand_id: B2, name: 'x', schedule: { freq: 'weekly' } })]), /요일/);
        await as('boss', `select coupon_rule_save($1)`, [JSON.stringify({ ...RULE, id: ruleId, name: '휴면90 · 매주 월 10시' })]);
        const r = await db.query(`select version, status, next_run_at from coupon_rules where id = $1`, [ruleId]);
        assert.deepEqual([r.rows[0].version, r.rows[0].status, r.rows[0].next_run_at], [2, 'draft', null]);
        assert.equal((await db.query(`select count(*)::int n from coupon_rule_versions where rule_id = $1`, [ruleId])).rows[0].n, 2);
    });

    await t.test('미리보기: 제외 전 수·발송/대조·제외 사유·마스킹 표본', async () => {
        const p = (await one('staff', `select coupon_preview($1) p`, [JSON.stringify({ ...RULE, id: ruleId })])).p;
        //  휴면90 묶음 = TREAT 4 + CTL 1 + ph1 + ph2 + cs_open = 8 (취소만·외부몰·first40 빠짐)
        assert.equal(p.matched, 8);
        assert.equal(p.treat, 4); assert.equal(p.control, 1); assert.equal(p.excluded, 3);
        assert.deepEqual(p.reasons, { shared_phone: 2, open_cs: 1 });
        assert.equal(p.sample.length, 4);
        assert.ok(p.sample.every(s => s.id_tail.length <= 3 && !('member_id' in s) && !('phone' in s)), '회원 ID·전화 통째로 안 나감');
        assert.equal(p.max_exposure, 40000);
    });

    await t.test('운영 시작 → 놓친 회차는 1개만 · 두 번 돌려도 1개(멱등) · 명단 고정', async () => {
        const nxt = (await one('boss', `select coupon_rule_set_status($1, 'active') v`, [ruleId])).v;
        assert.ok(new Date(nxt) > new Date(), '다음 실행은 미래');
        await forceDue(ruleId, 3 * 7 * 24 * 60);                 // 3주 전에 돌았어야 함
        assert.equal((await tick()).created, 1);
        assert.equal((await tick()).created, 0, '같은 시각 두 번 → 회차 1개');
        const runs = (await db.query(`select id, status, target_n, control_n, excluded_n, matched_n from coupon_runs where rule_id = $1`, [ruleId])).rows;
        assert.equal(runs.length, 1);
        run1 = runs[0].id;
        assert.deepEqual([runs[0].status, runs[0].target_n, runs[0].control_n, runs[0].excluded_n, runs[0].matched_n], ['awaiting_approval', 4, 1, 3, 8]);
        assert.ok(new Date((await db.query(`select next_run_at from coupon_rules where id = $1`, [ruleId])).rows[0].next_run_at) > new Date(), '밀린 주기를 몰아 만들지 않음');
        //  회차 뒤 TREAT[3] 가 오늘 주문 → 회차 명단은 그대로, 미리보기에선 빠진다
        await order(TREAT[3], 0);
        assert.equal((await members(run1)).filter(m => m.status === 'pending').length, 4);
        const p = (await one('staff', `select coupon_preview($1) p`, [JSON.stringify({ ...RULE, id: ruleId })])).p;
        assert.equal(p.treat, 3);
    });

    await t.test('승인: STAFF 막힘 · 인원 재입력 틀리면 막힘 · 승인해도 발급 아님', async () => {
        await denied('staff', `select coupon_run_approve($1, 4)`, [run1]);
        await assert.rejects(as('boss', `select coupon_run_approve($1, 5)`, [run1]), /인원 숫자가 다릅니다/);
        assert.equal((await one('boss', `select coupon_run_approve($1, 4) s`, [run1])).s, 'approved_for_export');
        assert.equal((await members(run1)).filter(m => m.status === 'issued').length, 0);
    });

    await t.test('CSV: 발송군 회원 ID만 · exported · 여전히 발급 0', async () => {
        await denied('staff', `select * from coupon_run_export($1)`, [run1]);
        const ids = (await as('boss', `select * from coupon_run_export($1)`, [run1])).rows.map(r => r.member_id);
        assert.deepEqual(ids, [...TREAT].sort());
        assert.ok(!ids.includes(CTL[0]) && !ids.includes('ph1') && !ids.includes('cs_open'));
        const r = await runRow(run1);
        assert.equal(r.status, 'exported'); assert.ok(r.exported_at);
        assert.equal((await members(run1)).filter(m => m.status === 'issued' || m.status === 'control_counted').length, 0);
    });

    await t.test('(반려1) 내보내기만 한 회차 → 다음 회차에 다시 대상 · 쿨다운 0 · 7일 뒤 export_expired/not_confirmed', async () => {
        await forceDue(ruleId, 60);
        assert.equal((await tick()).created, 1);
        run2 = (await db.query(`select id from coupon_runs where rule_id = $1 and id <> $2`, [ruleId, run1])).rows[0].id;
        const m2 = await members(run2);
        assert.equal(m2.filter(m => m.exclude_reason === 'cooldown').length, 0);
        assert.deepEqual(m2.filter(m => m.status === 'pending').map(m => m.member_id), TREAT.slice(0, 3).sort());
        assert.equal(m2.find(m => m.member_id === CTL[0]).status, 'control', '대조군도 안 걸림');
        //  7일 넘게 확인 안 함 → export_expired (규칙은 잠시 멈춰 회차가 더 안 생기게)
        await as('boss', `select coupon_rule_set_status($1, 'paused')`, [ruleId]);
        const r = await tick(24 * 8);
        assert.equal(r.export_expired, 1); assert.equal(r.created, 0, '일시중지 → 회차 안 생김');
        assert.equal((await runRow(run1)).status, 'export_expired');
        assert.equal((await members(run1)).filter(m => m.status === 'not_confirmed').length, 4);
        assert.equal((await runRow(run2)).status, 'expired', '승인 대기 48시간 → 만료');
    });

    await t.test('(반려1) 수동 확인: 증빙·건수 검사, 목록이면 그 회원만 issued, 나머지 manual_missing, 대조군 control_counted', async () => {
        const up = new Date().toISOString();
        const C = `select coupon_run_confirm_manual($1, $2, $3, $4, $5, $6) r`;
        await denied('staff', C, [run1, '직원', up, 4, 'x.png', null]);
        await assert.rejects(as('boss', C, [run1, '대표', up, 4, '', null]), /증빙/);
        await assert.rejects(as('boss', C, [run1, '대표', new Date(Date.now() + 3600e3).toISOString(), 4, 'e.png', null]), /미래/);
        await assert.rejects(as('boss', C, [run1, '대표', up, 3, 'e.png', null]), /CSV 인원\(4\)과 다릅니다/);
        const res = (await one('boss', C, [run1, '대표', up, 3, `coupon_evidence/${run1}/list.csv`, [TREAT[0], TREAT[1], TREAT[2], 'stranger']])).r;
        assert.deepEqual(res, { status: 'partial', issued: 3, failed: 1, unknown_ids: 1 });
        const m = await members(run1);
        assert.deepEqual(m.filter(x => x.status === 'issued').map(x => x.issue_path), ['manual_upload', 'manual_upload', 'manual_upload']);
        assert.ok(m.filter(x => x.status === 'issued').every(x => new Date(x.issued_at).toISOString() === up), 'issued_at = 입력한 업로드 시각');
        assert.equal(m.find(x => x.member_id === TREAT[3]).last_error, 'manual_missing');
        assert.equal(m.find(x => x.member_id === CTL[0]).status, 'control_counted');
        const a = (await db.query(`select detail from coupon_audit where run_id = $1 and action = 'manual_confirm'`, [run1])).rows[0].detail;
        for (const k of ['owner', 'uploaded_at', 'reported_n', 'csv_n', 'evidence']) assert.ok(a[k] != null, `감사에 ${k}`);
        assert.equal(a.after_expiry, true);
        await assert.rejects(as('boss', C, [run1, '대표', up, 3, 'e.png', null]), /CSV를 받은 회차만/);   // 두 번 확정 불가
    });

    await t.test('쿨다운: issued·control_counted 는 다음 회차에서 cooldown, manual_missing 은 다시 대상', async () => {
        await as('boss', `select coupon_rule_set_status($1, 'active')`, [ruleId]);
        await forceDue(ruleId, 30);
        assert.equal((await tick()).created, 1);
        const run3 = (await db.query(`select id from coupon_runs where rule_id = $1 order by created_at desc, scheduled_for desc limit 1`, [ruleId])).rows[0].id;
        const m = await members(run3);
        for (const id of TREAT.slice(0, 3)) assert.equal(m.find(x => x.member_id === id).exclude_reason, 'cooldown', id);
        assert.equal(m.find(x => x.member_id === CTL[0]).exclude_reason, 'cooldown', '대조군도 같은 쿨다운');
        assert.ok(!m.find(x => x.member_id === TREAT[3]), 'TREAT[3] 은 오늘 주문해서 휴면 아님');
        //  전원 확정 경로: 승인 → CSV → 건수 일치 확인 → done (발송군 0명이면 승인 인원 0)
        const r3 = await runRow(run3);
        await as('boss', `select coupon_run_approve($1, $2)`, [run3, r3.target_n]);
        await as('boss', `select * from coupon_run_export($1)`, [run3]);
        const res = (await one('boss', `select coupon_run_confirm_manual($1, '대표', now(), $2, 'e.png', null) r`, [run3, r3.target_n])).r;
        assert.equal(res.status, 'done');
    });

    await t.test('규칙 간 중복(other_rule) · 전역 간격(global_gap)', async () => {
        const save = async r => (await one('boss', `select coupon_rule_save($1) id`, [JSON.stringify({ ...RULE, ...r })])).id;
        const first = await save({ name: '첫구매30', target: { preset: 'first30' }, priority: 10 });
        await as('boss', `select coupon_rule_set_status($1, 'active')`, [first]);
        const direct = { ...RULE, name: '직접 30~89', target: { gone_min: 30, gone_max: 89 }, priority: 20, brand_id: B };
        const r = await db.query(`select member_id, exclude_reason from _coupon_targets($1, (now() at time zone 'Asia/Seoul')::date) where member_id = 'first40'`, [JSON.stringify(direct)]);
        assert.equal(r.rows[0].exclude_reason, 'other_rule');
        const r2 = await db.query(`select exclude_reason from _coupon_targets($1, (now() at time zone 'Asia/Seoul')::date) where member_id = 'first40'`, [JSON.stringify({ ...direct, priority: 5 })]);
        assert.equal(r2.rows[0].exclude_reason, null, '우선순위가 더 높으면 그 규칙에 들어간다');
        //  다른 규칙(휴면 직접 조건)에서도 최근 14일 안 issued 회원은 빠진다
        const dorm = { ...RULE, name: '직접 90+', target: { gone_min: 90 }, priority: 1, brand_id: B };
        const r3 = await db.query(`select exclude_reason from _coupon_targets($1, (now() at time zone 'Asia/Seoul')::date) where member_id = $2`, [JSON.stringify(dorm), TREAT[0]]);
        assert.equal(r3.rows[0].exclude_reason, 'global_gap');
    });

    await t.test('최대 인원 초과 → 확인 필요 · 승인 막힘 · 거절은 사유 필수', async () => {
        for (const m of await pick('n', false, 2)) await order(m, 60);
        const id = (await one('boss', `select coupon_rule_save($1) id`, [JSON.stringify({ ...RULE, name: '작은 회차', target: { gone_min: 30 }, max_targets: 1, priority: 1 })])).id;
        await as('boss', `select coupon_rule_set_status($1, 'active')`, [id]);
        await forceDue(id, 5);
        await tick();
        const run = (await db.query(`select id, status, target_n from coupon_runs where rule_id = $1`, [id])).rows[0];
        assert.equal(run.status, 'needs_review', `target_n=${run.target_n}`);
        await assert.rejects(as('boss', `select coupon_run_approve($1, 1)`, [run.id]), /최대 인원/);
        await assert.rejects(as('boss', `select coupon_run_reject($1, ' ')`, [run.id]), /사유/);
        assert.equal((await one('boss', `select coupon_run_reject($1, '대상 너무 많음') s`, [run.id])).s, 'rejected');
    });

    await t.test('대조군 안정: 1,000명 중 10% ±3%p, 같은 사람은 늘 같은 군', async () => {
        const r = await db.query(`select count(*) filter (where coupon_bucket('m' || g) < 10)::int c from generate_series(1, 1000) g`);
        assert.ok(r.rows[0].c >= 70 && r.rows[0].c <= 130, `대조군 ${r.rows[0].c}`);
        const a = await db.query(`select coupon_bucket('kim01') a, coupon_bucket('kim01') b`);
        assert.equal(a.rows[0].a, a.rows[0].b);
    });

    await t.test('감사·성과', async () => {
        const acts = (await db.query(`select action from coupon_audit where rule_id = $1 order by id`, [ruleId])).rows.map(r => r.action);
        for (const a of ['rule_create', 'rule_update', 'rule_active', 'run_create', 'run_approve', 'csv_download', 'export_expire', 'manual_confirm', 'rule_paused'])
            assert.ok(acts.includes(a), `감사에 ${a}`);
        //  run1 issued 회원이 확정 뒤 주문 → 복귀 1
        await order(TREAT[0], 0, { at: new Date(Date.now() + 60e3).toISOString() });
        const res = (await as('staff', `select * from coupon_run_results($1)`, [ruleId])).rows;
        const r1 = res.find(r => r.run_id === run1);
        assert.deepEqual([r1.issued_n, r1.treat_returned, r1.control_returned, r1.window_days], [3, 1, 0, 14]);
        await denied('partner', `select * from coupon_run_results($1)`, [ruleId]);
    });

    await t.test('되돌리기: 회차 기록이 있으면 거절(감사 보존)', async () => {
        await assert.rejects(db.exec(DOWN), /회차 기록이 있음/);
    });
    await db.close();
});

test('103 되돌리기(빈 상태) — 다 걷히고 다시 깔린다', { skip: !P && 'PGLITE_PATH 없음 — 건너뜀' }, async () => {
    const { PGlite } = await import(pathToFileURL(P).href);
    const db = new PGlite();
    await db.exec(STUB); await db.exec(SNAP); await db.exec(AFTER_SNAP);
    await db.exec(UP); await db.exec(DOWN);
    const left = await db.query(`select count(*)::int n from pg_proc where proname like '%coupon%'`);
    assert.equal(left.rows[0].n, 0);
    assert.equal((await db.query(`select to_regclass('public.coupon_runs') r`)).rows[0].r, null);
    await db.exec(UP);
    await db.close();
});
