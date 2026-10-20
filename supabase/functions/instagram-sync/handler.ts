// 인스타그램 일일 수집기
//  META_IG_TOKEN(장기 사용자 토큰)으로 me/accounts의 connected_instagram_account를 훑어,
//  username이 ig_accounts와 매칭되는 계정의 followers_count / media_count를 ig_snapshots에 스냅샷 저장.
//  posts_delta = 오늘 media_count - 직전 스냅샷 media_count (음수면 0).
//  호출: pg_cron이 x-cron-secret 헤더로 매시. (cafe24-sync와 동일 패턴)
//  이어서 경쟁사 Business Discovery(competitors.ts)를 하루 한 번 돈다. ?dry_run=1 은 경쟁사만 읽기 전용.
//  본문은 테스트를 위해 handle(req, deps)로 뺐다 — index.ts 는 실제 db·fetch 를 꽂아 띄우기만 한다.
import { syncCompetitors } from "./competitors.ts";

// deno-lint-ignore no-explicit-any
export type Deps = { db: any; fetch: (url: string) => Promise<Response>; env: (k: string) => string | undefined; sleep?: (ms: number) => Promise<unknown> };

const GRAPH = "https://graph.facebook.com/v20.0";

function cors(h: HeadersInit = {}) {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret", "Content-Type": "application/json", ...h };
}
const norm = (u: string) => String(u || "").trim().toLowerCase().replace(/^@/, "");

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const fetch = deps.fetch;
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });

  // pg_cron 전용: x-cron-secret 일치해야 실행. (공개 호출 차단)
  const cronSecret = deps.env("CRON_SECRET") || "";
  const provided = (req.headers.get("x-cron-secret") || "").trim();
  if (!cronSecret || provided.length !== cronSecret.length || provided !== cronSecret) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401, headers: cors() });
  }

  const db = deps.db;
  const q = new URL(req.url).searchParams;
  //  ?dry_run=1 → 경쟁사 수집만 읽기 전용으로 돌린다(토큰 재교환·ig_snapshots·sync_log 쓰기 없음)
  const dryRun = q.get("dry_run") === "1";
  const today = new Date().toISOString().slice(0, 10);
  //  dry-run 은 오류 경로까지 포함해 sync_log 도 쓰지 않는다
  const log = (result: string, detail: unknown) => dryRun ? Promise.resolve({ error: null })
    : db.from("sync_log").insert([{ channel: "instagram", type: "ig:sync", result, detail }]);

  // 토큰: ig_token 테이블(자동갱신본) 우선, 없으면 시크릿 META_IG_TOKEN.
  const { data: trow } = await db.from("ig_token").select("token").eq("id", 1).maybeSingle();
  let token = trow?.token || deps.env("META_IG_TOKEN") || "";
  if (!token) {
    return new Response(JSON.stringify({ ok: false, error: "META_IG_TOKEN 미설정" }), { status: 200, headers: cors() });
  }
  // 매 실행마다 장기 토큰 재교환 → 60일 만료 방지(자동 연장). 실패해도 기존 토큰으로 진행.
  if (!dryRun) try {
    const appId = deps.env("META_APP_ID"), secret = deps.env("META_APP_SECRET");
    if (appId && secret) {
      const rj = await (await fetch(`${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${secret}&fb_exchange_token=${encodeURIComponent(token)}`)).json();
      if (rj.access_token) { token = rj.access_token; await db.from("ig_token").upsert({ id: 1, token, updated_at: new Date().toISOString() }); }
    }
  } catch (_e) { /* keep existing token */ }

  try {
    // 1) 등록된 인스타 계정(username→account_id) 로드
    const { data: accs } = await db.from("ig_accounts").select("id, username, brand_id");
    const byUser = new Map<string, string>();
    (accs || []).forEach((a: { id: string; username: string | null }) => { if (a.username) byUser.set(norm(a.username), a.id); });

    // 2) 브랜드 페이지별 연결된 IG 조회.
    //    ⚠️ 사용자 토큰으로 페이지를 직접 읽으면 갓 연결된 IG(connected_instagram_account)가
    //       안 보이는 경우가 있다(하이헤이호는 보이는데 로하이는 None). 그래서
    //       me/accounts로 각 페이지의 "페이지 토큰"을 받아, 페이지 토큰으로 연결 IG를 읽는다.
    //       (페이지 토큰이면 connected_instagram_account가 안정적으로 조회됨)
    const PAGE_IDS = ["554876437711515", "1117433434778653", "501070843094162", "444009348805535", "938551242683997"];
    const pageTok = new Map<string, string>();
    try {
      let url: string | null = `${GRAPH}/me/accounts?fields=id,access_token&limit=100&access_token=${encodeURIComponent(token)}`;
      while (url) {
        const aj = await (await fetch(url)).json();
        if (aj.error) { await log("warn", { step: "me/accounts", error: aj.error.message }); break; }
        (aj.data || []).forEach((p: { id: string; access_token?: string }) => { if (p.access_token) pageTok.set(p.id, p.access_token); });
        url = aj.paging?.next || null;
      }
    } catch (e) { await log("warn", { step: "me/accounts", error: String(e) }); }

    if (dryRun) {
      const subj = await discoverySubject(db, deps, pageTok, token);
      if (!subj) return new Response(JSON.stringify({ ok: false, dry_run: true, error: "discovery 주체 IG 계정 없음" }), { headers: cors() });
      const competitors = await syncCompetitors({ db, fetch, token: subj.token, igUserId: subj.igUserId, dryRun: true, sleep: deps.sleep });
      return new Response(JSON.stringify({ ok: true, dry_run: true, competitors }), { headers: cors() });
    }

    const igList: { username: string; followers: number; media: number; ig_id: string; comments: number; likes: number }[] = [];
    for (const pid of PAGE_IDS) {
      const pt = pageTok.get(pid) || token; // 페이지 토큰 우선, 없으면 사용자 토큰 폴백
      const r = await fetch(`${GRAPH}/${pid}?fields=connected_instagram_account{id,username,followers_count,media_count},instagram_business_account{id,username,followers_count,media_count}&access_token=${encodeURIComponent(pt)}`);
      const p = await r.json();
      if (p.error) { await log("warn", { page: pid, error: p.error.message }); continue; }
      const ig = p.connected_instagram_account || p.instagram_business_account;
      if (!ig?.username) continue;
      // 전체 게시물의 댓글·좋아요 합계(페이지네이션). "최근 50개"로 하면 새 글이 올라올 때
      //  옛 인기글이 창 밖으로 밀려 합계가 급락하는 착시(-값)가 생김 → 전량 합산으로 단조증가(정확한 증감).
      //  (comments_count / like_count 는 instagram_basic 로 조회 가능 — 스토리와 달리 추가 권한 불필요)
      let comments = 0, likes = 0;
      try {
        let murl: string | null = `${GRAPH}/${ig.id}/media?fields=comments_count,like_count&limit=100&access_token=${encodeURIComponent(pt)}`;
        let pages = 0;
        while (murl && pages < 30) { // 안전상 최대 3000 게시물
          const mj = await (await fetch(murl)).json();
          if (mj.error) { await log("warn", { page: pid, step: "media", error: mj.error.message }); break; }
          (mj.data || []).forEach((m: { comments_count?: number; like_count?: number }) => { comments += Number(m.comments_count || 0); likes += Number(m.like_count || 0); });
          murl = mj.paging?.next || null;
          pages++;
        }
      } catch (e) { await log("warn", { page: pid, step: "media", error: String(e) }); }
      igList.push({ username: ig.username, followers: Number(ig.followers_count || 0), media: Number(ig.media_count || 0), ig_id: ig.id, comments, likes });
    }

    // 3) 매칭되는 계정만 스냅샷 upsert
    const results: unknown[] = [];
    for (const ig of igList) {
      const accId = byUser.get(norm(ig.username));
      if (!accId) continue;
      // 직전 스냅샷 media_count (오늘 이전) → posts_delta 계산
      const { data: prev } = await db.from("ig_snapshots")
        .select("media_count").eq("account_id", accId).lt("snap_date", today)
        .order("snap_date", { ascending: false }).limit(1).maybeSingle();
      const prevMedia = prev?.media_count ?? null;
      const postsDelta = (prevMedia != null && ig.media >= prevMedia) ? ig.media - prevMedia : 0;
      const { error } = await db.from("ig_snapshots").upsert({
        account_id: accId, snap_date: today, followers: ig.followers, media_count: ig.media,
        posts_delta: postsDelta, comments_total: ig.comments, likes_total: ig.likes, source: "meta",
      }, { onConflict: "account_id,snap_date" });
      if (error) throw error;
      // ig_business_id 기록(비어있으면)
      await db.from("ig_accounts").update({ ig_business_id: ig.ig_id }).eq("id", accId).is("ig_business_id", null);
      results.push({ username: ig.username, followers: ig.followers, media: ig.media, posts_delta: postsDelta, comments: ig.comments, likes: ig.likes });
    }

    await log("ok", { collected: results.length, seen: igList.length });

    // 4) 경쟁사 Business Discovery — 우리 계정 수집과 따로 돈다(실패해도 위 결과는 그대로)
    let competitors: unknown = null;
    try {
      const subj = await discoverySubject(db, deps, pageTok, token);
      if (subj) competitors = await syncCompetitors({ db, fetch, token: subj.token, igUserId: subj.igUserId, sleep: deps.sleep });
    } catch (e) { await db.from("sync_log").insert([{ channel: "instagram", type: "ig:competitors", result: "error", detail: { error: String(e).slice(0, 200) } }]); }

    return new Response(JSON.stringify({ ok: true, collected: results.length, results, competitors }), { headers: cors() });
  } catch (e) {
    await log("error", { error: String(e) });
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 200, headers: cors() });
  }
}

// discovery 주체 = 연결된 우리 IG 비즈니스 계정 하나. IG_DISCOVERY_USER_ID 로 고정할 수 있고,
//  없으면 ig_accounts 에서 ig_business_id 가 있는 첫 계정. 토큰은 그 계정 페이지 토큰 우선.
// deno-lint-ignore no-explicit-any
async function discoverySubject(db: any, deps: Deps, pageTok: Map<string, string>, token: string) {
  const fixed = deps.env("IG_DISCOVERY_USER_ID");
  const { data } = await db.from("ig_accounts").select("ig_business_id, page_id")
    .eq("active", true).not("ig_business_id", "is", null).order("created_at").order("username").limit(5);
  const rows: { ig_business_id: string; page_id?: string | null }[] = data || [];
  const row = fixed ? rows.find((r) => r.ig_business_id === fixed) || { ig_business_id: fixed, page_id: null } : rows[0];
  if (!row?.ig_business_id) return null;
  return { igUserId: row.ig_business_id, token: (row.page_id && pageTok.get(row.page_id)) || token };
}
