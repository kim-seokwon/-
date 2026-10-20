// 인스타그램 수집기 진입점 — 본문은 handler.ts (우리 계정 ig_snapshots + 경쟁사 competitors.ts)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handle } from "./handler.ts";

Deno.serve((req) => handle(req, {
  db: createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } }),
  fetch: (url: string) => fetch(url),
  env: (k: string) => Deno.env.get(k),
}));
