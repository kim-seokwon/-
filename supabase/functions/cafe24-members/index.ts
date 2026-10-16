// 카페24 몰별 전체 회원수 일 1회 스냅샷 → cafe24_member_counts (085)
//  탈퇴는 따로 추적하지 않는다 — 회원수 증감으로 본다(10-16 사장님).
//  호출: pg_cron(x-cron-secret) 또는 마스터 로그인. POST {} → 활성 몰 전체, {mall:키} → 그 몰만.
//  필요 권한: mall.read_privacy (GET /customersprivacy/count). 없으면 몰별 결과에 재인증 안내가 남는다.
import { admin, cafe24Fetch, cors, ensureToken, getActiveMalls, getMall, log, MallState } from "../_shared/cafe24.ts";
import { requireUser } from "../_shared/auth.ts";
import { explain, kstDate, parseCount } from "./count.ts";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: cors({ "Content-Type": "application/json" }) });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });
  const cronSecret = Deno.env.get("CRON_SECRET") || "";
  const provided = (req.headers.get("x-cron-secret") || "").trim();
  const isCron = cronSecret.length > 0 && provided.length === cronSecret.length && provided === cronSecret;
  if (!isCron) {
    const auth = await requireUser(req, { master: true });
    if (auth instanceof Response) return auth;
  }
  const db = admin();
  let body: { mall?: string } = {};
  try { body = await req.json(); } catch { /* no body */ }
  const malls = body.mall
    ? [await getMall(db, body.mall)].filter((m): m is MallState => !!m && !!m.access_token)
    : await getActiveMalls(db);
  const snap = kstDate();
  const results: unknown[] = [];
  for (const m of malls) {
    if (m.channel && m.channel !== "cafe24") continue;
    try {
      if (!m.cafe24_mall_id) throw new Error("cafe24_mall_id 없음");
      const token = await ensureToken(db, m);
      const total = parseCount(await cafe24Fetch(m.cafe24_mall_id, token, "/api/v2/admin/customersprivacy/count"));
      const { error } = await db.from("cafe24_member_counts").upsert({ mall_key: m.mall_key, snap_date: snap, total, collected_at: new Date().toISOString() });
      if (error) throw new Error(`저장 실패: ${error.message}`);
      results.push({ mall: m.mall_key, ok: true, total });
    } catch (e) {
      const msg = explain(String((e as Error)?.message || e));
      await log(db, m.mall_key, "members", "error", { message: msg });
      results.push({ mall: m.mall_key, ok: false, error: msg });
    }
  }
  return json({ ok: results.every((r) => (r as { ok: boolean }).ok), snap_date: snap, results });
});
