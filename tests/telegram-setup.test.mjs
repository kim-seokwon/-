//  텔레그램 등록 도우미 — 네트워크·GitHub 없이. 텔레그램은 가짜 fetch, gh 는 가짜 실행 파일.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspect, ghSecretSet, ghSet } from '../channel-bots/telegram/setup.mjs';

const TOKEN = '123456789:AAFakeTokenForTestsOnly_abcdefghijkl';
const fakeTg = (updates, calls = []) => async u => {
  calls.push(u);
  const m = u.split('/').pop();
  if (!u.includes(`/bot${TOKEN}/`)) return new Response(JSON.stringify({ ok: false, description: 'Unauthorized' }), { status: 401 });
  if (m === 'getMe') return Response.json({ ok: true, result: { username: 'orca2179_bot' } });
  if (m === 'getUpdates') return Response.json({ ok: true, result: updates });
  return new Response('{}', { status: 404 });
};

test('봇에게 말 건 1:1 대화의 chat id 를 찾는다(그룹은 무시, 가장 최근)', async () => {
  const calls = [];
  const ups = [
    { message: { chat: { id: -1001, type: 'group' } } },
    { message: { chat: { id: 111, type: 'private', first_name: '옛' } } },
    { message: { chat: { id: 987654321, type: 'private', first_name: '사장님' } } },
  ];
  assert.deepEqual(await inspect(TOKEN, { fetch: fakeTg(ups, calls) }), { bot: 'orca2179_bot', chatId: '987654321', who: '사장님' });
  assert.deepEqual(calls.map(u => u.split('/').pop()), ['getMe', 'getUpdates'], '읽기만 — sendMessage 없음');
});

test('대화가 없으면 봇 이름과 함께 "말 걸고 다시"', async () => {
  await assert.rejects(inspect(TOKEN, { fetch: fakeTg([]) }), /@orca2179_bot 에게 아무 말이나/);
});

test('토큰 모양이 틀리면 텔레그램에 묻지도 않는다 · 틀린 토큰은 getMe 실패', async () => {
  const calls = [];
  await assert.rejects(inspect('abc', { fetch: fakeTg([], calls) }), /토큰 모양/);
  assert.equal(calls.length, 0);
  await assert.rejects(inspect('123456789:BBwrongTokenwrongTokenwrongToken_x', { fetch: fakeTg([]) }), /getMe 실패\(401 Unauthorized\)/);
});

test('gh secret set 은 값을 stdin 으로만 넘긴다(명령줄에 값 없음)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-setup-'));
  const log = path.join(dir, 'log');
  const gh = path.join(dir, 'gh');
  fs.writeFileSync(gh, `#!/bin/sh\necho "ARGS $*" >> "${log}"\necho "STDIN $(cat)" >> "${log}"\n`, { mode: 0o755 });
  await ghSecretSet('TELEGRAM_BOT_TOKEN', TOKEN, { gh });
  const out = fs.readFileSync(log, 'utf8');
  assert.match(out, /^ARGS secret set TELEGRAM_BOT_TOKEN -R kim-seokwon\/-$/m);
  assert.ok(!out.split('\n')[0].includes(TOKEN), '명령줄에 토큰 없음');
  assert.match(out, new RegExp(`^STDIN ${TOKEN}$`, 'm'));
  fs.writeFileSync(gh, '#!/bin/sh\ncat >/dev/null; echo "HTTP 403 for $0" >&2; exit 1\n', { mode: 0o755 });
  await assert.rejects(ghSecretSet('X', TOKEN, { gh }), /gh secret set X 실패\(1\)/);
});

test('(반려1-①) --apply 의 정기 실행 켜기는 gh variable set TELEGRAM_READY true · 안내문에 숨김 입력 경고', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-setup-'));
  const log = path.join(dir, 'log'), gh = path.join(dir, 'gh');
  fs.writeFileSync(gh, `#!/bin/sh\necho "ARGS $*" >> "${log}"\n`, { mode: 0o755 });
  await ghSet(['variable', 'set', 'TELEGRAM_READY', '-R', 'kim-seokwon/-', '--body', 'true'], { gh });
  assert.match(fs.readFileSync(log, 'utf8'), /^ARGS variable set TELEGRAM_READY -R kim-seokwon\/- --body true$/m);
  const src = fs.readFileSync(new URL('../channel-bots/telegram/setup.mjs', import.meta.url), 'utf8');
  assert.match(src, /토큰은 채팅·에이전트에 보내지 말고, 아래 숨김 입력에만 직접 붙여 넣으세요/);
  assert.match(src, /ghSet\(\['variable', 'set', 'TELEGRAM_READY'/);
});
