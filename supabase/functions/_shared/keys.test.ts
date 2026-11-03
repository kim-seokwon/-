import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { publishableKey, serviceKey } from "./keys.ts";

function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const old: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) { old[k] = Deno.env.get(k); v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v); }
  try { fn(); } finally { for (const [k, v] of Object.entries(old)) v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v); }
}
const SECRETS = JSON.stringify({ default: "sb_secret_OLD", github_actions: "sb_secret_GH", edge_functions: "sb_secret_NEW" });
const PUBS = JSON.stringify({ default: "sb_publishable_PUB" });

Deno.test("서버 키 = SUPABASE_SECRET_KEYS.edge_functions, 사용자 확인 키 = SUPABASE_PUBLISHABLE_KEYS.default", () => {
  withEnv({ SUPABASE_SECRET_KEYS: SECRETS, SUPABASE_PUBLISHABLE_KEYS: PUBS, SUPABASE_SERVICE_ROLE_KEY: "eyJ.legacy", SUPABASE_ANON_KEY: "eyJ.legacy" }, () => {
    assertEquals(serviceKey(), "sb_secret_NEW");
    assertEquals(publishableKey(), "sb_publishable_PUB");
  });
});
Deno.test("fail-closed: 새 키가 없거나 깨졌거나 형식이 다르면 예전 변수로 돌아가지 않고 오류", () => {
  const legacy = { SUPABASE_SERVICE_ROLE_KEY: "eyJ.legacy", SUPABASE_ANON_KEY: "eyJ.legacy" };
  for (const SUPABASE_SECRET_KEYS of [undefined, "", "{깨짐", "null", "[]", JSON.stringify({ default: "sb_secret_OLD" }), JSON.stringify({ edge_functions: "eyJ.jwt" }), JSON.stringify({ edge_functions: 1 })]) {
    withEnv({ ...legacy, SUPABASE_SECRET_KEYS }, () => assertThrows(() => serviceKey(), Error, "SUPABASE_SECRET_KEYS.edge_functions"));
  }
  for (const SUPABASE_PUBLISHABLE_KEYS of [undefined, "{깨짐", JSON.stringify({ other: "sb_publishable_X" }), JSON.stringify({ default: "eyJ.anon" })]) {
    withEnv({ ...legacy, SUPABASE_PUBLISHABLE_KEYS }, () => assertThrows(() => publishableKey(), Error, "SUPABASE_PUBLISHABLE_KEYS.default"));
  }
});
Deno.test("오류 문장에 키 값이 들어가지 않는다", () => {
  withEnv({ SUPABASE_SECRET_KEYS: JSON.stringify({ edge_functions: "eyJ.SECRETVALUE" }) }, () => {
    try { serviceKey(); } catch (e) { assertEquals(String(e).includes("SECRETVALUE"), false); }
  });
});
Deno.test("함수 코드에 예전 키 변수(SERVICE_ROLE/ANON)를 직접 읽는 곳이 없다", async () => {
  const root = decodeURIComponent(new URL("..", import.meta.url).pathname);
  const hits: string[] = [];
  for await (const d of Deno.readDir(root)) {
    if (!d.isDirectory) continue;
    for await (const f of Deno.readDir(root + d.name)) {
      if (!f.name.endsWith(".ts") || f.name.endsWith(".test.ts")) continue;
      const src = (await Deno.readTextFile(`${root}${d.name}/${f.name}`)).replace(/^\s*\/\/.*$/gm, "");
      if (/"SUPABASE_(SERVICE_ROLE|ANON)_KEY"/.test(src)) hits.push(`${d.name}/${f.name}`);
    }
  }
  assertEquals(hits, []);
});
Deno.test("Actions·봇이 sb_secret 을 Authorization Bearer 로 보내지 않는다(3곳)", async () => {
  const repo = decodeURIComponent(new URL("../../../", import.meta.url).pathname);
  for (const p of [".github/workflows/cafe24-sync.yml", "channel-bots/news/collect.mjs", "channel-bots/telegram/report.mjs"]) {
    const src = (await Deno.readTextFile(repo + p)).split("\n").filter((l) => !/^\s*(#|\/\/)/.test(l)).join("\n");
    assertEquals(/Authorization[^\n]*Bearer[^\n]*(KEY|SERVICE)/i.test(src), false, p);
    assertEquals(/apikey/i.test(src), true, `${p}: apikey 헤더`);
  }
  assertEquals(/x-cron-secret: \$CRON_SECRET/.test(await Deno.readTextFile(repo + ".github/workflows/cafe24-sync.yml")), true);
});
