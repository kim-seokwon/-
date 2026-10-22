// ============================================================
//  29CM 봇 — 계정 목록 · OTP 메일 고르기 · 주문 매핑 (외부 모듈 없음 → tests/cm29-accounts.test.mjs 가 바로 확인)
//  계정마다 몰이 따로다: 같은 주문번호가 두 브랜드에 있어도 (mall_key, order_id) 로 갈린다.
//  화면·집계는 mall_key 가 '29cm' 이거나 '29cm-' 로 시작하면 29CM 채널로 본다(main.js is29cmKey).
// ============================================================

//  29CM 몰인가 — '29cm' 또는 '29cm-…'(계정별 몰). 화면(main.js)도 이걸 가져다 쓴다
export const is29cmKey = k => /^29cm(-|$)/i.test(String(k || ''));

//  [하이헤이호] CM29_ID/PW → 29cm · [로하이스튜디오] CM29_ID_2/PW_2 → 29cm-rohi
//  계정별 선택값: CM29_TOTP_SECRET(_2) = 구글 OTP 설정키 · CM29_OTP_TO(_2) = 인증 메일이 오는 주소(같은 Gmail 로 모일 때 구분용)
export const CM29_ACCOUNTS = [
  { n: '', brand: '하이헤이호', mallKey: '29cm', mallLabel: '29CM', brandMatch: ['하이헤이호', 'hiheyho'] },
  { n: '_2', brand: '로하이스튜디오', mallKey: '29cm-rohi', mallLabel: '29CM 로하이스튜디오', brandMatch: ['로하이', 'rohi', 'lohi'] },
];

//  돌릴 계정 / 건너뛸 계정(이유). 비밀값은 결과 이유 문구에 넣지 않는다.
export function accountsFromEnv(env, hasGmail) {
  const run = [], skip = [];
  for (const a of CM29_ACCOUNTS) {
    const id = env[`CM29_ID${a.n}`], pw = env[`CM29_PW${a.n}`];
    const totp = env[`CM29_TOTP_SECRET${a.n}`] || '';
    if (!id || !pw) { skip.push({ brand: a.brand, why: `CM29_ID${a.n}/PW${a.n} 없음` }); continue; }
    if (!totp && !hasGmail) { skip.push({ brand: a.brand, why: `2차인증 수단 없음(CM29_TOTP_SECRET${a.n} 또는 GMAIL_*)` }); continue; }
    run.push({ ...a, id, pw, totp, otpTo: env[`CM29_OTP_TO${a.n}`] || '' });
  }
  return { run, skip };
}

//  HTML 메일 → 글자만(style·script·태그·주석을 걷고 &nbsp; 같은 엔티티를 풀어 공백 하나로)
export function htmlToText(html) {
  const ent = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(style|script|head)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      const k = e.toLowerCase();
      if (k[0] === '#') { const n = k[1] === 'x' ? parseInt(k.slice(2), 16) : Number(k.slice(1)); return Number.isFinite(n) ? String.fromCodePoint(n) : ' '; }
      return ent[k] ?? ' ';
    })
    .replace(/\s+/g, ' ').trim();
}

//  메일 본문에서 6자리 인증번호 — '인증' 근처를 먼저, 없으면 홀로 선 6자리(앞뒤가 숫자·#·문자가 아님 → 색상코드·날짜 조각 제외)
export function otpFromText(text) {
  const t = String(text || '');
  const lone = '(?<![0-9A-Za-z#.,:/-])(\\d{6})(?![0-9A-Za-z.,:/-])';
  return (t.match(new RegExp(`(?:인증|코드|code)[^0-9]{0,60}?${lone}`, 'i'))
    || t.match(new RegExp(`${lone}[^0-9]{0,30}(?:인증|코드)`))
    || t.match(new RegExp(lone)) || [])[1] || null;
}

//  Gmail 메일 payload → 본문 글자(text/plain 은 그대로, text/html 은 htmlToText). base64url 도 그대로 풀린다
export function mailText(payload) {
  const plain = [], html = [];
  const walk = p => {
    if (p?.body?.data) {
      const t = Buffer.from(p.body.data, 'base64').toString('utf-8');
      (/html/i.test(p.mimeType || '') || /<\/?(html|body|td|div|p|br|table)\b/i.test(t) ? html : plain).push(t);
    }
    (p?.parts || []).forEach(walk);
  };
  walk(payload || {});
  return [...plain, ...html.map(htmlToText)].join('\n');
}

//  로그용 — 6자리 이상 숫자는 가린다(인증번호를 로그에 남기지 않게)
export const maskDigits = s => String(s || '').replace(/\d{6,}/g, m => '*'.repeat(m.length));

