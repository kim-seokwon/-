//  작업지시서 파일 올리기 (10-23 사장님) — 파일 검사 · 093 깔기/되돌리기(PGlite) · 목록에 업로드 행이 뜨는지
//  PGlite 부분은 PGLITE_PATH 가 있을 때만 돈다(help-center-rls.test.mjs 와 같은 방식).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import * as TPF from '../techPackFile.js';

const { validateTpFile, tpFilePath, tpDefaultName, isUploadPack, hasPackConfig, tpKind, TP_FILE_MAX, TP_MIMES } = TPF;
const src = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const SQL = fs.readFileSync(new URL('../supabase/migrations/093_tech_pack_upload.sql', import.meta.url), 'utf8');
const DOWN = fs.readFileSync(new URL('../supabase/rollbacks/093_tech_pack_upload.down.sql', import.meta.url), 'utf8');
const method = (name) => {
    const m = new RegExp(`\\n    (async )?${name}\\(`).exec(src); assert.ok(m, `${name} 를 main.js 에서 못 찾음`);
    const a = m.index + 1, b = src.indexOf('\n    }\n', a) + 6;
    return eval('(' + src.slice(a, b).trim().replace(new RegExp(`^(async )?${name}\\(`), (_, as) => `${as || ''}function ${name}(`) + ')');
};

test('파일 검사 — 종류 · 크기 · 한글 이름 · 경로는 uuid 만', () => {
    assert.equal(validateTpFile({ name: '셔츠 작업지시서.PDF', size: 1000 }).mime, 'application/pdf');
    assert.equal(validateTpFile({ name: '사양표.hwp', size: 10, type: '' }).mime, 'application/x-hwp', '브라우저 type 이 비어도 확장자로');
    for (const n of ['a.jpg', 'a.jpeg', 'a.png', 'a.webp', 'a.xlsx', 'a.xls']) assert.ok(validateTpFile({ name: n, size: 1 }).ok, n);
    assert.equal(validateTpFile({ name: 'a.zip', size: 1 }).ok, false);
    assert.equal(validateTpFile({ name: 'a.exe.pdf.exe', size: 1 }).ok, false);
    assert.equal(validateTpFile({ name: 'a.pdf', size: 0 }).ok, false);
    assert.equal(validateTpFile({ name: 'a.pdf', size: TP_FILE_MAX }).ok, true);
    assert.match(validateTpFile({ name: 'a.pdf', size: TP_FILE_MAX + 1 }).error, /20MB/);
    assert.equal(validateTpFile(null).ok, false);
    const u = '0f8fad5b-d9cb-469f-a165-70867728950e';
    assert.equal(tpFilePath(u, 'pdf'), `${u}.pdf`);
    assert.equal(tpFilePath('../x', 'pdf'), null); assert.equal(tpFilePath(u, 'exe'), null);
    //  맥이 주는 NFD 이름도 NFC 로 저장된다
    assert.equal(tpDefaultName('셔츠 지시서.pdf'.normalize('NFD')), '셔츠 지시서');
    assert.equal(isUploadPack({ source: 'upload' }), true);
    assert.equal(hasPackConfig({ source: 'upload', config: { a: 1 } }), false, '업로드는 도식화 없음');
    assert.equal(hasPackConfig({ source: 'made', config: {} }), false);
    assert.equal(hasPackConfig({ config: { styleName: 'x' } }), true, '093 전 행(source 없음)은 제작');
    assert.equal(tpKind({ file_name: 'a.XLS' }), 'sheet');
});

