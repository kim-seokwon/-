//  연락처 재구성 (11-17 사장님) — 칸 규칙 · 109 깔기/건수 대조/되돌리기(PGlite) · 3단 화면(표·요약·상세)
//  PGlite 부분은 PGLITE_PATH 가 있을 때만 돈다(tech-pack-upload.test.mjs 와 같은 방식).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import * as VC from '../vendorContact.js';

const { isMobileNumber, phonesOf, callNumberOf, telHref, validateBizFile, bizFilePath, bizFileKind, contactSummary, VF_FILE_MAX, VF_MIMES } = VC;
const src = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const SQL = fs.readFileSync(new URL('../supabase/migrations/109_vendor_fields.sql', import.meta.url), 'utf8');
const DOWN = fs.readFileSync(new URL('../supabase/rollbacks/109_vendor_fields.down.sql', import.meta.url), 'utf8');
const DRY = fs.readFileSync(new URL('../supabase/rehearsals/109_vendor_fields_dryrun.sql', import.meta.url), 'utf8');
const method = (name) => {
    const m = new RegExp(`\\n    (async )?${name}\\(`).exec(src); assert.ok(m, `${name} 를 main.js 에서 못 찾음`);
    const a = m.index + 1, b = src.indexOf('\n    }\n', a) + 6;
    return eval('(' + src.slice(a, b).trim().replace(new RegExp(`^(async )?${name}\\(`), (_, as) => `${as || ''}function ${name}(`) + ')');
};
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const U1 = '0f8fad5b-d9cb-469f-a165-70867728950e', U2 = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

test('휴대폰 판정 — 109 SQL 과 같은 식', () => {
    for (const n of ['010-1234-5678', '01012345678', '011-123-4567', '+82 10-1234-5678', '82-10-1234-5678', '019 123 4567']) assert.ok(isMobileNumber(n), n);
    for (const n of ['02-123-4567', '031-123-4567', '1588-1234', '010-1234-5678 / 02-123-4567', '010-123', '', null]) assert.equal(isMobileNumber(n), false, String(n));
    //  SQL 식이 화면 식과 글자까지 같다
    for (const re of ['^01[016789][0-9]{7,8}$', '^821[016789][0-9]{7,8}$']) {
        assert.ok(SQL.includes(`'${re}'`) && DRY.includes(`'${re}'`), re);
        assert.ok(String(isMobileNumber).includes(re.replace(/\$$/, '$')), re);
    }
});

test('109 전 행도 같은 모양으로 — phone 이 휴대폰이면 휴대폰 칸', () => {
    assert.deepEqual(phonesOf({ phone: '010-1111-2222' }), { mobile: '010-1111-2222', phone: '' }, '109 전(mobile 키 없음)');
    assert.deepEqual(phonesOf({ phone: '010-1111-2222', mobile: null }), { mobile: '', phone: '010-1111-2222' }, '109 뒤엔 손댄 값 그대로');
    assert.deepEqual(phonesOf({ phone: '02-1', mobile: '010-1' }), { mobile: '010-1', phone: '02-1' });
    assert.deepEqual(phonesOf(null), { mobile: '', phone: '' });
    assert.equal(callNumberOf({ phone: '02-1', mobile: '010-9' }), '010-9', '휴대폰 먼저');
    assert.equal(callNumberOf({ phone: '02-1', mobile: '' }), '02-1');
    assert.equal(telHref('+82 10-1234-5678'), 'tel:+821012345678');
});

