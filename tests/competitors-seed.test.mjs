// 경쟁사 50곳 seed 검사 — JSON ↔ SQL 일치, 중복 0, 핸들 문법, 두 번 돌려도 중복행 0·기존 행 안 덮음.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const dir = new URL('../supabase/seeds/', import.meta.url);
const rows = JSON.parse(fs.readFileSync(new URL('competitors_50.json', dir), 'utf8')).competitors;
const sql = fs.readFileSync(new URL('competitors_50.sql', dir), 'utf8');
const tuples = [...sql.matchAll(/\('((?:[^']|'')*)', '((?:[^']|'')*)', '((?:[^']|'')*)'\)/g)]
    .map(m => ({ name: m[1].replaceAll("''", "'"), handle: m[2], memo: m[3].replaceAll("''", "'") }));

test('seed: 50개, 중복 0, 인스타 핸들 문법, 이름 있음', () => {
    assert.equal(rows.length, 50);
    assert.equal(new Set(rows.map(r => r.handle)).size, 50);
    for (const r of rows) assert.match(r.handle, /^(?!.*\.\.)(?!\.)(?!.*\.$)[a-z0-9._]{1,30}$/, r.handle);
    assert.ok(rows.every(r => r.name.trim()));
});

test('seed: SQL 이 JSON 과 같은 50개, handle 충돌이면 아무것도 안 바꾼다', () => {
    assert.deepEqual(tuples.map(t => t.handle), rows.map(r => r.handle));
    assert.deepEqual(tuples.map(t => t.name), rows.map(r => r.name));
    assert.match(sql, /on conflict \(handle\) do nothing;\s*$/);
    assert.doesNotMatch(sql, /\bdo update\b|\bdelete\b|\btruncate\b|\bupdate\s+competitors/i);
});

test('seed: 두 번 돌려도 중복행 0, 사람이 바꾼 memo·active·이름 보존', () => {
    // unique(handle) + on conflict do nothing 의미 그대로 흉내
    const table = [{ handle: 'cchn.shop', name: '코코하니(수동)', memo: '직접 넣음', active: false }];
    const run = () => { for (const t of tuples) if (!table.some(x => x.handle === t.handle)) table.push({ ...t, active: true }); };
    run(); run();
    assert.equal(table.length, 50);
    assert.equal(new Set(table.map(t => t.handle)).size, 50);
    assert.deepEqual(table[0], { handle: 'cchn.shop', name: '코코하니(수동)', memo: '직접 넣음', active: false });
});
