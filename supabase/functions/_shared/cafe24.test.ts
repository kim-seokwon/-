// ensureToken 동시 갱신 경쟁 테스트: deno test supabase/functions/_shared/cafe24.test.ts
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { ensureToken, MallState, saveMall } from "./cafe24.ts";

const db = null as never; // deps 로 전부 주입하므로 DB 안 씀
const expired = () => new Date(Date.now() - 60_000).toISOString();

function mall(over: Partial<MallState> = {}): MallState {
  return { mall_key: "rohi", channel: "rohi", cafe24_mall_id: "testmall", client_id: "cid", client_secret: "sec",
    access_token: "A0", refresh_token: "R0", expires_at: expired(), last_order_synced_at: null, dry_run: false, ...over };
}

// 카페24 토큰 서버 흉내: refresh_token 은 한 번 쓰면 회전(옛 것 invalid_grant). 응답은 지연시켜 경쟁을 만든다.
function fakeCafe24(dbRow: MallState, delayMs = 20) {
  let cur = dbRow.refresh_token!, n = 0, calls = 0;
  const fetchFn = (async (_u: string, init: RequestInit) => {
    calls++;
    const sent = new URLSearchParams(String(init.body)).get("refresh_token");
    await new Promise(r => setTimeout(r, delayMs));
    if (sent !== cur) return new Response(JSON.stringify({ error: "invalid_grant", error_description: "Invalid refresh_token" }), { status: 400 });
    n++; cur = `R${n}`;
    return new Response(JSON.stringify({ access_token: `A${n}`, refresh_token: cur }), { status: 200 });
  }) as typeof fetch;
  const deps = {
    fetchFn,
    reload: async () => ({ ...dbRow }),
    save: async (_k: string, p: Partial<MallState>) => { await new Promise(r => setTimeout(r, 5)); Object.assign(dbRow, p); },
    sleep: (ms: number) => new Promise<void>(r => setTimeout(r, Math.min(ms, 10))),
  };
  return { deps, calls: () => calls, rotations: () => n };
}

Deno.test("동시 갱신 2건: 진 쪽이 invalid_grant 후 DB 새 토큰 채택, 둘 다 같은 토큰", async () => {
  const row = mall();
  const f = fakeCafe24(row);
  const a = mall(), b = mall(); // 두 실행이 같은 옛 상태를 읽었다
  const [ta, tb] = await Promise.all([ensureToken(db, a, f.deps), ensureToken(db, b, f.deps)]);
  assertEquals(f.calls(), 2);
  assertEquals(f.rotations(), 1);
  assertEquals([ta, tb], ["A1", "A1"]);
  assertEquals([a.refresh_token, b.refresh_token, row.refresh_token], ["R1", "R1", "R1"]);
});

Deno.test("이긴 쪽 저장이 늦어도(재조회 1·2회차엔 옛 값) 3회 안에 채택", async () => {
  const row = mall();
  let reads = 0;
  const deps = {
    fetchFn: (async () => new Response('{"error":"invalid_grant"}', { status: 400 })) as typeof fetch,
    reload: async () => (++reads < 3 ? mall() : mall({ access_token: "A9", refresh_token: "R9", expires_at: new Date(Date.now() + 90 * 60_000).toISOString() })),
    save: async () => { throw new Error("저장하면 안 됨"); },
    sleep: async () => {},
  };
  assertEquals(await ensureToken(db, row, deps), "A9");
  assertEquals(reads, 3);
});

Deno.test("진짜 무효(DB도 그대로): 3회 재조회 후 원래 오류 그대로 던짐", async () => {
  let reads = 0;
  const deps = {
    fetchFn: (async () => new Response('{"error":"invalid_grant","error_description":"Invalid refresh_token"}', { status: 400 })) as typeof fetch,
    reload: async () => { reads++; return mall(); },
    sleep: async () => {},
  };
  await assertRejects(() => ensureToken(db, mall(), deps), Error, "토큰 갱신 실패 400");
  assertEquals(reads, 3);
});

