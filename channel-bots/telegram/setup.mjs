// 텔레그램 운영보고 — 사장님 1회 등록 도우미.
//  사장님은 @BotFather 에서 봇을 만들고, 그 봇에게 아무 말이나 한 번 보낸 뒤, 이 파일을 돌려 토큰만 붙여 넣는다.
//  chat id 는 getUpdates 로 찾아 준다. 토큰은 화면·파일에 남기지 않는다(입력할 때 안 보이고, gh 에는 stdin 으로만 넘긴다).
//  ⚠ 토큰을 채팅·카톡·에이전트 창에 보내지 않는다 — 이 스크립트의 숨김 입력에 직접 붙여 넣는다.
//  --apply 는 secret 2개 + 변수 TELEGRAM_READY=true(정기 실행 켜기)를 넣는다.
//    node channel-bots/telegram/setup.mjs            → 확인만(봇 이름·chat id 끝자리). 아무것도 안 바꾸고 안 보낸다
//    node channel-bots/telegram/setup.mjs --apply    → 확인 뒤 GitHub secret 2개(TELEGRAM_BOT_TOKEN·TELEGRAM_CHAT_ID) 등록
//  메시지는 보내지 않는다 — 첫 보고는 Actions "지금 바로 받아보기"로.
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const REPO = 'kim-seokwon/-';
const mask = s => { s = String(s); return s.length <= 3 ? '***' : '*'.repeat(Math.min(6, s.length - 3)) + s.slice(-3); };

//  getMe → 토큰이 맞는지, getUpdates → 봇에게 말 건 1:1 대화(가장 최근)의 chat id
export async function inspect(token, { fetch: f = globalThis.fetch, api = 'https://api.telegram.org' } = {}) {
  if (!/^\d+:[\w-]{30,}$/.test(token || '')) throw new Error('토큰 모양이 아닙니다 — BotFather 가 준 "숫자:영문" 한 줄 전체를 붙여 넣으세요');
  const call = async m => {
    const r = await f(`${api}/bot${token}/${m}`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(`${m} 실패(${r.status}${j.description ? ' ' + j.description : ''}) — 토큰을 다시 확인하세요`);
    return j.result;
  };
  const me = await call('getMe');
  const ups = await call('getUpdates');
  const chats = ups.map(u => (u.message || u.edited_message || u.my_chat_member)?.chat).filter(c => c && c.type === 'private');
  if (!chats.length) throw new Error(`@${me.username} 에게 아무 말이나 한 번 보낸 뒤 다시 돌려 주세요(대화 기록이 없어 chat id 를 못 찾음)`);
  const chat = chats[chats.length - 1];
  return { bot: me.username, chatId: String(chat.id), who: chat.first_name || chat.username || '' };
}

//  gh secret set <name> -R <repo> — 값은 stdin 으로만(명령줄·화면에 안 남게)
export function ghSecretSet(name, value, { gh = process.env.GH_BIN || 'gh', repo = REPO } = {}) {
  return new Promise((ok, no) => {
    const p = spawn(gh, ['secret', 'set', name, '-R', repo], { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('error', no);
    p.on('close', c => (c === 0 ? ok() : no(new Error(`gh secret set ${name} 실패(${c}) ${err.replace(value, '***').slice(0, 200)}`))));
    p.stdin.end(value);
  });
}

//  값이 비밀이 아닌 gh 명령(변수 켜기)
export function ghSet(args, { gh = process.env.GH_BIN || 'gh' } = {}) {
  return new Promise((ok, no) => {
    const p = spawn(gh, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('error', no);
    p.on('close', c => (c === 0 ? ok() : no(new Error(`gh ${args.slice(0, 3).join(' ')} 실패(${c}) ${err.slice(0, 200)}`))));
  });
}

//  화면에 안 보이게 한 줄 읽기(터미널일 때). 파이프로 넣으면 그대로 읽는다
function readHidden(prompt) {
  return new Promise(res => {
    const { stdin, stdout } = process;
    stdout.write(prompt);
    let buf = '';
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume(); stdin.setEncoding('utf8');
    const on = ch => {
      for (const c of ch) {
        if (c === '\r' || c === '\n' || c === '\u0004') {
          if (stdin.isTTY) stdin.setRawMode(false);
          stdin.pause(); stdin.off('data', on); stdout.write('\n'); return res(buf.trim());
        }
        if (c === '\u0003') process.exit(130);
        if (c === '\u007f') buf = buf.slice(0, -1); else buf += c;
      }
    };
    stdin.on('data', on);
  });
}

async function main() {
  const apply = process.argv.includes('--apply');
  console.log('⚠ 토큰은 채팅·에이전트에 보내지 말고, 아래 숨김 입력에만 직접 붙여 넣으세요.');
  const token = process.env.TELEGRAM_BOT_TOKEN || await readHidden('BotFather 가 준 봇 토큰을 붙여 넣고 Enter(화면에 안 보임): ');
  const r = await inspect(token);
  console.log(`봇 @${r.bot} · 대화 상대 ${r.who || '-'} · chat id ${mask(r.chatId)}`);
  if (!apply) { console.log('확인만 했습니다(등록·전송 없음). 등록하려면 --apply 를 붙여 다시 실행하세요.'); return; }
  await ghSecretSet('TELEGRAM_BOT_TOKEN', token);
  await ghSecretSet('TELEGRAM_CHAT_ID', r.chatId);
  await ghSet(['variable', 'set', 'TELEGRAM_READY', '-R', REPO, '--body', 'true']);
  console.log(`GitHub ${REPO} 에 TELEGRAM_BOT_TOKEN·TELEGRAM_CHAT_ID 등록 + 정기 실행 켬(TELEGRAM_READY). 첫 보고는 Actions "텔레그램 운영 보고서" → Run workflow.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(e => { console.error(e.message); process.exit(1); });
}
