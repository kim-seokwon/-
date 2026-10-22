//  092 도움말 센터 RLS 경계 — 진짜 Postgres(PGlite, WASM)에 092 를 그대로 깔고 역할을 바꿔 가며 확인한다.
//  PGlite 는 프로젝트 의존성이 아니다. 돌리려면: PGLITE_PATH=<@electric-sql/pglite 폴더>/dist/index.js npm test
//  없으면 이 파일은 건너뛴다(정적 검사는 help-center.test.mjs 가 한다).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SQL = readFileSync(new URL('../supabase/migrations/092_help_center.sql', import.meta.url), 'utf8');
const DOWN = readFileSync(new URL('../supabase/rollbacks/092_help_center.down.sql', import.meta.url), 'utf8');
const P = process.env.PGLITE_PATH;

//  Supabase 가 깔아 주는 것만 흉내: 역할 · auth.jwt() · storage 표 · storage.foldername · companies · current_username(038)
const STUB = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create schema storage;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema auth, storage, public to anon, authenticated, service_role;
grant execute on function auth.jwt() to anon, authenticated, service_role;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant execute on function storage.foldername(text) to authenticated;
create table public.companies (username text primary key, role text);
insert into public.companies values ('boss', 'MASTER'), ('kim', 'STAFF'), ('lee', 'STAFF'), ('client1', 'CLIENT');
create function public.current_username() returns text language sql stable set search_path = public as $$ select split_part(auth.jwt()->>'email','@',1) $$;
`;

test('092 RLS 경계(PGlite)', { skip: !P && 'PGLITE_PATH 없음 — 건너뜀' }, async t => {
    const { PGlite } = await import(pathToFileURL(P).href);
    const db = new PGlite();
    await db.exec(STUB);
    await db.exec(SQL);
    await db.exec(SQL);                                   // 두 번 깔아도 깨지지 않는다(재실행 안전)

    //  사람 바꾸기: 트랜잭션 없이 세션에 역할·JWT 를 건다
    const as = async (who, sql, params = []) => {
        await db.exec(`reset role; select set_config('request.jwt.claims', '${who ? JSON.stringify({ email: `${who}@bhas.com` }) : ''}', false);`);
        await db.exec(who ? 'set role authenticated' : 'set role anon');
        try { return (await db.query(sql, params)).rows; } finally { await db.exec('reset role'); }
    };
    const denied = async (p, re = /row-level security|permission denied/) => assert.rejects(p, re);

    await t.test('공지: 관리자만 쓰고, 직원은 게시된 것만 읽고, 익명·고객사는 못 읽는다', async () => {
        const [n] = await as('boss', `insert into notices (title, body, pinned) values ('점검 안내', '<b>내일</b>', true) returning id`);
        await as('boss', `insert into notices (title, published) values ('숨김 초안', false)`);
        await denied(as('kim', `insert into notices (title) values ('직원이 쓴 공지')`));
        assert.equal((await as('kim', `update notices set title = 'x' returning id`)).length, 0, '직원 수정은 0줄');
        assert.equal((await as('kim', `delete from notices returning id`)).length, 0, '직원 삭제는 0줄');
        assert.deepEqual((await as('kim', `select title from notices`)).map(r => r.title), ['점검 안내']);
        assert.equal((await as('boss', `select title from notices`)).length, 2, '관리자는 숨김글도');
        assert.equal((await as('client1', `select title from notices`)).length, 0, '고객사 계정은 못 봄');
        await denied(as(null, `select title from notices`), /permission denied/);
        assert.equal((await as('boss', `update notices set pinned = false where id = $1 returning id`, [n.id])).length, 1);
        await denied(as('boss', `insert into notices (title) values ('${'가'.repeat(101)}')`), /check constraint/);
    });

    await t.test('공지 읽음: 자기 것만 남기고 본다, 남의 이름으로 못 남긴다, 관리자는 전체를 본다', async () => {
        const [n] = await as('boss', `select id from notices where published limit 1`);
        await as('kim', `insert into notice_reads (notice_id) values ($1) on conflict do nothing`, [n.id]);
        await as('kim', `insert into notice_reads (notice_id) values ($1) on conflict do nothing`, [n.id]);   // 두 번 눌러도 한 줄
        await denied(as('kim', `insert into notice_reads (notice_id, username) values ($1, 'lee')`, [n.id]));
        assert.equal((await as('lee', `select * from notice_reads`)).length, 0, '이씨는 김씨 읽음을 못 봄');
        assert.equal((await as('kim', `select * from notice_reads`)).length, 1);
        assert.equal((await as('boss', `select * from notice_reads`)).length, 1);
        await denied(as('kim', `delete from notice_reads`), /permission denied/);
    });

    await t.test('불편접수: 직원은 자기 건만, 상태는 접수로만 시작, 관리자만 상태·메모를 고친다', async () => {
        const [r] = await as('kim', `insert into feedback_reports (screen, body, image_path) values ('홈', '버튼이 안 눌려요', 'kim/a.png') returning id, status, username`);
        assert.equal(r.status, '접수'); assert.equal(r.username, 'kim');
        await as('lee', `insert into feedback_reports (screen, body) values ('판매', '느려요')`);
        await denied(as('kim', `insert into feedback_reports (body, status) values ('바로 완료', '완료')`));
        await denied(as('kim', `insert into feedback_reports (body, username) values ('남 이름', 'lee')`));
        await denied(as('kim', `insert into feedback_reports (body, image_path) values ('남 폴더 사진', 'lee/x.png')`));
        await denied(as('client1', `insert into feedback_reports (body) values ('고객사')`));
        assert.deepEqual((await as('kim', `select body from feedback_reports`)).map(x => x.body), ['버튼이 안 눌려요']);
        assert.equal((await as('boss', `select * from feedback_reports`)).length, 2);
        assert.equal((await as('kim', `update feedback_reports set status = '완료' where id = $1 returning id`, [r.id])).length, 0, '직원 상태변경은 0줄');
        const up = await as('boss', `update feedback_reports set status = '처리중', admin_note = '확인 중' where id = $1 returning status`, [r.id]);
        assert.equal(up[0].status, '처리중');
        await denied(as('boss', `update feedback_reports set body = '관리자가 고친 본문' where id = $1`, [r.id]), /permission denied/);
        await denied(as('boss', `update feedback_reports set status = '보류' where id = $1`, [r.id]), /check constraint/);
        await denied(as('kim', `insert into feedback_reports (body) values ('   ')`), /check constraint/);
    });

    await t.test('첨부: private 버킷, 자기 이름 폴더에만 올리고, 본인·관리자만 연다, 덮어쓰기 없음, 접수에 붙은 첨부는 못 지운다', async () => {
        const [b] = await as('boss', `select 1`).then(() => db.query(`select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'feedback'`)).then(x => x.rows);
        assert.equal(b.public, false); assert.equal(Number(b.file_size_limit), 5242880);
        assert.ok(!b.allowed_mime_types.includes('image/svg+xml'), 'svg(스크립트 가능) 금지');
        await as('kim', `insert into storage.objects (bucket_id, name) values ('feedback', 'kim/1.png')`);
        await denied(as('kim', `insert into storage.objects (bucket_id, name) values ('feedback', 'lee/1.png')`));
        await denied(as('kim', `insert into storage.objects (bucket_id, name) values ('feedback', 'root.png')`));
        await denied(as('client1', `insert into storage.objects (bucket_id, name) values ('feedback', 'client1/1.png')`));
        assert.equal((await as('lee', `select name from storage.objects where bucket_id = 'feedback'`)).length, 0, '남의 첨부는 안 보임(signed URL 도 못 만든다)');
        assert.equal((await as('kim', `select name from storage.objects where bucket_id = 'feedback'`)).length, 1);
        assert.equal((await as('boss', `select name from storage.objects where bucket_id = 'feedback'`)).length, 1);
        assert.equal((await as('kim', `update storage.objects set name = 'kim/2.png' returning id`)).length, 0);
        await as('kim', `insert into feedback_reports (body, image_path) values ('사진 첨부', 'kim/1.png')`);
        assert.equal((await as('kim', `delete from storage.objects returning id`)).length, 0, '접수에 붙은 첨부는 올린 사람도 못 지움');
        // 접수 저장 실패 때 앱이 방금 올린(아직 안 붙은) 파일만 치운다
        await as('kim', `insert into storage.objects (bucket_id, name) values ('feedback', 'kim/2.png')`);
        assert.equal((await as('lee', `delete from storage.objects where name = 'kim/2.png' returning id`)).length, 0, '남의 파일은 못 지움');
        assert.equal((await as('boss', `delete from storage.objects where name = 'kim/2.png' returning id`)).length, 0, '관리자도 남의 폴더는 못 지움');
        assert.deepEqual((await as('kim', `delete from storage.objects returning name`)).map(x => x.name), ['kim/2.png'], '안 붙은 내 파일만 지워짐');
        await db.exec(`delete from feedback_reports where image_path = 'kim/1.png'`);
    });

    await t.test('되돌리기: 표가 걷히고 is_staff·is_master(087·091 도 씀)는 남는다', async () => {
        await db.exec(`delete from storage.objects where bucket_id = 'feedback'`);
        await db.exec(DOWN);
        const left = (await db.query(`select to_regclass('public.notices') n, to_regclass('public.feedback_reports') f,
            to_regprocedure('public.is_master()') m, to_regprocedure('public.is_staff()') s,
            (select count(*) from storage.buckets where id = 'feedback') b`)).rows[0];
        assert.deepEqual([left.n, left.f, Number(left.b)], [null, null, 0]);
        assert.ok(left.s && left.m, 'is_staff·is_master 남음');
        await db.exec(SQL);                               // 다시 깔 수 있다
    });
    await db.close();
});
