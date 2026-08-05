// ============================================================
//  계정 관리 (admin-users) — 마스터 전용
//  브라우저에서 supabase.auth.signUp() 으로 계정을 만들면
//   · 만든 사람(마스터)의 세션이 새 계정으로 바뀌어 로그아웃된 것처럼 보이고
//   · 이메일 확인이 켜져 있으면 auth 사용자가 아예 안 생겨 로그인 자체가 안 된다.
//  → 계정 생성·비밀번호 변경·삭제는 service_role 이 필요한 admin API 라 서버에서 처리한다.
//
//  POST { action: "create",       name, username, password, role, brand_id?, menu_access?, brand_access? }
//  POST { action: "set-password", company_id | username, password }
//  POST { action: "delete",       company_id }
//  POST { action: "list" }        → companies + auth 연결 여부
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";

const cors = (extra: Record<string, string> = {}) => ({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  ...extra,
});

const admin = () => createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const emailOf = (username: string) => (username.includes("@") ? username : `${username}@bhas.com`);
const validPassword = (password: unknown) => {
  const value = String(password || "");
  // 직원 계정: 최소 10자 + 영문 + 숫자. 화면/로그에 비밀번호는 절대 기록하지 않는다.
  return value.length >= 10 && /[A-Za-z]/.test(value) && /\d/.test(value);
};

// 이메일로 auth 사용자 찾기 (admin API 에 email 단건 조회가 없어 페이지를 훑는다)
async function findAuthUser(db: ReturnType<typeof admin>, email: string) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = (data?.users || []).find((u) => (u.email || "").toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if (!data?.users?.length || data.users.length < 200) return null;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });
  const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: cors({ "Content-Type": "application/json" }) });

  // 계정 생성·비번변경·삭제는 마스터만
  const auth = await requireUser(req, { master: true });
  if (auth instanceof Response) return auth;

  const db = admin();
  let body: Record<string, any> = {};
  try { body = await req.json(); } catch { /* no body */ }
  const action = body.action || "list";

  try {
    if (action === "list") {
      const { data: companies } = await db.from("companies").select("*").order("created_at");
      const { data: users } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
      const emails = new Set((users?.users || []).map((u) => (u.email || "").toLowerCase()));
      return j({
        ok: true,
        companies: (companies || []).map((c: any) => ({ ...c, has_auth: emails.has(emailOf(c.username || "").toLowerCase()) })),
      });
    }

    if (action === "create") {
      const { name, username, password, role } = body;
      if (!name || !username || !password) return j({ ok: false, error: "이름·아이디·비밀번호가 필요합니다" }, 400);
      if (!validPassword(password)) return j({ ok: false, error: "비밀번호는 영문·숫자를 포함해 10자 이상이어야 합니다" }, 400);
      const email = emailOf(username);

      const existing = await findAuthUser(db, email);
      if (existing) return j({ ok: false, error: `이미 있는 아이디입니다 (${email})` }, 409);
      const { data: dup } = await db.from("companies").select("id").eq("username", username).maybeSingle();
      if (dup) return j({ ok: false, error: `이미 있는 아이디입니다 (${username})` }, 409);

      // email_confirm: true → 확인 메일 없이 바로 로그인 가능
      const { data: created, error: cErr } = await db.auth.admin.createUser({
        email, password, email_confirm: true,
      });
      if (cErr) return j({ ok: false, error: `계정 생성 실패: ${cErr.message}` }, 400);

      const { data: company, error: dbErr } = await db.from("companies").insert([{
        name, username, role: role || "CLIENT",
        brand_id: body.brand_id || null,
        menu_access: body.menu_access ?? null,
        brand_access: body.brand_access ?? null,
      }]).select().single();
      if (dbErr) {
        // 프로필 저장이 실패하면 auth 사용자만 남아 유령 계정이 되므로 되돌린다
        await db.auth.admin.deleteUser(created.user.id).catch(() => {});
        return j({ ok: false, error: `프로필 저장 실패: ${dbErr.message}` }, 400);
      }
      return j({ ok: true, company, email });
    }

    if (action === "set-password") {
      const { password } = body;
      if (!validPassword(password)) return j({ ok: false, error: "비밀번호는 영문·숫자를 포함해 10자 이상이어야 합니다" }, 400);
      let username = body.username;
      if (!username && body.company_id) {
        const { data } = await db.from("companies").select("username").eq("id", body.company_id).maybeSingle();
        username = data?.username;
      }
      if (!username) return j({ ok: false, error: "대상 계정을 찾을 수 없습니다" }, 404);
      const email = emailOf(username);
      const user = await findAuthUser(db, email);
      if (!user) return j({ ok: false, error: `${email} 로그인 계정이 없습니다. '로그인 연결'을 먼저 하세요.` }, 404);
      const { error } = await db.auth.admin.updateUserById(user.id, { password });
      if (error) return j({ ok: false, error: `비밀번호 변경 실패: ${error.message}` }, 400);
      return j({ ok: true, email });
    }

    // 프로필만 있고 auth 계정이 없는 기존 행에 로그인 계정을 붙여준다
    if (action === "link-auth") {
      const { password } = body;
      if (!validPassword(password)) return j({ ok: false, error: "비밀번호는 영문·숫자를 포함해 10자 이상이어야 합니다" }, 400);
      const { data: c } = await db.from("companies").select("username").eq("id", body.company_id).maybeSingle();
      if (!c?.username) return j({ ok: false, error: "대상 계정을 찾을 수 없습니다" }, 404);
      const email = emailOf(c.username);
      if (await findAuthUser(db, email)) return j({ ok: false, error: "이미 로그인 계정이 있습니다" }, 409);
      const { error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) return j({ ok: false, error: `연결 실패: ${error.message}` }, 400);
      return j({ ok: true, email });
    }

    if (action === "delete") {
      const { data: c } = await db.from("companies").select("username").eq("id", body.company_id).maybeSingle();
      if (!c) return j({ ok: false, error: "대상 계정을 찾을 수 없습니다" }, 404);
      if (c.username === (auth.email || "").split("@")[0]) return j({ ok: false, error: "본인 계정은 삭제할 수 없습니다" }, 400);

      const { error: delErr } = await db.from("companies").delete().eq("id", body.company_id);
      if (delErr) return j({ ok: false, error: `프로필 삭제 실패: ${delErr.message}` }, 400);
      const user = await findAuthUser(db, emailOf(c.username));
      if (user) await db.auth.admin.deleteUser(user.id).catch(() => {});
      return j({ ok: true });
    }

    return j({ ok: false, error: `알 수 없는 action: ${action}` }, 400);
  } catch (e) {
    return j({ ok: false, error: String(e) }, 500);
  }
});