//  Gmail 검색어 — 받는 주소를 알면 그 주소로 온 것만(다른 계정 메일을 집지 않게)
export function otpQueries(to) {
  const only = to ? ` {to:${to} deliveredto:${to}}` : '';
  return [
    `newer_than:15m${only} (29CM OR 29cm OR MUSINSA OR 무신사 OR 인증 OR 인증번호 OR verification OR 파트너)`,
    `newer_than:15m${only}`,
  ];
}

//  이 메일을 써도 되나 — 이미 다른 계정(또는 앞 시도)이 쓴 메일이거나, 기준 시각보다 먼저 온 메일이면 안 된다
export function otpMailUsable({ id, receivedAt }, { notBeforeMs, usedIds }) {
  if (usedIds && usedIds.has(id)) return false;
  if (receivedAt && receivedAt < notBeforeMs) return false;
  return true;
}

//  인증번호 유효시간(3분) + 시계 오차 여유(1분) — 쿨다운이면 이 안에 온 메일만 쓴다(만료 코드 집지 않게)
export const OTP_VALID_MS = 3 * 60_000;
export const OTP_SKEW_MS = 60_000;

//  기준 시각 — 새로 요청했으면 요청 직전부터, 이미 발송됐으면(쿨다운) 유효시간+오차(4분) 전부터. 단 앞 계정이 쓴 메일 시각(floor)보다는 늦게.
export function otpNotBefore({ now, requested, floor = 0 }) {
  const base = requested ? now - 10_000 : now - (OTP_VALID_MS + OTP_SKEW_MS);
  return Math.max(base, floor ? floor + 1 : 0);
}

//  2차인증 '인증번호 받기' 버튼 이름 — 화면 문구가 조금 달라도(요청·발송·전송·재발송·다시 받기) 잡는다
export const OTP_REQ_BTN_RE = /인증\s*(번호|코드|메일)?\s*(받기|요청|재요청|발송|재발송|전송|재전송)|재발송|재전송|다시\s*받기|코드\s*받기/;

//  재요청 쿨다운 화면 문구 — 이게 보일 때만 '이미 발송됨'으로 본다
export const OTP_COOLDOWN_RE = /\d+\s*(초|분)\s*(후|뒤)|재\s*(요청|발송|전송)[^\n]{0,15}(가능|후|뒤)|잠시\s*후\s*다시|남은\s*시간|\b\d{1,2}:\d{2}\b/;

//  화면 기록용 HTML 가리기 — 이메일 주소·6자리 이상 숫자·input value
export const maskPage = html => String(html || '')
  .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '***@***')
  .replace(/\d{6,}/g, m => '*'.repeat(m.length))
  .replace(/(\svalue=")[^"]*"/gi, '$1***"');

//  Gmail 폴링 간격 · 쿼터 초과 때 쉬는 시간
export const OTP_POLL_MS = 6000;
export const OTP_BACKOFF_MS = 15000;

//  Gmail 쿼터·속도 제한 오류인가(429 · 'Quota exceeded … Units per minute per user' · rateLimitExceeded)
export function isQuotaError(e) {
  const code = Number(e?.code ?? e?.status ?? e?.response?.status);
  const msg = `${e?.message || ''} ${JSON.stringify(e?.errors || e?.response?.data || '')}`;
  return code === 429 || /quota|rate ?limit|units per minute/i.test(msg);
}

//  Gmail 에서 인증번호 메일 찾기 — 돌려줌 { code, id, receivedAt }, 시간 안에 못 찾으면 throw
//  쿼터 아끼기: 한 번 본 id 는 다시 get 안 함(scanned) · 먼저 metadata 로 받은 시각만 보고 기준 뒤 메일만 full
//  쿼터 초과면 backoffMs 쉬고 계속(바로 실패하지 않음). gmail·sleep·now 는 바꿔 끼울 수 있음(시험용)
export async function pollOtp(gmail, {
  timeoutMs = 120_000, notBeforeMs = 0, usedIds = new Set(), to = '',
  pollMs = OTP_POLL_MS, backoffMs = OTP_BACKOFF_MS,
  now = Date.now, sleep = ms => new Promise(r => setTimeout(r, ms)), log = console,
} = {}) {
  const started = now();
  const scanned = new Set(), seen = new Set();
  const header = (msg, n) => (msg.data.payload?.headers || []).find(h => h.name === n)?.value || '';
  while (now() - started < timeoutMs) {
    try {
      for (const q of otpQueries(to)) {
        const list = await gmail.users.messages.list({ userId: 'me', q, maxResults: 15, includeSpamTrash: true });
        for (const m of (list.data.messages || [])) {
          if (usedIds.has(m.id) || scanned.has(m.id)) continue;
          //  scanned 는 끝까지 본 뒤에만 넣는다 — 중간(full)에서 429 가 나면 다음 바퀴에 같은 메일을 다시 본다
          const meta = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'metadata', metadataHeaders: ['Subject', 'From'] });
          const receivedAt = Number(meta.data.internalDate || 0);
          const label = `${header(meta, 'From')} | ${header(meta, 'Subject')}`;
          if (!otpMailUsable({ id: m.id, receivedAt }, { notBeforeMs, usedIds })) {
            scanned.add(m.id);
            seen.add(`${label} [기준보다 ${Math.round((notBeforeMs - receivedAt) / 1000)}초 먼저 옴 — 건너뜀]`);
            continue;
          }
          const full = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'full' });
          scanned.add(m.id);
          const body = mailText(full.data.payload);
          const code = otpFromText(`${header(full, 'Subject')}\n${body}`);
          if (code) return { code, id: m.id, receivedAt };
          seen.add(`${label} [코드 못 읽음 · 본문 앞: ${maskDigits(body.slice(0, 200))}]`);
        }
      }
    } catch (e) {
      if (!isQuotaError(e)) throw e;
      log.error(`[29cm] Gmail 쿼터 초과 — ${backoffMs / 1000}초 쉬고 계속`);
      await sleep(backoffMs);
      continue;
    }
    await sleep(pollMs);
  }
  log.error('[29cm] OTP 메일 못 찾음. 본 메일:', [...seen].slice(0, 15).join(' || ') || '(메일 0건 — 이 계정으로 메일이 안 옴)');
  throw new Error('OTP 메일에서 인증번호를 못 찾음');
}

