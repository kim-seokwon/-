import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";

const cors = (extra: Record<string, string> = {}) => ({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  ...extra,
});

const SPECS: Record<string, { required: string[]; optional?: string[] }> = {
  cafe24: { required: ["mall_id", "client_id", "client_secret"] },
  musinsa: { required: ["account_id", "password"] },
  "29cm": { required: ["account_id", "password"], optional: ["otp_email"] },
  kidikidi: { required: ["account_id", "password"], optional: ["totp_secret"] },
  smartstore: { required: ["client_id", "client_secret"] },
};

const safeKey = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 36);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: cors({ "Content-Type": "application/json" }),
  });
  const auth = await requireUser(req, { master: true });
  if (auth instanceof Response) return auth;

  try {
    const body = await req.json();
    const brandId = String(body.brand_id || "");
    const channel = String(body.channel || "").toLowerCase();
    const input = body.credentials && typeof body.credentials === "object" ? body.credentials : {};
    const spec = SPECS[channel];
    if (!brandId || !spec) return json({ ok: false, error: "브랜드 또는 채널이 올바르지 않습니다" }, 400);

    const allowed = [...spec.required, ...(spec.optional || [])];
    const credentials: Record<string, string> = {};
    for (const key of allowed) {
      const value = String(input[key] || "").trim();
      if (value) credentials[key] = value;
    }
    const missing = spec.required.filter(k => !credentials[k]);
    if (missing.length) return json({ ok: false, error: `필수 정보가 빠졌습니다: ${missing.join(", ")}` }, 400);

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: brand, error: brandErr } = await db.from("brands").select("id,name").eq("id", brandId).single();
    if (brandErr || !brand) return json({ ok: false, error: "브랜드를 찾을 수 없습니다" }, 404);

    const mallKey = `${channel}_${safeKey(brand.name) || brandId.slice(0, 8)}`;
    const status = channel === "cafe24" ? "auth_required" : "credentials_saved";
    const mall = {
      mall_key: mallKey, label: `${brand.name} ${channel.toUpperCase()}`,
      channel, cafe24_mall_id: credentials.mall_id || null,
      brand_id: brandId, active: true, connected: false,
    };
    const { error: mallErr } = await db.from("malls").upsert(mall, { onConflict: "mall_key" });
    if (mallErr) throw mallErr;

    if (channel === "cafe24") {
      const { error } = await db.from("channel_sync_state").upsert({
        mall_key: mallKey, channel, cafe24_mall_id: credentials.mall_id,
        client_id: credentials.client_id, client_secret: credentials.client_secret, dry_run: true,
      }, { onConflict: "mall_key" });
      if (error) throw error;
    }
    const { error: credErr } = await db.from("channel_credentials").upsert({
      brand_id: brandId, mall_key: mallKey, channel, credentials, status,
      last_error: null, updated_at: new Date().toISOString(),
    }, { onConflict: "brand_id,channel" });
    if (credErr) throw credErr;

    return json({ ok: true, mall_key: mallKey, status, next: channel === "cafe24" ? "oauth" : "verification" });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
