//  114d d1 — 비공개 파일 참조(ofs:) 읽기·서명·업로드 대체 경로
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

globalThis.location ??= { origin: 'https://app.test' };
const src = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const method = (name) => {
    const re = new RegExp(`\\n    (async )?${name}\\(`);
    const m = re.exec(src); assert.ok(m, `${name} 를 main.js 에서 못 찾음`);
    const a = m.index + 1, eol = src.indexOf('\n', a), first = src.slice(a, eol);
    const oneLine = first.trimEnd().endsWith('}') && first.split('{').length === first.split('}').length;
    const b = oneLine ? eol : src.indexOf('\n    }\n', a) + 6;
    return eval('(' + src.slice(a, b).trim().replace(new RegExp(`^(async )?${name}\\(`), (_, as) => `${as || ''}function ${name}(`) + ')');
};
const ORG = '00000000-0000-4000-8000-000000002179';
const REF = `ofs:org/${ORG}/documents/p1/a.pdf`;
const mk = (opt = {}) => {
    const log = { sign: [], up: [], sel: [], renders: 0 };
    const t = { requestRender() { log.renders++; } };
    t.supabase = {
        from: table => ({ select: () => ({ eq: (_k, id) => ({ maybeSingle: async () => { log.sel.push(`${table}:${id}`); return opt.row ? opt.row(table, id) : { data: { org_id: ORG }, error: null }; } }) }) }),
        storage: { from: bucket => ({
            createSignedUrls: async (paths, ttl) => { log.sign.push({ bucket, paths, ttl }); return opt.sign ? opt.sign(paths) : { data: paths.map(p => ({ path: p, signedUrl: `https://x.supabase.co/storage/v1/object/sign/${bucket}/${p}?token=t` })), error: null }; },
            upload: async (path) => { log.up.push(`${bucket}/${path}`); return opt.upload ? opt.upload(bucket, path) : { error: null }; },
            getPublicUrl: path => ({ data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/${bucket}/${path}` } }),
        }) },
    };
    for (const f of ['_safeFileUrl', '_isOfs', '_ofsUrl', '_ofsReset', '_ofsFlush', '_fileUrlNow']) t[f] = method(f);
    return { t, log };
};

test('ofs: 형식만 참조로 본다 — 옛 http·이상한 값은 아니다', () => {
    const { t } = mk();
    assert.equal(t._isOfs(REF), true);
    for (const v of ['https://x/a.png', 'ofs:org/abc/a.png', `ofs:org/${ORG}/a b.png`, `ofs:org/${ORG}/a).png`, '', null]) assert.equal(t._isOfs(v), false, String(v));
});

test('옛 공개 URL·data 는 그대로, 위험한 프로토콜은 막는다', () => {
    const { t } = mk();
    assert.equal(t._safeFileUrl('https://x/storage/v1/object/public/bhas/a.png'), 'https://x/storage/v1/object/public/bhas/a.png');
    assert.equal(t._safeFileUrl('javascript:alert(1)'), '');
});

test('그리는 동안은 빈 값 → 한 번에 묶어 서명 → 다시 그리면 서명 URL', async () => {
    const { t, log } = mk();
    const r2 = `ofs:org/${ORG}/photos/p1/b.jpg`;
    assert.equal(t._safeFileUrl(REF), ''); assert.equal(t._safeFileUrl(r2), ''); assert.equal(t._safeFileUrl(REF), '');
    clearTimeout(t._ofsT); await t._ofsFlush();
    assert.equal(log.sign.length, 1); assert.equal(log.sign[0].bucket, 'org_files'); assert.equal(log.sign[0].ttl, 3600);
    assert.deepEqual(log.sign[0].paths, [`org/${ORG}/documents/p1/a.pdf`, `org/${ORG}/photos/p1/b.jpg`]);
    assert.equal(log.renders, 1);
    assert.match(t._safeFileUrl(REF), /\/object\/sign\/org_files\/org\/.+\/a\.pdf\?token=/);
    clearTimeout(t._ofsT); assert.equal(log.sign.length, 1, '캐시 적중이면 다시 서명하지 않는다');
});

test('서명이 50분 지나면 다시 서명한다', async () => {
    const { t, log } = mk();
    t._safeFileUrl(REF); clearTimeout(t._ofsT); await t._ofsFlush();
    t._ofsCache.get(REF).exp = Date.now() - 1;
    assert.equal(t._safeFileUrl(REF), ''); clearTimeout(t._ofsT); await t._ofsFlush();
    assert.equal(log.sign.length, 2);
});

test('서명 거절(남의 org)이면 빈 값 · 다시 그려도 1분간 재요청 없음', async () => {
    const { t, log } = mk({ sign: () => ({ data: null, error: { message: 'Object not found' } }) });
    t._safeFileUrl(REF); clearTimeout(t._ofsT); await t._ofsFlush();
    assert.equal(log.renders, 0);
    assert.equal(t._safeFileUrl(REF), ''); clearTimeout(t._ofsT);
    assert.equal(t._ofsWant.size, 0);
    assert.equal(await t._fileUrlNow(REF), '');
});

test('_fileUrlNow — 미리보기·내려받기는 서명을 기다린다', async () => {
    const { t } = mk();
    assert.match(await t._fileUrlNow(REF), /token=/);
    assert.equal(await t._fileUrlNow('https://x/a.png'), 'https://x/a.png');
});

test('d1a — 업로드 4곳은 아직 옛 bhas 그대로(쓰기 전환은 d1b)', () => {
    assert.equal((src.match(/\.from\('bhas'\)/g) || []).length, 8);
    assert.doesNotMatch(src, /_putFile|_orgOfRow/);
    for (const p of ['notes/${n.id}', 'items/${itemId}', 'photos/${pid}', 'documents/${product_id}']) assert.ok(src.includes(p), p);
});

test('계정이 바뀌면 서명 캐시를 버린다', async () => {
    const { t } = mk();
    t.currentUser = { id: 'u1' };
    t._safeFileUrl(REF); clearTimeout(t._ofsT); await t._ofsFlush();
    assert.match(t._safeFileUrl(REF), /token=/);
    t.currentUser = { id: 'u2' };
    assert.equal(t._safeFileUrl(REF), '', '다른 계정은 앞 계정 서명 URL 을 못 쓴다'); clearTimeout(t._ofsT);
});

test('로그아웃(_ofsReset)이면 캐시 삭제 · 서명 도중이면 결과를 버린다', async () => {
    const { t } = mk();
    t._safeFileUrl(REF); clearTimeout(t._ofsT); await t._ofsFlush();
    t._ofsReset();
    assert.equal(t._ofsCache.size, 0);
    t._safeFileUrl(REF); clearTimeout(t._ofsT);
    const p = t._ofsFlush(); t._ofsReset(); await p;
    assert.equal(t._ofsCache.size, 0, '로그아웃 뒤 도착한 서명은 캐시에 넣지 않는다');
});

test('logout·SIGNED_OUT 이 _ofsReset 을 부른다', () => {
    assert.match(src, /async logout\(\) \{\n.*signOut.*\n\s+this\._ofsReset\?\.\(\);/);
    assert.match(src, /SIGNED_OUT'\) this\._ofsReset\?\.\(\)/);
});

test('읽는 곳이 원시 URL 대신 _safeFileUrl 을 거친다', () => {
    assert.doesNotMatch(src, /<img class="nb-img" src="\$\{esc\(img\[1\]\)\}"/);
    assert.doesNotMatch(src, /<img src="\$\{photoObj\.url\}"/);
    assert.doesNotMatch(src, /<a href="\$\{doc\.url\}"/);
    assert.match(src, /photos\.map\(u => `<img src="\$\{esc\(this\._safeFileUrl\(u\)\)\}"/);
});