test('등록증 파일 검사 · 경로는 uuid 만 · 버킷 값과 같다', () => {
    assert.equal(validateBizFile({ name: '사업자등록증.PDF', size: 10 }).kind, 'pdf');
    assert.equal(validateBizFile({ name: '등록증.jpeg', size: 10 }).mime, 'image/jpeg');
    assert.equal(validateBizFile({ name: 'a.hwp', size: 10 }).ok, false);
    assert.equal(validateBizFile({ name: 'a.pdf', size: 0 }).ok, false);
    assert.equal(validateBizFile({ name: 'a.pdf', size: VF_FILE_MAX }).ok, true);
    assert.match(validateBizFile({ name: 'a.pdf', size: VF_FILE_MAX + 1 }).error, /10MB/);
    assert.equal(validateBizFile(null).ok, false);
    assert.equal(bizFilePath(U1, U2, 'pdf'), `${U1}/${U2}.pdf`);
    assert.equal(bizFilePath('../x', U2, 'pdf'), null);
    assert.equal(bizFilePath(U1, U2, 'exe'), null);
    assert.equal(bizFileKind({ biz_file_name: '등록증.PNG' }), 'image');
    assert.equal(bizFileKind({ biz_file_path: `${U1}/${U2}.pdf` }), 'pdf');
    for (const m of VF_MIMES) assert.ok(SQL.includes(`'${m}'`), m);
    assert.ok(SQL.includes(String(VF_FILE_MAX)));
    assert.match(SQL, /'vendor_files', 'vendor_files', false/, 'private');
    assert.doesNotMatch(src, /getPublicUrl\([^)]*biz_file/);
});

test('요약 — 상태 · 구분 · 빈 칸 · 최근', () => {
    const s = contactSummary([
        { name: 'a', status: '거래중', category: '봉제', mobile: '010', email: 'a@x', contact_name: '김', biz_file_path: 'p', updated_at: '2026-11-10' },
        { name: 'b', status: '보류', category: '원단', phone: '010-1111-2222', updated_at: '2026-11-15' },
        { name: 'c', category: '원단', mobile: '', phone: '02-1' },
    ], [{ name: '원단' }, { name: '봉제' }]);
    assert.equal(s.total, 3);
    assert.deepEqual(s.status, { '거래중': 2, '보류': 1, '거래중단': 0 });
    assert.deepEqual(s.catRows, [['원단', 2], ['봉제', 1]], '구분 순서대로');
    assert.deepEqual(s.missing, { mobile: 1, email: 2, contact: 2, bizFile: 2 }, 'b 는 109 전 휴대폰으로 친다');
    assert.deepEqual(s.recent.map(v => v.name), ['b', 'a']);
});

//  화면 — renderContacts 를 그대로 떼어 돌린다
const ctx = (over = {}) => {
    Object.assign(globalThis, VC);
    const t = {
        _vendorsLoaded: true, contactCat: '전체', contactStatus: '전체', contactQ: '', tblFilt: {}, tblSort: {},
        vendors: [
            { id: U1, name: '성수봉제 <본점>', category: '봉제', status: '거래중', contact_name: '김미영', mobile: '010-1234-5678', phone: '02-123-4567', fax: '02-123-4568',
              email: 'ss@x.kr', address: '서울 성동구', biz_no: '123-45-67890', ceo_name: '김대표', memo: '월말 정산', biz_file_path: `${U1}/${U2}.pdf`, biz_file_name: '등록증.pdf', updated_at: '2026-11-16' },
            { id: U2, name: '동대문 원단', category: '원단', status: '보류', contact_name: '박지현', mobile: null, phone: '010-2222-3333', email: '' },
        ],
        _vesc: esc, _loadingSkeleton: () => 'LOADING',
        _vendorCategories: () => [{ name: '봉제', color: '#f00' }, { name: '원단', color: '#0f0' }],
        _thead: (view, cols) => cols.map(([k, l]) => `<th data-k="${k}">${l}</th>`).join(''),
        _applyTbl: (view, rows) => rows, _fltBadge: () => '', _connectedHTML: () => '<div data-conn></div>',
        _c3Fold: (c, o, l) => `<button class="c3-fold">${l}</button>`,
        _bizUrl: { [`${U1}/${U2}.pdf`]: { url: 'https://signed.example/x?token=t', at: Date.now() } },
        _loadBizUrl() { this.loaded = true; },
        ...over,
    };
    for (const n of ['_contactDocHTML', '_bizFileHTML', '_contactCols']) t[n] = method(n);
    return t;
};
const render = t => method('renderContacts').call(t);

