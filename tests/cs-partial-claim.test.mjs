//  CS 부분 반품·교환(10-27) + 잘못 쓴 CS 지우기 — csItems.js 순수 함수 · main.js 연결 · 098(PGlite)
//  사례(운영 읽기 전용 조회 10-27): 20261014-0009355 = 6줄 중 3줄만 R30(claim_quantity "0") · 20261026-0000049 = 2줄 N30(클레임 전)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { itemsSummary, partLabel, pickPlan, itemsPatch, lineKey, canTrash, CLAIM_LABEL } from '../csItems.js';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const MAIN = read('../main.js');

const L = (name, option, status = 'N40', claim = null, code = null) => ({ code, name, option, qty: 1, status, claim, reason: null });

test('csItems: 요약은 같은 이름 ×수량 · 부분 표시는 일부일 때만', () => {
    assert.equal(itemsSummary([L('Vintage Chino Pants', 'a'), L('Vintage Chino Pants', 'b'), L('Mellow pants', 'c')]),
        'Vintage Chino Pants ×2, Mellow pants');
    assert.equal(itemsSummary([]), null);
    assert.equal(partLabel([1, 2, 3], 6), '6개 중 3개');
    assert.equal(partLabel([1, 2], 2), '', '전부면 표시 없음');
    assert.equal(partLabel(null, 6), '');
});

test('csItems: 클레임 줄 있으면 그 줄만 · 1줄 자동 · 여러 줄은 고르기 · 직원이 고른 건 auto 기록 없음', () => {
    const lines = [L('A', 'x', 'R30', 'C1', '01'), L('B', 'y', 'N40', null, '02'), L('C', 'z', 'R30', 'C1', '03')];
    const claim = [lines[0], lines[2]];
    assert.deepEqual(pickPlan({ lines, claim, kind: '반품' }), { mode: 'claim', items: claim, kind: '반품', total: 3 });
    assert.equal(pickPlan({ lines: [lines[1]], claim: [] }).mode, 'one');
    assert.equal(pickPlan({ lines, claim: [] }).mode, 'choose');
    assert.equal(pickPlan(null).mode, 'none');
    const auto = itemsPatch(claim, 3, true);
    assert.equal(auto.product_name, 'A, C'); assert.equal(auto.items_total, 3);
    assert.deepEqual(auto.auto, { items: auto.items, product_name: 'A, C' });
    assert.equal(itemsPatch(claim, 3, false).auto, null);
    assert.equal(lineKey(lines[0], 0), 'c:01'); assert.equal(lineKey(L('X'), 4), 'i:4');
    assert.equal(CLAIM_LABEL('R30'), '반품 신청'); assert.equal(CLAIM_LABEL('E10'), '교환 신청'); assert.equal(CLAIM_LABEL('N40'), '');
});

test('csItems: 지우기 — 완료건 안 됨 · 작성자 본인 또는 관리자', () => {
    const t = { status: '접수', created_by: '조영신', created_by_uid: 'u-sin' };
    assert.ok(canTrash(t, { id: 'u-sin', role: 'STAFF', name: '조영신' }));
    assert.ok(!canTrash(t, { id: 'u-young', role: 'STAFF', name: '안소영' }));
    assert.ok(!canTrash(t, { id: 'u-sin2', role: 'STAFF', name: '조영신' }), '동명이인 안 됨 — 이름이 아니라 로그인 id');
    assert.ok(!canTrash({ ...t, created_by: '안소영' }, { id: 'u-young', role: 'STAFF', name: '안소영' }), '이름 바꿔치기 안 됨');
    assert.ok(canTrash(t, { id: 'u-bk', role: 'MASTER', name: '방보경' }));
    assert.ok(!canTrash({ ...t, status: '완료' }, { id: 'u-bk', role: 'MASTER', name: '방보경' }));
    assert.ok(!canTrash({ status: '접수', created_by: '조영신', created_by_uid: null }, { id: 'u-sin', role: 'STAFF', name: '조영신' }), '098 이전 행은 관리자만');
});

