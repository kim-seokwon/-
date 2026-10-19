// 087(스토리지 익명 차단)·088(고객함수 브랜드 검사) 정의 검증 — 마이그레이션 글자를 읽어 규칙을 확인한다.
// 운영 동작은 supabase/rehearsals/087_088_rehearsal.sql 로 BEGIN…ROLLBACK 리허설한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rd = p => readFileSync(new URL(`../supabase/${p}`, import.meta.url), 'utf8');
const strip = s => s.replace(/--.*$/gm, '');
const up87 = strip(rd('migrations/087_storage_auth_only.sql'));
const dn87 = strip(rd('rollbacks/087_storage_auth_only.down.sql'));
const up88 = strip(rd('migrations/088_brand_func_guard.sql'));
const dn88 = strip(rd('rollbacks/088_brand_func_guard.down.sql'));
const policies = s => [...s.matchAll(/create policy "([^"]+)" on storage\.objects\s+for (\w+) to (\w+)([\s\S]*?);/gi)]
  .map(m => ({ name: m[1], cmd: m[2].toLowerCase(), role: m[3].toLowerCase(), body: m[4] }));

test('087: 공개 정책 4개를 지우고, 새 정책은 전부 authenticated', () => {
  for (const n of ['Public Access', 'Public Insert', 'Public Update', 'Public Delete'])
    assert.match(up87, new RegExp(`drop policy if exists "${n}" on storage\\.objects`));
  const ps = policies(up87);
  assert.deepEqual(ps.map(p => p.cmd).sort(), ['delete', 'insert', 'select', 'update']);
  for (const p of ps) {
    assert.equal(p.role, 'authenticated', p.name);
    assert.match(p.body, /bucket_id = 'bhas'/, p.name);
  }
  assert.doesNotMatch(up87, /\bto (public|anon)\b(?!\s*,)/i);
});

test('087: 쓰기(insert·update·delete)는 직원(is_staff)만, 버킷 public 설정은 안 건드림', () => {
  for (const p of policies(up87).filter(p => p.cmd !== 'select'))
    assert.match(p.body, /public\.is_staff\(\)/, p.name);
  const upd = policies(up87).find(p => p.cmd === 'update');
  assert.match(upd.body, /using[\s\S]*with check/i);
  assert.match(up87, /function public\.is_staff\(\)[\s\S]*security definer set search_path = public/i);
  assert.match(up87, /revoke all on function public\.is_staff\(\) from public, anon/);
  assert.doesNotMatch(up87, /storage\.buckets/);
});

test('087 되돌리기: 운영 원래 정책 4개 복원 + 새 정책·함수 제거', () => {
  const ps = policies(dn87);
  assert.deepEqual(ps.map(p => p.name).sort(), ['Public Access', 'Public Delete', 'Public Insert', 'Public Update']);
  for (const p of ps) assert.equal(p.role, 'public');
  for (const n of ['bhas_select_auth', 'bhas_insert_staff', 'bhas_update_staff', 'bhas_delete_staff'])
    assert.match(dn87, new RegExp(`drop policy if exists "${n}"`));
  assert.match(dn87, /drop function if exists public\.is_staff\(\)/);
});

const fnBlocks = s => Object.fromEntries([...s.matchAll(/create or replace function public\.(\w+)\(([\s\S]*?)\$function\$\s*;/gi)].map(m => [m[1], m[0]]));

test('088: 두 함수 모두 첫머리에서 can_access_brand 검사 → 42501, 익명 실행권 없음', () => {
  const f = fnBlocks(up88);
  for (const name of ['brand_customers', 'brand_gone_counts']) {
    const b = f[name];
    assert.ok(b, name);
    assert.match(b, /language plpgsql stable security definer set search_path = public/i);
    const begin = b.indexOf('begin'), guard = b.indexOf('can_access_brand'), ret = b.indexOf('return (');
    assert.ok(begin > 0 && begin < guard && guard < ret, `${name}: 검사가 본문보다 먼저`);
    assert.match(b, /b\.name = p_brand and public\.can_access_brand\(b\.id\)/);
    assert.match(b, /raise exception '[^']+' using errcode = '42501'/);
    assert.match(up88, new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon`));
    assert.doesNotMatch(up88, new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to [^;]*anon`));
  }
});

test('088: 조회 본문은 되돌리기(=운영 원래 정의)와 글자 그대로 같다', () => {
  const up = fnBlocks(up88), dn = fnBlocks(dn88);
  for (const name of ['brand_customers', 'brand_gone_counts']) {
    const body = s => s.slice(s.indexOf('with c as'), s.lastIndexOf('$function$')).replace(/\s*\);\s*end\s*$/, '').replace(/;\s*$/, '').trim();
    assert.equal(body(up[name]), body(dn[name]), name);
    assert.match(dn[name], /LANGUAGE sql/);
    assert.doesNotMatch(dn[name], /can_access_brand/);
  }
});