test('가운데 표 — 업체명·구분·상태·담당자·휴대폰·전화·이메일(구분·상태는 독립 열), 오른쪽은 안 고르면 연락처를 선택하세요(메모처럼, 요약 카드 없음 — 팀장 반려 11-18)', () => {
    const t = ctx(); const html = render(t);
    assert.deepEqual([...html.matchAll(/<th data-k="(\w+)">/g)].map(m => m[1]), ['name', 'cat', 'status', 'contact', 'mobile', 'phone', 'email', 'address']);   // ⑤ 기본 8열(주소 추가), 팩스·등록증·메모는 열 표시로
    assert.doesNotMatch(html, /ct3-name"[^>]*>[^<]*<em>/, '구분을 업체명 옆 작은 글씨로 붙이지 않는다');
    assert.match(html, /<td class="ck-cat ct3-cat">[^<]+<\/td>/, '구분 열');
    // 390 핵심 3열 CSS 가 열 이름으로 고른다 — 모든 칸에 ck-<열> 이 붙어야 한다(열 끄기로 순서가 바뀌어도 맞게)
    for (const k of ['name', 'cat', 'status', 'contact', 'mobile', 'phone', 'email', 'address']) assert.match(html, new RegExp(`<td class="ck-${k}[ "]`), k + ' 칸 열 이름');
    assert.match(html, /<td class="ck-status ct3-st"><span class="ct3-badge"[^>]*>거래중<\/span><\/td>/, '상태 열 — 거래중도 보인다');
    assert.match(html, /colspan="7"|<td class="ck-phone nw ct3-tel">/, '전화 열');
    assert.match(html, /class="m3 ct3"/, '고른 게 없으면 detail 아님');
    assert.match(html, /연락처를 선택하세요/, '미선택 = 안내 문구');
    assert.doesNotMatch(html, /ct3-sum|ct3-stats/, '요약 카드 없음');
    assert.match(html, /성수봉제 &lt;본점&gt;/); assert.doesNotMatch(html, /<본점>/);
    assert.match(html, /<td class="ck-mobile nw">010-1234-5678<\/td>/);
    assert.match(html, /app\.selectContact\('/);
    assert.doesNotMatch(html, /사업자등록증/, '안 고르면 상세 없음');
});

test('고르면 전부 — 휴대폰·전화·팩스·이메일·주소·등록증(미리보기·내려받기)·메모', () => {
    const t = ctx({ contactSel: U1 }); const html = render(t);
    assert.match(html, /class="m3 ct3 detail"/);
    for (const k of ['담당자', '휴대폰', '전화', '팩스', '이메일', '주소', '등록번호', '대표자', '메모']) assert.match(html, new RegExp(`>${k}<`), k);
    assert.match(html, /href="tel:01012345678"/);
    assert.match(html, /<iframe src="https:\/\/signed\.example\/x\?token=t"/, 'PDF 미리보기');
    assert.match(html, /openBizFile\('[^']+',1\)/, '내려받기');
    assert.match(html, /크게 보기/);
    assert.match(html, /ct3-back/, '휴대폰 화면 되돌아가기');
    assert.equal(t.loaded, undefined, '서명 주소가 살아 있으면 다시 안 받는다');
    const old = ctx({ contactSel: U1 }); old._bizUrl[`${U1}/${U2}.pdf`].at = Date.now() - 9 * 60e3;
    render(old); assert.equal(old.loaded, true, '8분 지나면 새로 받는다');
});

test('고치기 — 휴대폰·전화 따로, 109 전 행은 휴대폰 칸으로 옮겨 보인다, 파일 칸', () => {
    const t = ctx({ contactSel: U2, contactEdit: true }); const html = render(t);
    for (const id of ['vd-name', 'vd-contact', 'vd-mobile', 'vd-phone', 'vd-fax', 'vd-email', 'vd-addr', 'vd-biz', 'vd-ceo', 'vd-bizfile', 'vd-memo']) assert.match(html, new RegExp(`id="${id}"`), id);
    assert.match(html, /id="vd-mobile" type="tel" class="nw-f" value=""/, '109 뒤 mobile null 은 그대로 빈 칸');
    const pre = ctx({ contactSel: 'p', contactEdit: true, vendors: [{ id: 'p', name: 'x', phone: '010-9999-8888' }] });
    assert.match(render(pre), /id="vd-mobile" type="tel" class="nw-f" value="010-9999-8888"/, '109 전');
    assert.match(render(pre), /id="vd-phone" type="tel" class="nw-f" value=""/);
    assert.match(html, /accept="\.pdf,\.jpg,\.jpeg,\.png,\.webp"/);
});

test('3단 규칙 — 왼쪽은 구분 목록(협업 메뉴 아님), 거래중단은 종료 접기', () => {
    const html = render(ctx({ vendors: [...ctx().vendors, { id: 'z', name: '끊긴 업체', category: '봉제', status: '거래중단' }] }));
    assert.doesNotMatch(html, /c3-menu|협업 메뉴|data-menu=/);
    assert.match(html, /<aside class="m3-side">[\s\S]*?구분[\s\S]*?모든 연락처[\s\S]*?구분을 우클릭해 관리/);
    assert.doesNotMatch(html, /ct3-tabs/);
    assert.match(html, /종료\(거래중단\) 1곳/); assert.doesNotMatch(html, /끊긴 업체/, '접혀 있으면 안 보인다');
    assert.match(render(ctx({ contactShowDone: true, vendors: [{ id: 'z', name: '끊긴 업체', status: '거래중단' }] })), /끊긴 업체/);
    assert.match(render(ctx({ contactStatus: '거래중단', vendors: [{ id: 'z', name: '끊긴 업체', status: '거래중단' }] })), /끊긴 업체/, '상태를 고르면 그대로 보인다');
});

test('구분·상태·검색 거르기 — 검색은 휴대폰도 찾는다', () => {
    assert.match(render(ctx({ contactCat: '원단' })), /원단<\/b><span>1곳 \/ 전체 2/);
    assert.match(render(ctx({ contactStatus: '보류' })), /1곳 \/ 전체 2/);
    const h = render(ctx({ contactQ: '1234-5678' }));
    assert.match(h, /성수봉제/); assert.doesNotMatch(h, /동대문 원단<\/span>/);
    assert.match(render(ctx({ contactQ: '없는말' })), /찾는 연락처가 없습니다/);
});

//  저장 — 휴대폰 칸 · 109 전 폴백 · 등록증 올리기/실패 정리
const mkSave = ({ failMobile, uploadErr, updateErr, file } = {}) => {
    const calls = [];
    const els = { 'vd-name': { value: '새 업체' }, 'vd-mobile': { value: '010-1111-2222' }, 'vd-phone': { value: '02-111' },
        'vd-bizfile': { files: file ? [file] : [] } };
    globalThis.document = { getElementById: id => els[id] || null };
    const q = (table) => {
        const b = { _op: null, _row: null,
            insert(r) { this._op = 'insert'; this._row = r[0]; return this; }, update(r) { this._op = 'update'; this._row = r; return this; },
            eq() { return this; }, select() { return this; },
            async single() { calls.push([table, this._op, this._row]);
                if (failMobile && 'mobile' in this._row) return { error: { message: 'column "mobile" of relation "vendors" does not exist' } };
                return { data: { id: U1 } }; },
            then(res, rej) { calls.push([table, this._op, this._row]); return Promise.resolve(updateErr && 'biz_file_path' in this._row ? { error: { message: 'boom' } } : {}).then(res, rej); },
        };
        return b;
    };
    const t = Object.assign(ctx({ vendors: [] }), {
        supabase: { from: q, storage: { from: () => ({
            upload: async (p) => { calls.push(['up', p]); return uploadErr ? { error: { message: 'denied' } } : {}; },
            remove: async (ps) => { calls.push(['rm', ps[0]]); return {}; } }) } },
        showToast: m => calls.push(['toast', m]), closeGlobalModal() {}, loadVendors: async () => {},
    });
    t._uploadBizFile = method('_uploadBizFile'); t._vfDropFile = method('_vfDropFile');
    return { t, calls };
};

test('저장 — 휴대폰은 mobile 칸, 전화는 phone 칸', async () => {
    const { t, calls } = mkSave(); await method('saveVendor').call(t, '');
    const ins = calls.find(c => c[1] === 'insert')[2];
    assert.equal(ins.mobile, '010-1111-2222'); assert.equal(ins.phone, '02-111');
    assert.equal(t.contactSel, U1, '새로 만든 곳을 고른다');
});

test('109 전 운영 — mobile 칸이 없으면 번호를 phone 에 합쳐 다시 저장', async () => {
    const { t, calls } = mkSave({ failMobile: true }); await method('saveVendor').call(t, '');
    const ins = calls.filter(c => c[1] === 'insert');
    assert.equal(ins.length, 2);
    assert.equal('mobile' in ins[1][2], false); assert.equal(ins[1][2].phone, '02-111 / 010-1111-2222');
    assert.match(calls.at(-1)[1], /저장되었습니다/);
});

test('등록증 — 올리고 경로 적기 · 적기 실패면 올린 파일 지움 · 잘못된 파일은 아무것도 안 바꿈', async () => {
    const ok = mkSave({ file: { name: '등록증.pdf', size: 100 } }); await method('saveVendor').call(ok.t, '');
    const up = ok.calls.find(c => c[0] === 'up')[1];
    assert.match(up, new RegExp(`^${U1}/[0-9a-f-]{36}\\.pdf$`), '업체 id/uuid.pdf — 한글 이름 안 들어감');
    assert.equal(ok.calls.find(c => c[1] === 'update' && c[2].biz_file_path)[2].biz_file_name, '등록증.pdf');
    assert.match(ok.calls.at(-1)[1], /등록증도 올렸습니다/);

    const bad = mkSave({ file: { name: '등록증.pdf', size: 100 }, updateErr: true }); await method('saveVendor').call(bad.t, '');
    assert.equal(bad.calls.find(c => c[0] === 'rm')[1], bad.calls.find(c => c[0] === 'up')[1], '올린 파일 정리');
    assert.match(bad.calls.at(-1)[1], /등록증 올리기 실패: boom/);

    const wrong = mkSave({ file: { name: '등록증.hwp', size: 100 } }); await method('saveVendor').call(wrong.t, '');
    assert.equal(wrong.calls.filter(c => c[0] === 'vendors').length, 0, '저장 안 함');
    assert.match(wrong.calls.at(-1)[1], /PDF·사진/);
});

test('다른 곳도 휴대폰을 본다 — 전체 검색 · 생산현황 표 · 우클릭 전화 · 퀵 픽업 번호', () => {
    assert.match(src, /hit\(v\.name, v\.contact_name, v\.address, v\.mobile, v\.phone/);
    assert.match(src, /<td class="nw">\$\{esc\(callNumberOf\(v\)\)\}<\/td>/);
    assert.match(src, /location\.href = telHref\(callNumberOf\(v\)\)/);
    const kq = fs.readFileSync(new URL('../supabase/functions/kakao-quick/index.ts', import.meta.url), 'utf8');
    assert.match(kq, /vendors\(\*\)/, '109 전후 모두 안전');
    assert.match(kq, /vendor\?\.mobile \|\| vendor\?\.phone/);
});

test('109 깔기 두 번 · dry-run 건수 = 실제 옮긴 수 · 버킷 RLS · 되돌리기(PGlite)', { skip: !process.env.PGLITE_PATH && 'PGLITE_PATH 없음 — 건너뜀' }, async t => {
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
create table public.vendors (id uuid primary key default gen_random_uuid(), name text not null, phone text, biz_no text);
insert into public.vendors (name, phone) values
  ('휴대폰', '010-1234-5678'), ('붙여씀', '01098765432'), ('국가번호', '+82 10-5555-6666'),
  ('유선', '02-123-4567'), ('대표', '1588-1234'), ('섞임', '010-1111-2222 / 02-333-4444'),
  ('빈칸', ''), ('없음', null), ('공백', '  '), ('짧음', '010-123');
`);
    const q = async (sql) => (await db.query(sql)).rows;
    const dry = (await q(DRY.replace(/--[^\n]*\n/g, '\n')))[0];
    assert.deepEqual({ ...dry }, { total: 10, no_phone: 3, to_mobile: 3, keep_phone: 4, keep_mixed_has_mobile: 2 });
    await db.exec(SQL); await db.exec(SQL);                     // 두 번 깔아도 같다
    const after = (await q(`select count(*) filter (where mobile is not null)::int as m, count(*) filter (where nullif(trim(phone),'') is not null)::int as p, count(*)::int as n from vendors`))[0];
    assert.deepEqual(after, { m: Number(dry.to_mobile), p: Number(dry.keep_phone), n: Number(dry.total) }, 'dry-run 건수와 같다');
    assert.deepEqual(await q(`select mobile, phone from vendors where name = '국가번호'`), [{ mobile: '+82 10-5555-6666', phone: null }]);
    assert.deepEqual(await q(`select mobile, phone from vendors where name = '섞임'`), [{ mobile: null, phone: '010-1111-2222 / 02-333-4444' }]);
    await assert.rejects(db.exec(`update vendors set biz_file_path = 'x.pdf' where name = '유선'`), /vendors_biz_file_check/, '이름 없이 경로만은 안 됨');
    await db.exec(`update vendors set biz_file_path = 'x.pdf', biz_file_name = '등록증.pdf' where name = '유선'`);

    const as = async (who, sql) => {
        await db.exec(`reset role; select set_config('request.jwt.claims', '${who ? JSON.stringify({ email: `${who}@bhas.com` }) : ''}', false);`);
        await db.exec(who ? 'set role authenticated' : 'set role anon');
        try { return (await db.query(sql)).rows; } finally { await db.exec('reset role'); }
    };
    assert.deepEqual(await q(`select public, file_size_limit::int as lim from storage.buckets where id = 'vendor_files'`), [{ public: false, lim: VF_FILE_MAX }]);
    await as('kim', `insert into storage.objects (bucket_id, name) values ('vendor_files', 'k.pdf')`);
    await assert.rejects(as('client1', `insert into storage.objects (bucket_id, name) values ('vendor_files', 'c.pdf')`), /row-level security/);
    assert.equal((await as('boss', `select name from storage.objects where bucket_id = 'vendor_files'`)).length, 1);
    assert.equal((await as('client1', `select name from storage.objects`)).length, 0, '고객사는 못 봄');
    await assert.rejects(as(null, `select name from storage.objects`), /permission denied/);

    //  되돌리기 — 파일이 남아 있으면 버킷은 남긴다, 휴대폰은 phone 으로
    await db.exec(`update vendors set phone = '02-000-0000' where name = '휴대폰'`);
    await db.exec(DOWN);
    assert.equal((await q(`select 1 from information_schema.columns where table_name = 'vendors' and column_name in ('mobile','biz_file_path','biz_file_name')`)).length, 0);
    assert.deepEqual(await q(`select name, phone from vendors where name in ('휴대폰','붙여씀','유선') order by name`), [
        { name: '붙여씀', phone: '01098765432' }, { name: '유선', phone: '02-123-4567' }, { name: '휴대폰', phone: '02-000-0000 / 010-1234-5678' }]);
    assert.equal((await q(`select 1 from storage.buckets where id = 'vendor_files'`)).length, 1, '파일 있으면 버킷 남김');
    await db.exec(`delete from storage.objects; ` + DOWN);
    assert.equal((await q(`select 1 from storage.buckets where id = 'vendor_files'`)).length, 0);
});

test('머리글 깔때기는 항상 보이고(연하게), 거르면 파랑', () => {
    const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
    assert.match(css, /\.ct3-tbl \.it-tbl th \.th-f\{opacity:\.7\}/);
    assert.match(css, /\.it-tbl th\.flt\{color:#0a84ff/);
});

test('⑤ 열 표시 — 팩스·등록증·메모를 켜면 11열, 업체명은 못 끈다', () => {
    const t = ctx({ contactColOn: { fax: true, cert: true, memo: true, name: false } }); const html = render(t);
    assert.deepEqual([...html.matchAll(/<th data-k="(\w+)">/g)].map(m => m[1]),
        ['name', 'cat', 'status', 'contact', 'mobile', 'phone', 'email', 'address', 'fax', 'cert', 'memo']);
    assert.match(html, /<td class="ck-cert ct3-cert">/);
    const off = render(ctx({ contactColOn: { email: false, address: false } }));
    assert.deepEqual([...off.matchAll(/<th data-k="(\w+)">/g)].map(m => m[1]), ['name', 'cat', 'status', 'contact', 'mobile', 'phone']);
});