test('main.js 연결: 끌어올 때 cs_order_pick · 상세 신청 상품/고르기/삭제(위임 클릭) · 목록 부분 표시 · 앱 안 확인창', () => {
    assert.match(MAIN, /this\.supabase\.rpc\('cs_order_pick', \{ p_order: o\.id \}\)/);
    const add = MAIN.slice(MAIN.indexOf('async addCS(kind)'), MAIN.indexOf('async setCSStatus('));
    assert.match(add, /const it = await this\._csItemsFor\(found, kind\); if \(!it\) return;[\s\S]*\.\.\.it,/);
    const addO = MAIN.slice(MAIN.indexOf('async addCSForOrder('), MAIN.indexOf('async addCS(kind)'));
    assert.match(addO, /const it = await this\._csItemsFor\(found, kind\); if \(!it\) return;[\s\S]*\.\.\.it,/);
    assert.match(MAIN, /data-cs-act="trash" data-id="\$\{esc\(String\(t\.id\)\)\}">삭제<\/button>/);
    assert.match(MAIN, /\$\{canTrash\(t, this\.currentUser\) \? `<button/);
    assert.match(MAIN, /if \(act === 'trash'\) this\.csTrash\(id\);/);
    assert.match(MAIN, /this\.supabase\.rpc\('cs_trash', \{ p_id: t\.id \}\)/);
    assert.match(MAIN, /this\.supabase\.rpc\('cs_restore', \{ p_id: id \}\)/);
    const trash = MAIN.slice(MAIN.indexOf('async csTrash(id)'), MAIN.indexOf('async csRestore('));
    assert.match(trash, /await this\.showConfirm\(/); assert.doesNotMatch(trash, /[^.]confirm\(/, '브라우저 confirm 금지');
    assert.match(trash, /esc\(t\.customer_name/, '확인창 문구의 고객 이름은 이스케이프');
    assert.match(MAIN, /partLabel\(t\.items, t\.items_total\)/);
    assert.doesNotMatch(MAIN.slice(MAIN.indexOf('_csPicker(lines'), MAIN.indexOf('async csPickItems(')), /onclick="app\./, '고르기 창은 값 박은 onclick 없음');
    // 10-30 담기 먹통: 안쪽 상자가 stopPropagation 하므로 버튼은 안쪽 상자에서 받아야 한다
    assert.match(MAIN.slice(MAIN.indexOf('_csPicker(lines'), MAIN.indexOf('async csPickItems(')), /box\.onclick = e => \{\s*e\.stopPropagation\(\);\s*const b = e\.target\.closest\?\.\('\[data-cs-pick\]'\)/, '고르기 버튼은 안쪽 상자에서 받는다');
});

test('098 정적: 되돌리기 파일 · RPC 권한 · 트리거는 raw 줄이 바뀔 때만', () => {
    const up = read('../supabase/migrations/098_cs_partial_claim.sql'), down = read('../supabase/rollbacks/098_cs_partial_claim.down.sql');
    assert.match(up, /after update of raw on public\.channel_orders\s+for each row when \(old\.raw->'items' is distinct from new\.raw->'items'\)/);
    assert.match(up, /revoke all on function public\.cs_trash\(uuid\) from public, anon;/);
    assert.match(up, /alter table public\.cs_tickets_trash enable row level security;/);
    assert.doesNotMatch(up, /create policy[^;]*cs_tickets_trash/, '휴지통은 RPC 로만');
    assert.match(down, /drop trigger if exists trg_channel_orders_cs_claim/);
    assert.match(down, /insert into public\.cs_tickets select[\s\S]*from public\.cs_tickets_trash/, '롤백 때 지운 CS 를 먼저 돌려놓음');
    assert.doesNotMatch(down, /drop column/, '고른 신청 상품 기록은 남김');
});

test('098 부분 클레임 · 나중 도착 · 직원 값 보존 · 지우기/되돌리기(PGlite)', { skip: !process.env.PGLITE_PATH && 'PGLITE_PATH 없음 — 건너뜀' }, async () => {
    const { PGlite } = await import(pathToFileURL(process.env.PGLITE_PATH).href);
    const db = new PGlite();
    //  운영 칸(10-27 information_schema 읽기 전용 조회) 중 쓰는 것 + 운영 날짜 가드 원문 + 로그인 흉내(auth.jwt)
    await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub', '')::uuid $$;
create function current_username() returns text language sql stable as $$ select split_part(auth.jwt()->>'email','@',1) $$;
create table companies (username text primary key, name text, role text);
insert into companies values ('sin','조영신','STAFF'), ('young','안소영','STAFF'), ('bokyung','방보경','MASTER'), ('sin2','조영신','STAFF');
create table malls (mall_key text primary key, brand_id uuid);
insert into malls values ('hiheiho', '11111111-1111-4111-8111-111111111111'), ('kidikidi', null);
create table channel_orders (id uuid primary key default gen_random_uuid(), channel text default 'cafe24', order_id text,
  order_date timestamptz, buyer_name text, receiver_name text, mall_key text references malls(mall_key), raw jsonb);
create table channel_order_items (id uuid primary key default gen_random_uuid(),
  channel_order_id uuid references channel_orders(id) on delete cascade, product_name text, option_name text, quantity int default 1);
create table cs_tickets (id uuid primary key default gen_random_uuid(),
  occurred_on date not null default ((now() at time zone 'Asia/Seoul'))::date, customer_name text not null, kind text not null default '교환',
  status text not null default '접수', purchase_from text, contact_channel text, brand_id uuid, order_no text,
  channel_order_id uuid references channel_orders(id) on delete set null, product_name text, exchange_product text,
  invoice_no text, memo text, created_by text, created_at timestamptz not null default now(), resolved_at timestamptz,
  date_suspect boolean default false);
create function cs_tickets_guard_date() returns trigger language plpgsql security definer set search_path = public as $$
declare od date;
begin
  if new.channel_order_id is null or new.occurred_on is null then new.date_suspect := false; return new; end if;
  select (o.order_date at time zone 'Asia/Seoul')::date into od from channel_orders o where o.id = new.channel_order_id;
  if od is null then new.date_suspect := false; return new; end if;
  if new.occurred_on < od then
    if tg_op = 'INSERT' or new.occurred_on is distinct from old.occurred_on
       or new.channel_order_id is distinct from old.channel_order_id then
      raise exception '접수일(%)이 주문일(%)보다 빠릅니다.', new.occurred_on, od;
    end if;
    new.date_suspect := true;
  else new.date_suspect := false; end if;
  return new;
end $$;
create trigger trg_cs_tickets_guard_date before insert or update on cs_tickets for each row execute function cs_tickets_guard_date();
`);
    for (const f of ['095_cs_fill_from_order', '096_cs_order_no_norm']) await db.exec(read(`../supabase/migrations/${f}.sql`));
    //  is_master — 087/092 와 같은 본문
    await db.exec(`create function is_master() returns boolean language sql stable security definer set search_path = public as $$
      select exists (select 1 from companies where username = split_part(auth.jwt()->>'email', '@', 1) and role = 'MASTER') $$;`);
    const up = read('../supabase/migrations/098_cs_partial_claim.sql');
    await db.exec(up); await db.exec(up);                                         // 두 번 깔아도 선다

    const raw = rows => ({ items: rows.map(([code, name, option, st, claim]) => ({
        order_item_code: code, product_name: name, option_value: option, quantity: '1', order_status: st,
        claim_code: claim, claim_quantity: '0', claim_reason: null })) });
    //  9355 — 운영 6줄 그대로(3줄 R30)
    const R9355 = [
        ['20261014-0009355-01', 'Vintage Chino Pants', '배송=일반배송, color=브라운, size=XL', 'R30', 'C20261026-0006175'],
        ['20261014-0009355-02', 'Vintage Chino Pants', '배송=일반배송, color=크림, size=S', 'R30', 'C20261026-0006175'],
        ['20261014-0009355-03', 'Classic Blouson', '배송=일반배송 (10/22 출고), color=네이비, size=M', 'N40', null],
        ['20261014-0009355-04', 'Classic Blouson', '배송=일반배송 (10/22 출고), color=크림, size=L', 'N40', null],
        ['20261014-0009355-05', 'Mellow pants', '배송일=일반배송 (3-5일 소요), color=캔디블루, size=M', 'R30', 'C20261026-0006175'],
        ['20261014-0009355-06', 'Mellow pants', '배송일=일반배송 (3-5일 소요), color=브라운, size=XL', 'N40', null],
    ];
    const order = async (no, rows, at = '2026-10-14T03:00:00Z') => {
        const id = (await db.query(`insert into channel_orders (order_id, mall_key, order_date, receiver_name, raw)
            values ($1,'hiheiho',$2,'고객',$3) returning id`, [no, at, raw(rows)])).rows[0].id;
        await db.query(`insert into channel_order_items (channel_order_id, product_name, option_name)
            select $1, x->>0, x->>1 from jsonb_array_elements($2::jsonb) x`, [id, JSON.stringify(rows.map(r => [r[1], r[2]]))]);
        return id;
    };
    const restatus = (id, rows) => db.query(`update channel_orders set raw = $2 where id = $1`, [id, raw(rows)]);
    const cs = async (no, extra = {}) => (await db.query(
        `insert into cs_tickets (order_no, customer_name, kind, product_name, items, created_by, occurred_on, status, channel_order_id, auto_fill)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
        [no, extra.name ?? '(이름없음)', extra.kind ?? '반품', extra.product ?? null, extra.items ? JSON.stringify(extra.items) : null,
         extra.by ?? '조영신', extra.on ?? '2026-10-27', extra.status ?? '접수', extra.order ?? null,
         extra.auto ? JSON.stringify(extra.auto) : null])).rows[0].id;
    const get = async id => (await db.query(`select * from cs_tickets where id = $1`, [id])).rows[0];
    const pick = async id => (await db.query(`select cs_order_pick($1) p`, [id])).rows[0].p;

    // 1) 9355형: 화면이 부르는 판정 = 6줄 중 클레임 3줄만 · 종류 반품 · 수량 claim_quantity 0 → 주문 수량 1
    const o1 = await order('20261014-0009355', R9355);
    let p = await pick(o1);
    assert.equal(p.total, 6); assert.equal(p.claim.length, 3); assert.equal(p.kind, '반품');
    assert.deepEqual(p.claim.map(c => c.code.slice(-2)), ['01', '02', '05']);
    assert.ok(p.claim.every(c => c.qty === 1 && !('cq' in c)));
    assert.equal(p.summary, 'Vintage Chino Pants ×2, Mellow pants');
    assert.equal(p.summary, itemsSummary(p.claim), 'SQL 요약 = 화면 요약');

    // 2) 접수가 먼저, 주문(클레임 있음)이 나중 → 신청 3줄만 채움
    const tA = await cs('20261014-0009356');
    const oA = await order('20261014-0009356', R9355);
    let r = await get(tA);
    assert.equal(r.channel_order_id, oA); assert.equal(r.items.length, 3); assert.equal(r.items_total, 6);
    assert.equal(r.product_name, 'Vintage Chino Pants ×2, Mellow pants');
    assert.ok(r.auto_fill.items && r.auto_fill.product_name, '자동 기록');

    // 3) 0049형: 클레임 전 접수 → 예전처럼 앞 3개 + 총 줄 수(화면은 체크 목록) · 나중에 카페24 클레임(restatus raw 갱신) → 신청 줄로 바로잡음
    const R0049 = [['20261026-0000049-01', '곰돌이 니트', 'color=차콜, size=6M', 'N30', null],
                   ['20261026-0000049-02', '멜빵바지', 'color=크림, size=6M', 'N30', null]];
    const tB = await cs('20261026-0000049', { kind: '교환', on: '2026-10-26' });
    const o2 = await order('20261026-0000049', R0049, '2026-10-26T03:11:00Z');
    p = await pick(o2); assert.equal(p.claim.length, 0); assert.equal(p.lines.length, 2); assert.equal(p.kind, null);
    r = await get(tB);
    assert.equal(r.product_name, '곰돌이 니트, 멜빵바지'); assert.equal(r.items, null); assert.equal(r.items_total, 2);
    await restatus(o2, R0049);                                                    // 줄 그대로 재수집 → 그대로
    assert.equal((await get(tB)).product_name, '곰돌이 니트, 멜빵바지');
    await restatus(o2, [R0049[0], ['20261026-0000049-02', '멜빵바지', 'color=크림, size=6M', 'E10', 'C20261027-0000001']]);
    r = await get(tB);
    assert.deepEqual(r.items.map(i => i.name), ['멜빵바지'], '나중 클레임 1줄로 바로잡음');
    assert.equal(r.items_total, 2); assert.equal(r.product_name, '멜빵바지'); assert.equal(r.kind, '교환', '유형은 직원 값 그대로');

    // 4) 직원 값 보존 — 직원이 고른 줄(auto 기록 없음) · 직원이 적은 상품은 클레임이 와도 안 덮음
    const picked = [{ code: '20261014-0009357-03', name: 'Classic Blouson', option: 'x', qty: 1 }];
    const oD = await order('20261014-0009357', R9355.map(x => [...x.slice(0, 3), 'N40', null]));
    const tD = await cs('20261014-0009357', { order: oD, product: 'Classic Blouson', items: picked });
    const tE = await cs('20261014-0009357', { order: oD, product: '직원이 적은 상품' });
    await restatus(oD, R9355);
    assert.deepEqual((await get(tD)).items, picked); assert.equal((await get(tD)).product_name, 'Classic Blouson');
    assert.equal((await get(tE)).product_name, '직원이 적은 상품'); assert.equal((await get(tE)).items, null);
    //  자동으로 채운 값(화면 claim 자동 = auto_fill 기록)은 클레임이 바뀌면 따라간다
    const autoItems = [{ code: '20261014-0009357-01', name: 'Vintage Chino Pants', option: 'x', qty: 1 }];
    const tF = await cs('20261014-0009357', { order: oD, product: 'Vintage Chino Pants', items: autoItems,
        auto: { items: autoItems, product_name: 'Vintage Chino Pants' } });
    await restatus(oD, R9355.map((x, i) => i === 2 ? [...x.slice(0, 3), 'R10', 'C9'] : x));
    r = await get(tF); assert.equal(r.items.length, 4, '자동값은 최신 클레임 줄로');

    // 5) 지우기 — 작성자 본인 · 관리자 / 남의 것·완료건 거절 / 되돌리면 같은 id · 집계에서 빠짐
    //  작성자 = 로그인 id(auth.uid) — 표시 이름은 누구나 고칠 수 있고(cs_update 정책 true) 동명이인(sin2 = 조영신)도 있다
    const UID = { sin: '00000000-0000-4000-8000-00000000000a', young: '00000000-0000-4000-8000-00000000000b',
                  bokyung: '00000000-0000-4000-8000-00000000000c', sin2: '00000000-0000-4000-8000-00000000000d' };
    const as = (u) => db.exec(`select set_config('request.jwt.claims', '${JSON.stringify({ email: u + '@x', sub: UID[u] })}', false)`);
    const tLegacy = await cs('20261014-0009355', { order: o1, by: '조영신' });             // 098 전 행 흉내(로그인 id 없음)
    await as('sin');
    const tG = await cs('20261014-0009355', { order: o1, by: '조영신' });
    const tH = await cs('20261014-0009355', { order: o1, by: '조영신', status: '완료' });
    assert.equal((await get(tG)).created_by_uid, UID.sin, '서버가 로그인 id 를 찍음');
    await db.query(`insert into cs_tickets (order_no, customer_name, created_by, created_by_uid) values ('fake','x','안소영',$1)`, [UID.young]);
    assert.equal((await db.query(`select created_by_uid from cs_tickets where order_no='fake'`)).rows[0].created_by_uid, UID.sin, '넣을 때 남의 id 못 박음');
    await as('young');
    await assert.rejects(db.query(`select cs_trash($1)`, [tG]), /직접 쓴 CS 만/);
    //  우회 ①: 작성자 이름·id 를 자기로 바꿔치기 → id 는 그대로 → 여전히 거절
    await db.query(`update cs_tickets set created_by = '안소영', created_by_uid = $2 where id = $1`, [tG, UID.young]);
    r = await get(tG); assert.equal(r.created_by, '안소영'); assert.equal(r.created_by_uid, UID.sin, '작성자 id 는 못 고침');
    await assert.rejects(db.query(`select cs_trash($1)`, [tG]), /직접 쓴 CS 만/, '이름 바꿔치기로 못 지움');
    await db.query(`update cs_tickets set created_by = '조영신' where id = $1`, [tG]);
    //  우회 ②: 동명이인
    await as('sin2');
    await assert.rejects(db.query(`select cs_trash($1)`, [tG]), /직접 쓴 CS 만/, '동명이인은 못 지움');
    //  098 전 행: 이름이 같아도 직원은 못 지움(관리자만)
    await assert.rejects(db.query(`select cs_trash($1)`, [tLegacy]), /직접 쓴 CS 만/);
    await as('sin');
    await assert.rejects(db.query(`select cs_trash($1)`, [tLegacy]), /직접 쓴 CS 만/);
    await assert.rejects(db.query(`select cs_trash($1)`, [tH]), /완료된 CS 는 지울 수 없습니다/);
    const before = (await db.query(`select count(*)::int n from cs_tickets`)).rows[0].n;
    await db.query(`select cs_trash($1)`, [tG]);
    assert.equal((await db.query(`select count(*)::int n from cs_tickets`)).rows[0].n, before - 1, '목록·집계에서 빠짐');
    await as('young');
    await assert.rejects(db.query(`select cs_restore($1)`, [tG]), /지운 사람만/);
    await as('sin2');
    await assert.rejects(db.query(`select cs_restore($1)`, [tG]), /지운 사람만/, '동명이인은 못 되돌림');
    await as('sin');
    await db.query(`select cs_restore($1)`, [tG]);
    r = await get(tG); assert.equal(r.created_by, '조영신'); assert.equal(r.status, '접수'); assert.equal(r.created_by_uid, UID.sin);
    await as('bokyung');                                                          // 관리자는 남의 것도 · 098 전 행도
    await db.query(`select cs_trash($1)`, [tG]); await db.query(`select cs_restore($1)`, [tG]);
    assert.equal((await get(tG)).created_by_uid, UID.sin, '관리자가 되돌려도 작성자는 원래 사람');
    await db.query(`select cs_trash($1)`, [tLegacy]); await db.query(`select cs_restore($1)`, [tLegacy]);
    //  옛 날짜 의심건(접수일<주문일)도 되돌릴 수 있다 — 가드는 새로 넣을 때만 막는다
    const tI = await cs('20261014-0009355', { on: '2026-10-20' });
    await db.exec(`alter table cs_tickets disable trigger trg_cs_tickets_guard_date`);   // 운영 124건 같은 옛 행 흉내
    await db.query(`update cs_tickets set occurred_on = '2026-10-01', channel_order_id = $2, date_suspect = true where id = $1`, [tI, o1]);
    await db.exec(`alter table cs_tickets enable trigger trg_cs_tickets_guard_date`);
    await db.query(`select cs_trash($1)`, [tI]);
    await db.query(`select cs_restore($1)`, [tI]);
    r = await get(tI); assert.equal(r.date_suspect, true); assert.equal(r.channel_order_id, o1);
    await assert.rejects(db.query(`insert into cs_tickets (order_no, customer_name, occurred_on, channel_order_id) values ('n','n','2026-10-01',$1)`, [o1]),
        /접수일/, '되돌리기 밖에서는 가드 그대로');
    await assert.rejects(db.query(`select cs_trash($1)`, ['00000000-0000-4000-8000-000000000000']), /없는 CS/);

    // 6) 되돌리기 파일: 휴지통 건은 돌려놓고 걷는다 · 다시 깔 수 있다
    await db.query(`select cs_trash($1)`, [tG]);
    await db.exec(read('../supabase/rollbacks/098_cs_partial_claim.down.sql'));
    assert.ok(await get(tG), '롤백 때 지운 CS 복귀');
    await db.exec(up);
});