test('093 버킷 종류·크기가 화면 검사값과 같다', () => {
    for (const m of TP_MIMES) assert.ok(SQL.includes(`'${m}'`), m);
    assert.ok(SQL.includes(String(TP_FILE_MAX)));
    assert.doesNotMatch(SQL, /'bhas'/, '공개 bhas 버킷은 안 쓴다');
    assert.match(src, /createSignedUrl\(t\.file_path, 600/);
    assert.doesNotMatch(src, /getPublicUrl\([^)]*file_path/);
});

test('작업지시서 목록에 업로드 행이 [업로드] 배지로 뜬다', () => {
    Object.assign(globalThis, TPF, { garmentPreviewSVG: () => '<svg data-made></svg>' });
    const t = {
        _techPacksLoaded: true, tpSel: 'u1', pItems: [{ id: 'i1', name: '옥스포드 셔츠', tech_pack_id: 'u1' }],
        _techPacks: [
            { id: 'm1', style_name: '린넨 셔츠', style_no: 'HH-1', config: { styleName: '린넨' }, source: 'made' },
            { id: 'u1', style_name: '공장 지시서 <원본>', config: {}, source: 'upload', file_name: '공장 지시서.pdf', file_path: 'x.pdf', file_size: 10 },
        ],
        _vesc: s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
        _mpTop: (title, sub, right) => `<h1>${title}</h1><p>${sub}</p>${right}`, _loadingSkeleton: () => '',
    };
    const html = method('renderTechPacks').call(t);
    assert.match(html, /제작 1 · 업로드 1/);
    assert.match(html, /app\.showTechPackUpload\(\)/);
    assert.match(html, /<b class="tp-src up">업로드<\/b>/);
    assert.match(html, /<b class="tp-src mk">제작<\/b>/);
    assert.match(html, /ph-file-pdf/);
    assert.equal((html.match(/data-made/g) || []).length, 1, '업로드 행은 도식화를 안 그린다');
    assert.match(html, /공장 지시서 &lt;원본&gt;/, '이름은 이스케이프');
    assert.doesNotMatch(html, /<원본>/);
});

test('업로드 지시서도 검색·자료실·출고검수·생산 물품 고르기에 닿는다', () => {
    assert.match(src, /isUploadPack\(t\) \? '업로드' : ''/, '검색');
    assert.match(src, /작업지시서\(업로드\)/, '자료실');
    assert.match(src, /hasPackConfig\(pack\) \? this\._qcFromConfig/, '출고검수는 업로드면 기본 항목');
    assert.ok((src.match(/isUploadPack\(t\) \? ' · 업로드' : ''/g) || []).length >= 2, '생산 물품·검수 지시서 고르기');
    assert.match(src, /openTechPack\(id\) \{\n[^\n]*\n[^\n]*isUploadPack/, '열기는 파일로');
});

//  반려1-3·4·5 — 올리기 실패/정리 실패/제품 연결 실패
const mkUp = ({ insert, remove, setItem } = {}) => {
    const els = {
        'tpu-file': { files: [{ name: '공장 지시서.pdf', size: 1234 }] }, 'tpu-err': { textContent: '' }, 'tpu-save': { disabled: false, textContent: '올리기' },
        'tpu-name': { value: '' }, 'tpu-no': { value: '' }, 'tpu-brand': { value: '' }, 'tpu-item': { value: 'i1' },
    };
    globalThis.document = { getElementById: id => els[id] || null };
    Object.assign(globalThis, TPF);
    const log = { removed: [], toasts: [], warns: [], linked: [], closed: 0 };
    const t = {
        els, log, _vesc: s => String(s),
        supabase: {
            storage: { from: () => ({ upload: async () => ({ error: null }),
                remove: async paths => { log.removed.push(...paths); return remove ? remove() : { error: null }; } }) },
            from: () => ({ insert: () => ({ select: () => ({ single: async () => (insert ? insert() : { data: { id: 'new1' }, error: null }) }) }) }),
        },
        showToast(m) { log.toasts.push(m); }, closeGlobalModal() { log.closed++; }, async ensureTechPacks() {},
        async setItem(...a) { log.linked.push(a); return setItem ? setItem() : true; },
    };
    t._tpDropFile = method('_tpDropFile');
    t.uploadTechPack = method('uploadTechPack');
    return t;
};
const quiet = async fn => { const w = console.warn; const out = []; console.warn = (...a) => out.push(a.join(' ')); try { await fn(); } finally { console.warn = w; } return out; };

test('반려1-3: DB 저장이 예외로 터져도, 에러로 와도 올린 파일은 지운다', async () => {
    for (const insert of [() => { throw new Error('네트워크 끊김'); }, () => ({ data: null, error: { message: 'check 위반' } }), () => ({ data: null, error: null })]) {
        const t = mkUp({ insert });
        await t.uploadTechPack();
        assert.equal(t.log.removed.length, 1, '파일 회수');
        assert.match(t.log.removed[0], /^[0-9a-f-]{36}\.pdf$/);
        assert.match(t.els['tpu-err'].textContent, /올리기 실패/);
        assert.equal(t.log.closed, 0, '창은 그대로');
        assert.equal(t.els['tpu-save'].disabled, false, '다시 누를 수 있다');
    }
    const ok = mkUp();
    await ok.uploadTechPack();
    assert.equal(ok.log.removed.length, 0, '성공하면 안 지운다');
    assert.match(ok.log.toasts.at(-1), /작업지시서를 올렸습니다/);
});

test('반려1-4: 파일 정리 실패는 토스트로 알리고 콘솔에 경로를 남긴다', async () => {
    const t = mkUp({ insert: () => ({ data: null, error: { message: 'x' } }), remove: () => ({ error: { message: '권한 없음' } }) });
    const warns = await quiet(() => t.uploadTechPack());
    const path = t.log.removed[0];
    assert.ok(t.log.toasts.some(m => m.includes('정리에 실패') && m.includes(path)), '토스트에 경로');
    assert.ok(warns.some(w => w.includes(`tech_pack_files/${path}`)), '콘솔에 경로');
    const t2 = mkUp({ remove: async () => { throw new Error('끊김'); } });
    assert.equal(await quiet(() => t2._tpDropFile('a.pdf')).then(() => t2.log.toasts.length), 1, '예외로 터져도 알림');
});

test('반려1-5: 제품 연결 저장이 실패하면 성공 토스트 대신 부분 실패를 알린다', async () => {
    const t = mkUp({ setItem: () => false });
    await t.uploadTechPack();
    assert.deepEqual(t.log.linked[0].slice(0, 3), ['i1', 'tech_pack_id', 'new1']);
    assert.equal(t.log.removed.length, 0, '지시서는 남긴다');
    assert.match(t.log.toasts.at(-1), /지시서는 올렸고 제품 연결은 실패/);
    assert.doesNotMatch(t.log.toasts.at(-1), /^작업지시서를 올렸습니다/);
    //  setItem 은 성공 true / 실패 false 를 돌려준다
    const si = method('setItem');
    const fake = err => ({ pItems: [{ id: 'i1' }], _seasons: () => [], showToast() {}, requestRender() {},
        supabase: { from: () => ({ update: () => ({ eq: async () => ({ error: err }) }) }) } });
    assert.equal(await si.call(fake(null), 'i1', 'tech_pack_id', 'x'), true);
    assert.equal(await si.call(fake({ message: 'RLS' }), 'i1', 'tech_pack_id', 'x'), false);
    assert.equal(await si.call(fake(null), 'nope', 'tech_pack_id', 'x'), false);
});

test('반려2: setItem 요청이 예외(reject)로 터져도 false·실패 토스트·값 되돌림', async () => {
    const si = method('setItem');
    const toasts = [];
    const o = { pItems: [{ id: 'i1', tech_pack_id: 'old' }], _seasons: () => [], showToast: m => toasts.push(m), requestRender() {},
        supabase: { from: () => ({ update: () => ({ eq: () => Promise.reject(new Error('Failed to fetch')) }) }) } };
    assert.equal(await si.call(o, 'i1', 'tech_pack_id', 'new1'), false);
    assert.equal(o.pItems[0].tech_pack_id, 'old', '값 되돌림');
    assert.match(toasts.at(-1), /저장 실패: Failed to fetch/);
});

test('093 깔기 두 번 · RLS · 되돌리기(PGlite)', { skip: !process.env.PGLITE_PATH && 'PGLITE_PATH 없음 — 건너뜀' }, async t => {
    const { PGlite } = await import(pathToFileURL(process.env.PGLITE_PATH).href);
    const db = new PGlite();
    await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create schema storage;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema auth, storage, public to anon, authenticated, service_role;
grant execute on function auth.jwt() to anon, authenticated, service_role;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated;
create table public.companies (username text primary key, role text);
insert into public.companies values ('boss', 'MASTER'), ('kim', 'STAFF'), ('client1', 'CLIENT');
create function public.get_user_role() returns text language sql stable security definer set search_path = public as $$ select role from companies where username = split_part(auth.jwt()->>'email', '@', 1) limit 1 $$;
grant execute on function public.get_user_role() to authenticated;
create table public.brands (id uuid primary key default gen_random_uuid(), name text);
create table public.vendor_jobs (id uuid primary key default gen_random_uuid());
`);
    const T013 = fs.readFileSync(new URL('../supabase/migrations/013_tech_packs.sql', import.meta.url), 'utf8');
    await db.exec(T013);
    await db.exec(`alter table tech_packs add column if not exists item_id uuid; grant all on tech_packs to authenticated; grant select on tech_packs to anon;
        insert into tech_packs (style_name, config) values ('옛 지시서', '{"styleName":"x"}');`);
    await db.exec(SQL);
    await db.exec(SQL);                                   // 두 번 깔아도 깨지지 않는다
    const q = async (sql, p = []) => (await db.query(sql, p)).rows;
    const as = async (who, sql, params = []) => {
        await db.exec(`reset role; select set_config('request.jwt.claims', '${who ? JSON.stringify({ email: `${who}@bhas.com` }) : ''}', false);`);
        await db.exec(who ? 'set role authenticated' : 'set role anon');
        try { return (await db.query(sql, params)).rows; } finally { await db.exec('reset role'); }
    };

    await t.test('기존 행은 제작, 업로드 행은 파일 칸 필수 · 한글 이름 그대로', async () => {
        assert.deepEqual(await q(`select source from tech_packs`), [{ source: 'made' }]);
        const [b] = await q(`insert into brands (name) values ('하이헤이호') returning id`);
        await q(`insert into tech_packs (style_name, config, source, file_path, file_name, file_type, file_size, brand_id)
                 values ('공장', '{}', 'upload', 'a.pdf', '공장 지시서.pdf', 'application/pdf', 100, $1)`, [b.id]);
        assert.equal((await q(`select file_name from tech_packs where source='upload'`))[0].file_name, '공장 지시서.pdf');
        await assert.rejects(q(`insert into tech_packs (style_name, config, source) values ('x', '{}', 'upload')`), /check constraint/);
        await assert.rejects(q(`insert into tech_packs (style_name, config, source, file_path, file_name, file_size) values ('x', '{}', 'upload', 'b.pdf', 'b.pdf', 20971521)`), /check constraint/);
        await assert.rejects(q(`insert into tech_packs (style_name, config, source, file_path, file_name, file_size) values ('x', '{}', 'upload', 'a.pdf', 'c.pdf', 5)`), /unique|duplicate/);
        await assert.rejects(q(`insert into tech_packs (style_name, config, source) values ('x', '{}', 'weird')`), /check constraint/);
        await q(`delete from brands`);
        assert.equal((await q(`select brand_id from tech_packs where source='upload'`))[0].brand_id, null, '브랜드 지우면 칸만 비움');
    });

    await t.test('버킷은 비공개 · 직원만 읽고/올리고/지운다 · 덮어쓰기 없음', async () => {
        const [bk] = await q(`select public, file_size_limit from storage.buckets where id = 'tech_pack_files'`);
        assert.equal(bk.public, false); assert.equal(Number(bk.file_size_limit), 20971520);
        await as('kim', `insert into storage.objects (bucket_id, name) values ('tech_pack_files', 'k.pdf')`);
        await as('boss', `insert into storage.objects (bucket_id, name) values ('tech_pack_files', 'b.pdf')`);
        await assert.rejects(as('client1', `insert into storage.objects (bucket_id, name) values ('tech_pack_files', 'c.pdf')`), /row-level security/);
        assert.equal((await as('kim', `select name from storage.objects where bucket_id = 'tech_pack_files'`)).length, 2);
        assert.equal((await as('client1', `select name from storage.objects`)).length, 0, '고객사는 못 봄');
        await assert.rejects(as(null, `select name from storage.objects`), /permission denied/);
        assert.equal((await as('kim', `update storage.objects set name = 'z.pdf' returning id`)).length, 0, '덮어쓰기 0줄');
        assert.equal((await as('client1', `delete from storage.objects returning id`)).length, 0);
        assert.equal((await as('kim', `delete from storage.objects where name = 'k.pdf' returning id`)).length, 1);
    });

    await t.test('반려1-2: tech_packs 표는 직원만 — 고객사 계정은 업로드 메타를 못 읽고 못 고친다', async () => {
        assert.deepEqual((await q(`select policyname from pg_policies where tablename = 'tech_packs' order by 1`)).map(r => r.policyname), ['tech_packs_staff'], '013 tech_packs_all 은 걷힌다');
        assert.ok((await as('kim', `select id from tech_packs`)).length >= 1, '직원은 읽는다');
        await as('kim', `insert into tech_packs (style_name, config) values ('직원 새 지시서', '{"a":1}')`);
        assert.equal((await as('boss', `update tech_packs set style_no = 'B-1' where style_name = '직원 새 지시서' returning id`)).length, 1);
        assert.equal((await as('client1', `select id from tech_packs`)).length, 0, '고객사는 0줄');
        assert.equal((await as('client1', `update tech_packs set style_name = 'x' returning id`)).length, 0, '고객사 수정 0줄');
        assert.equal((await as('client1', `delete from tech_packs returning id`)).length, 0, '고객사 삭제 0줄');
        await assert.rejects(as('client1', `insert into tech_packs (style_name, config) values ('고객', '{}')`), /row-level security/);
        assert.equal((await as(null, `select id from tech_packs`)).length, 0, '익명 0줄');
        await as('kim', `delete from tech_packs where style_name = '직원 새 지시서'`);
    });

    await t.test('되돌리기 — 버킷 비운 뒤 칸·정책·업로드 행이 걷히고 제작 행은 남는다', async () => {
        await q(`delete from storage.objects where bucket_id = 'tech_pack_files'`);
        await db.exec(DOWN);
        assert.deepEqual(await q(`select style_name from tech_packs`), [{ style_name: '옛 지시서' }]);
        assert.equal((await q(`select 1 from information_schema.columns where table_name = 'tech_packs' and column_name in ('source','file_path','file_name','file_type','file_size','brand_id')`)).length, 0);
        assert.equal((await q(`select 1 from storage.buckets where id = 'tech_pack_files'`)).length, 0);
        assert.equal((await q(`select 1 from pg_policies where policyname like 'tech_pack_files%'`)).length, 0);
        assert.deepEqual((await q(`select policyname from pg_policies where tablename = 'tech_packs' order by 1`)).map(r => r.policyname), ['tech_packs_select', 'tech_packs_write'], '026 모양으로 — tech_packs_all 은 안 살린다');
        assert.equal((await as('client1', `select id from tech_packs`)).length, 0, '되돌린 뒤에도 고객사 0줄');
        assert.equal((await as('kim', `select id from tech_packs`)).length, 1, '직원은 그대로');
        await db.exec(SQL);                               // 다시 깔 수 있다
        assert.equal((await q(`select source from tech_packs`))[0].source, 'made');
    });
});
