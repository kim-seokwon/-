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

//  메일 본문에서 6자리 인증번호
export function otpFromText(text) {
  const t = String(text || '');
  return (t.match(/인증[^0-9]{0,25}(\d{6})/) || t.match(/(\d{6})[^0-9]{0,25}인증/) || t.match(/\b(\d{6})\b/) || [])[1] || null;
}

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

//  기준 시각 — 새로 요청했으면 요청 직전부터, 이미 발송됐으면 2분 전부터. 단 앞 계정이 쓴 메일 시각(floor)보다는 늦게.
export function otpNotBefore({ now, requested, floor = 0 }) {
  const base = requested ? now - 10_000 : now - 2 * 60_000;
  return Math.max(base, floor ? floor + 1 : 0);
}

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
          const meta = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'metadata', metadataHeaders: ['Subject', 'From'] });
          scanned.add(m.id);
          const receivedAt = Number(meta.data.internalDate || 0);
          seen.add(`${header(meta, 'From')} | ${header(meta, 'Subject')}`);
          if (!otpMailUsable({ id: m.id, receivedAt }, { notBeforeMs, usedIds })) continue;
          const full = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'full' });
          const parts = [header(full, 'Subject')];
          const walk = p => { if (p.body?.data) parts.push(Buffer.from(p.body.data, 'base64').toString('utf-8')); (p.parts || []).forEach(walk); };
          walk(full.data.payload || {});
          const code = otpFromText(parts.join('\n'));
          if (code) return { code, id: m.id, receivedAt };
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

export const orderKey =o => String(o.orderNumber ?? o.orderNo ?? o.orderId ?? o.id);

export function mapOrder(o, mallKey) {
  return {
    channel: '29cm', mall_key: mallKey,
    order_id: orderKey(o),
    order_date: o.orderedAt ?? o.orderDate ?? o.paymentCompletedAt ?? null,
    buyer_name: o.ordererName ?? o.buyerName ?? null,
    receiver_name: o.receiverName ?? o.recipientName ?? null,
    receiver_phone: o.receiverPhone ?? null, receiver_address: o.receiverAddress ?? null,
    pay_amount: Number(o.actualSalePrice ?? o.realSalePrice ?? o.salePrice ?? o.paymentAmount ?? 0),
    channel_status: o.orderStatus ?? o.status ?? null, status: 'new', raw: o,
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
