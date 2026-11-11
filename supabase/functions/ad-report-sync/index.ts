// 게시물별 광고리포트 수집기 진입점 — 본문은 handler.ts (GET 만, 테스트는 handler.test.ts)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serviceKey } from "../_shared/keys.ts";
import { handle } from "./handler.ts";

Deno.serve((req) => handle(req, {
  db: createClient(Deno.env.get("SUPABASE_URL")!, serviceKey(), { auth: { persistSession: false } }),
  fetch: (url: string) => fetch(url, { method: "GET" }),
  env: (k: string) => Deno.env.get(k),
}));