//  29CM 주문 API(v4/orders resultList)는 '상품 줄' 단위다 — orderSerial(주문번호) 하나에 줄 여러 개.
//  channel_orders 는 다른 몰처럼 주문 1건 = 1행이라 주문번호로 묶고 금액은 줄 합, 줄은 raw.items 에 둔다.
export const orderKey = o => {
  const k = o?.orderSerial ?? o?.orderNumber ?? o?.orderNo ?? o?.orderId;
  return k == null || k === '' ? null : String(k);
};

export function groupOrders(lines) {
  const by = new Map();
  for (const l of lines || []) {
    const k = orderKey(l); if (!k) continue;
    const g = by.get(k) || [];
    if (!g.some(x => x.orderItemManageId != null && x.orderItemManageId === l.orderItemManageId)) g.push(l);   // 창이 겹쳐 같은 줄이 두 번 와도 한 번만
    by.set(k, g);
  }
  return [...by.entries()].map(([k, items]) => ({ orderSerial: k, items }));
}

const num = v => Number(v ?? 0) || 0;
export function mapOrder(order, mallKey) {
  const items = order.items || [order];
  const f = items[0] || {};
  //  DB order_op_state 는 몰 상태가 2·3·4 로 시작하면 취소·반품·교환, 나머지는 완료로 센다 → 29CM 한글 상태를 그 코드로 바꾼다
  const kind = l => /취소/.test(l.orderStatusDescription || '') ? '2' : /반품|환불/.test(l.orderStatusDescription || '') ? '3' : /교환/.test(l.orderStatusDescription || '') ? '4' : '1';
  const live = items.filter(l => !['2', '3'].includes(kind(l)));         // 매출 = 취소·반품 아닌 줄만
  const kinds = new Set(items.map(kind));
  const code = kinds.size === 1 ? [...kinds][0] : (live.length ? '1' : [...kinds].sort()[0]);
  const sum = key => live.reduce((t, l) => t + num(l[key]), 0);
  return {
    channel: '29cm', mall_key: mallKey,
    order_id: orderKey(f),
    order_date: f.orderedAt ?? f.paidAt ?? null,
    buyer_name: f.orderName ?? null,
    receiver_name: f.receiverName ?? null,
    pay_amount: live.length ? (sum('saleAmount') || sum('sellAmount')) : 0,
    order_amount: sum('sellAmount'),
    channel_status: `${code}:` + [...new Set(items.map(l => l.orderStatusDescription).filter(Boolean))].join(','),
    invoice_no: f.invoiceNo ?? null, courier: f.deliveryCompanyName ?? null,
    raw: { orderSerial: orderKey(f), items },   // status 는 안 보낸다 — 재수집 때 직원 처리상태를 덮지 않게(신규는 DB 기본 new)
  };
}

//  계정을 하나씩 — 한 계정이 실패해도 다음 계정은 돈다. 결과: [{ brand, ok, count | error }]
export async function runAccounts(accounts, fn, log = console) {
  const out = [];
  for (const a of accounts) {
    try {
      const count = await fn(a);
      out.push({ brand: a.brand, ok: true, count });
    } catch (e) {
      log.error(`[29cm:${a.brand}] 실패:`, e?.message || e);
      out.push({ brand: a.brand, ok: false, error: String(e?.message || e) });
    }
  }
  return out;
}
