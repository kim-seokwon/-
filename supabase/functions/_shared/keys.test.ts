import { assertEquals } from "jsr:@std/assert@1";
import { serviceKey } from "./keys.ts";

function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const old: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) { old[k] = Deno.env.get(k); v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v); }
  try { fn(); } finally { for (const [k, v] of Object.entries(old)) v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v); }
}

Deno.test("새 키(edge_functions)가 있으면 그것을 쓴다", () => {
  withEnv({ SUPABASE_SECRET_KEYS: JSON.stringify({ default: "OLD", github_actions: "GH", edge_functions: "NEW" }), SUPABASE_SERVICE_ROLE_KEY: "OLD" },
    () => assertEquals(serviceKey(), "NEW"));
});
Deno.test("새 키가 없거나 JSON 이 깨졌으면 예전 변수", () => {
  withEnv({ SUPABASE_SECRET_KEYS: JSON.stringify({ default: "OLD" }), SUPABASE_SERVICE_ROLE_KEY: "OLD" }, () => assertEquals(serviceKey(), "OLD"));
  withEnv({ SUPABASE_SECRET_KEYS: "{깨짐", SUPABASE_SERVICE_ROLE_KEY: "OLD" }, () => assertEquals(serviceKey(), "OLD"));
  withEnv({ SUPABASE_SECRET_KEYS: undefined, SUPABASE_SERVICE_ROLE_KEY: "OLD" }, () => assertEquals(serviceKey(), "OLD"));
});
Deno.test("함수 코드에 예전 변수를 직접 읽는 곳이 없다", async () => {
  const root = decodeURIComponent(new URL("..", import.meta.url).pathname);
  const hits: string[] = [];
  for await (const d of Deno.readDir(root)) {
    if (!d.isDirectory) continue;
    for await (const f of Deno.readDir(root + d.name)) {
      if (!f.name.endsWith(".ts") || f.name.endsWith(".test.ts") || (d.name === "_shared" && f.name === "keys.ts")) continue;
      if ((await Deno.readTextFile(`${root}${d.name}/${f.name}`)).includes('"SUPABASE_SERVICE_ROLE_KEY"')) hits.push(`${d.name}/${f.name}`);
    }
  }
  assertEquals(hits, []);
});