Deno.test("DB 토큰이 바뀌었어도 만료된 것이면 채택 안 함", async () => {
  const deps = {
    fetchFn: (async () => new Response('{"error":"invalid_grant"}', { status: 400 })) as typeof fetch,
    reload: async () => mall({ access_token: "A5", refresh_token: "R5", expires_at: expired() }),
    sleep: async () => {},
  };
  await assertRejects(() => ensureToken(db, mall(), deps), Error, "토큰 갱신 실패 400");
});

Deno.test("invalid_grant 아닌 실패(500·401)는 재조회 없이 바로 던짐", async () => {
  for (const status of [500, 401]) {
    let reads = 0;
    const deps = {
      fetchFn: (async () => new Response("server error", { status })) as typeof fetch,
      reload: async () => { reads++; return mall(); },
      sleep: async () => {},
    };
    await assertRejects(() => ensureToken(db, mall(), deps), Error, `토큰 갱신 실패 ${status}`);
    assertEquals(reads, 0);
  }
});

Deno.test("유효 토큰이면 갱신 안 함 · 정상 갱신은 저장하고 메모리도 새 토큰", async () => {
  const valid = mall({ expires_at: new Date(Date.now() + 60 * 60_000).toISOString() });
  const f0 = fakeCafe24(mall());
  assertEquals(await ensureToken(db, valid, f0.deps), "A0");
  assertEquals(f0.calls(), 0);
  const row = mall(), st = mall();
  const f = fakeCafe24(row, 0);
  assertEquals(await ensureToken(db, st, f.deps), "A1");
  assertEquals([row.refresh_token, st.refresh_token], ["R1", "R1"]);
  // 같은 실행에서 다시 불러도 옛 R0 로 재갱신하지 않는다
  assertEquals(await ensureToken(db, st, f.deps), "A1");
  assertEquals(f.calls(), 1);
});

Deno.test("복구 분기도 일반 재사용 규칙: 5분·180분 남은 새 토큰은 채택 안 함", async () => {
  for (const min of [5, 180]) {
    const deps = {
      fetchFn: (async () => new Response('{"error":"invalid_grant"}', { status: 400 })) as typeof fetch,
      reload: async () => mall({ access_token: "A7", refresh_token: "R7", expires_at: new Date(Date.now() + min * 60_000).toISOString() }),
      sleep: async () => {},
    };
    await assertRejects(() => ensureToken(db, mall(), deps), Error, "토큰 갱신 실패 400");
  }
});

Deno.test("새 토큰 저장 실패: 3회 재시도 후 던지고 메모리는 옛 토큰 그대로", async () => {
  let saves = 0;
  const st = mall();
  const deps = {
    fetchFn: (async () => new Response(JSON.stringify({ access_token: "A1", refresh_token: "R1" }), { status: 200 })) as typeof fetch,
    save: async () => { saves++; throw new Error("DB WRITE FAILED"); },
    sleep: async () => {},
  };
  await assertRejects(() => ensureToken(db, st, deps), Error, "DB 저장 실패");
  assertEquals(saves, 3);
  assertEquals([st.access_token, st.refresh_token], ["A0", "R0"]);
});

Deno.test("저장 2회차에 성공하면 정상 반환", async () => {
  let saves = 0;
  const st = mall();
  const deps = {
    fetchFn: (async () => new Response(JSON.stringify({ access_token: "A1", refresh_token: "R1" }), { status: 200 })) as typeof fetch,
    save: async () => { if (++saves < 2) throw new Error("일시 오류"); },
    sleep: async () => {},
  };
  assertEquals(await ensureToken(db, st, deps), "A1");
  assertEquals([saves, st.refresh_token], [2, "R1"]);
});

Deno.test("saveMall: Supabase update 가 error 를 돌려주면 던짐", async () => {
  const fake = { from: () => ({ update: () => ({ eq: async () => ({ error: { message: "DB WRITE FAILED" } }) }) }) } as never;
  await assertRejects(() => saveMall(fake, "rohi", { access_token: "A1" }), Error, "DB WRITE FAILED");
  const ok = { from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }) } as never;
  await saveMall(ok, "rohi", { access_token: "A1" });
});
