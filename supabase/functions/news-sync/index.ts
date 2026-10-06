// 바깥 소식 수집기 — 네이버 카페·블로그·뉴스 + 구글 뉴스 RSS.
//  news_sources 표에 적힌 '어디서 무엇을' 대로 긁어 news_items 에 쌓는다.
//  네이버는 검색 API 가 카페를 지정해서 못 찾는다. 검색어로 긁은 뒤 글의 cafename 으로 거른다.
//  구글 뉴스 RSS 는 키가 없어도 되니, 네이버 키가 없어도 이것만은 돈다.
//  호출: pg_cron 이 x-cron-secret 헤더로 하루 1회. (instagram-sync 와 같은 패턴)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const NAVER = "https://openapi.naver.com/v1/search";

function cors(h: HeadersInit = {}) {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret", "Content-Type": "application/json", ...h };
}
function admin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
}
// 네이버가 <b>검색어</b> 처럼 태그를 섞어 보낸다. 글자만 남긴다.
function clean(s: string) {
  return String(s || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();
}
// 카페 이름 비교 — 띄어쓰기·대소문자 차이로 조용히 어긋나는 걸 막는다
const key = (s: string) => String(s || "").replace(/\s+/g, "").toLowerCase();
// 인스타 아이디 비교용 — @ 와 대소문자를 치운다
// 이모지·장식 기호를 뗀다 — 제목 첫 글자가 이모지면 신문에서 보기 사납다
function stripEmoji(s: string) {
  return String(s || "")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu, " ")
    .replace(/\s+/g, " ").trim();
}
const norm = (u: string) => String(u || "").trim().toLowerCase().replace(/^@/, "");

//  '우리 이야기' 칸은 진짜로 우리 이름이 나온 글만 들어가야 한다.
//  구글 뉴스 RSS 는 검색어와 느슨하게 맞는 기사까지 돌려줘서, 그냥 담으면 남의 브랜드 소식으로 찬다.
function mentions(query: string, title: string, snippet: string) {
  const hay = key(`${title} ${snippet}`);
  //  '토비 아동복' 처럼 두 낱말이면 둘 다 나와야 한다
  return String(query || "").split(/\s+/).filter(Boolean).every(w => hay.includes(key(w)));
}

//  검색어마다 걸러낼 말 — '아동복' 으로 찾으면 '아동복지시설' 기사가 쏟아진다
function blocked(block: string[] | null, title: string, snippet: string) {
  if (!block || !block.length) return false;
  const hay = key(`${title} ${snippet}`);
  return block.some(w => w && hay.includes(key(w)));
}

type Row = {
  kind: string; source: string; title: string; snippet: string; url: string;
  author: string | null; published_at: string | null; brand_id: string | null; meta: unknown;
};

async function naver(path: string, query: string, id: string, secret: string, display = 50) {
  const u = `${NAVER}/${path}?query=${encodeURIComponent(query)}&display=${display}&sort=date`;
  const r = await fetch(u, { headers: { "X-Naver-Client-Id": id, "X-Naver-Client-Secret": secret } });
  if (!r.ok) throw new Error(`naver ${path} ${r.status} ${(await r.text()).slice(0, 200)}`);
  return (await r.json())?.items || [];
}

// 구글 뉴스 RSS — 키가 필요 없다. <item> 만 거칠게 뽑는다.
async function googleNews(query: string) {
  const u = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`;
  const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) throw new Error(`google rss ${r.status}`);
  const xml = await r.text();
  const out: { title: string; link: string; pubDate: string; source: string }[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const b = m[1];
    const pick = (t: string) => clean((b.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1] || "");
    out.push({ title: pick("title"), link: pick("link"), pubDate: pick("pubDate"), source: pick("source") });
  }
  return out;
}

// ── 번개장터: 우리 옷이 중고로 올라왔나 ──────────────────────
//  공개 검색 API 다. no_result 값은 믿을 게 못 돼서(실제로 맞는 글이 있어도 true 로 온다)
//  이름에 우리 브랜드가 들어간 것만 손으로 거른다.
async function bunjang(query: string) {
  const u = `https://api.bunjang.co.kr/api/1/find_v2.json?q=${encodeURIComponent(query)}&order=date&page=0&n=40`;
  const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) throw new Error(`bunjang ${r.status}`);
  const j = await r.json();
  const want = key(query);
  return (j?.list || [])
    .filter((x: { name?: string }) => key(x.name || "").includes(want))
    .map((x: Record<string, string>) => ({
      pid: x.pid, name: clean(x.name || ""), price: Number(x.price || 0),
      img: String(x.product_image || "").replace("{res}", "266"),
      at: x.update_time ? new Date(Number(x.update_time) * 1000).toISOString() : null,
      where: clean(x.location || ""),
    }));
}

// ── 인스타그램: 우리 계정이 올린 글 ────────────────────────────
//  남의 계정·해시태그는 Meta 앱 심사('Instagram Public Content Access')를 받아야 읽을 수 있다.
//  지금 토큰으로 되는 건 우리 계정의 게시물뿐이라, 그것만 가져온다.
//  (경쟁사 피드를 보려면 심사를 통과해야 한다 — 코드가 아니라 권한 문제다.)
const GRAPH = "https://graph.facebook.com/v20.0";
async function igOwnPosts(db: ReturnType<typeof admin>, sinceDays: number) {
  const { data: trow } = await db.from("ig_token").select("token").eq("id", 1).maybeSingle();
  const token = trow?.token || Deno.env.get("META_IG_TOKEN") || "";
  if (!token) return { rows: [] as Row[], err: "META_IG_TOKEN 없음" };

  const { data: accs } = await db.from("ig_accounts").select("id, username, brand_id");
  const want = new Map<string, { id: string; brand_id: string | null }>();
  (accs || []).forEach((a: { id: string; username: string | null; brand_id: string | null }) => {
    if (a.username) want.set(norm(a.username), { id: a.id, brand_id: a.brand_id });
  });
  if (!want.size) return { rows: [], err: "ig_accounts 비어 있음" };

  const since = Date.now() - sinceDays * 864e5;
  const rows: Row[] = [];
  let err = "";
  try {
    const pages = await (await fetch(`${GRAPH}/me/accounts?fields=id&limit=100&access_token=${token}`)).json();
    for (const pg of (pages?.data || [])) {
      try {
        const pt = (await (await fetch(`${GRAPH}/${pg.id}?fields=access_token&access_token=${token}`)).json())?.access_token;
        if (!pt) continue;
        const link = await (await fetch(`${GRAPH}/${pg.id}?fields=connected_instagram_account,instagram_business_account&access_token=${pt}`)).json();
        const igId = link?.instagram_business_account?.id || link?.connected_instagram_account?.id;
        if (!igId) continue;
        const prof = await (await fetch(`${GRAPH}/${igId}?fields=username&access_token=${pt}`)).json();
        const hit = want.get(norm(prof?.username || ""));
        if (!hit) continue;   // 우리 브랜드 계정이 아니면 건너뛴다
        const med = await (await fetch(`${GRAPH}/${igId}/media?fields=caption,permalink,timestamp,media_type,media_url,thumbnail_url,like_count,comments_count&limit=25&access_token=${pt}`)).json();
        for (const m of (med?.data || [])) {
          if (!m.timestamp || new Date(m.timestamp).getTime() < since) continue;
          //  clean() 은 줄바꿈까지 공백으로 눌러 버린다. 인스타 캡션은 줄이 곧 문단이라
          //  제목(첫 줄)과 본문(나머지)을 가르려면 줄바꿈을 살려 둬야 한다.
          const cap = String(m.caption || "")
            .replace(/<[^>]*>/g, "")
            .replace(/[ \t]+/g, " ")
            .replace(/\n{2,}/g, "\n").trim();
          //  인스타 글머리는 이모지 줄로 시작하는 일이 많다. 글자가 든 첫 줄을 제목으로 쓴다.
          //  마침표로 자르면 '10.14' 같은 날짜가 잘려 '10' 만 남는다 — 줄바꿈으로만 자른다.
          const lines = cap.split("\n").map((x: string) => x.trim()).filter(Boolean);
          const hasWord = (l: string) => /[A-Za-z가-힣0-9]/.test(stripEmoji(l));
          //  한 줄짜리 캡션이면 제목과 본문이 같아져 버린다 → 앞머리를 제목, 나머지를 본문으로 가른다
          const wordy = lines.filter(hasWord).map(stripEmoji).filter(Boolean);
          const whole = wordy.join(" ");
          let first = "", rest = "";
          if (wordy.length > 1) { first = wordy[0].slice(0, 44).trim(); rest = wordy.slice(1).join(" "); }
          else {
            const one = whole;
            if (one.length <= 44) { first = one; rest = ""; }
            else {
              const cut = one.lastIndexOf(" ", 44);
              first = one.slice(0, cut > 16 ? cut : 44).trim();
              rest = one.slice(first.length).trim();
            }
          }
          rows.push({
            kind: "review", source: "instagram",
            title: first || `${prof.username} 새 게시물`,
            snippet: rest.slice(0, 260).trim(),
            url: m.permalink, author: prof.username,
            published_at: m.timestamp ? new Date(m.timestamp).toISOString() : null,
            brand_id: hit.brand_id,
            meta: { likes: m.like_count ?? null, comments: m.comments_count ?? null,
                    thumb: m.thumbnail_url || m.media_url || null, media_type: m.media_type },
          });
        }
      } catch (e) { err = (e as Error).message; }
    }
  } catch (e) { err = (e as Error).message; }
  return { rows, err };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });

  const cronSecret = Deno.env.get("CRON_SECRET") || "";
  const provided = (req.headers.get("x-cron-secret") || "").trim();
  if (!cronSecret || provided.length !== cronSecret.length || provided !== cronSecret) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401, headers: cors() });
  }

  const db = admin();
  const log = (result: string, detail: unknown) => db.from("sync_log").insert([{ channel: "news", type: "news:sync", result, detail }]);
  const nid = Deno.env.get("NAVER_CLIENT_ID") || "";
  const nsec = Deno.env.get("NAVER_CLIENT_SECRET") || "";

  try {
    const { data: srcs } = await db.from("news_sources").select("*").eq("active", true).order("sort");
    const rows: Row[] = [];
    const skipped: string[] = [];
    const errs: string[] = [];

    for (const s of (srcs || [])) {
      try {
        if (s.kind === "cafe" || s.kind === "blog") {
          if (!nid || !nsec) { skipped.push(`${s.kind}:${s.query}`); continue; }
          const path = s.kind === "cafe" ? "cafearticle.json" : "blog.json";
          const items = await naver(path, s.query, nid, nsec);
          const want = (s.cafes || []).map(key);
          for (const it of items) {
            const cafe = clean(it.cafename || "");
            //  카페를 지정했으면 그 카페 글만. (API 가 카페 지정 검색을 안 해 준다)
            if (s.kind === "cafe" && want.length && !want.some((w: string) => key(cafe).includes(w) || w.includes(key(cafe)))) continue;
            const ttl = clean(it.title), des = clean(it.description);
            if (blocked(s.block, ttl, des)) continue;
            if (s.bucket === "review" && !mentions(s.query, ttl, des)) continue;
            rows.push({
              kind: s.bucket, source: s.kind === "cafe" ? "naver_cafe" : "naver_blog",
              title: ttl, snippet: des, url: it.link,
              author: cafe || clean(it.bloggername || "") || null,
              // 블로그는 postdate(YYYYMMDD), 카페글은 날짜를 안 준다 → 모르면 비워 둔다
              published_at: /^\d{8}$/.test(it.postdate || "") ? `${it.postdate.slice(0,4)}-${it.postdate.slice(4,6)}-${it.postdate.slice(6,8)}` : null,
              brand_id: s.brand_id || null,
              meta: { query: s.query, cafe: cafe || undefined },
            });
          }
        } else if (s.kind === "bunjang") {
          for (const b of await bunjang(s.query)) {
            rows.push({
              kind: "resale", source: "bunjang",
              title: b.name, snippet: "", url: `https://m.bunjang.co.kr/products/${b.pid}`,
              author: b.where || null, published_at: b.at,
              brand_id: s.brand_id || null,
              meta: { price: b.price, thumb: b.img, query: s.query },
            });
          }
        } else if (s.kind === "news") {
          // 네이버 뉴스(키 있으면) + 구글 뉴스 RSS(항상)
          if (nid && nsec) {
            for (const it of await naver("news.json", s.query, nid, nsec, 30)) {
              if (blocked(s.block, clean(it.title), clean(it.description))) continue;
              if (s.bucket === "review" && !mentions(s.query, clean(it.title), clean(it.description))) continue;
              rows.push({
                kind: s.bucket, source: "naver_news", title: clean(it.title), snippet: clean(it.description),
                url: it.originallink || it.link, author: null,
                published_at: it.pubDate ? new Date(it.pubDate).toISOString() : null,
                brand_id: s.brand_id || null, meta: { query: s.query },
              });
            }
          }
          for (const it of await googleNews(s.query)) {
            if (blocked(s.block, it.title, "")) continue;
            if (s.bucket === "review" && !mentions(s.query, it.title, "")) continue;
            rows.push({
              kind: s.bucket, source: "google_news", title: it.title, snippet: "", url: it.link,
              author: it.source || null,
              published_at: it.pubDate ? new Date(it.pubDate).toISOString() : null,
              brand_id: s.brand_id || null, meta: { query: s.query },
            });
          }
        }
      } catch (e) { errs.push(`${s.kind}:${s.query} ${(e as Error).message}`); }
    }

    // 인스타: 우리 계정이 올린 글
    try {
      const ig = await igOwnPosts(db, 30);
      rows.push(...ig.rows);
      if (ig.err) errs.push(`instagram ${ig.err}`);
    } catch (e) { errs.push(`instagram ${(e as Error).message}`); }

    // 같은 (kind,url) 은 한 줄이다 — 매일 돌아도 쌓이지 않게
    const seen = new Set<string>();
    const uniq = rows.filter(r => {
      if (!r.url) return false;
      //  주소가 달라도 제목이 같으면 같은 기사다(같은 글을 여러 매체가 받아쓴다)
      const k = `${r.kind}|${r.url}`, kt = `${r.kind}~${key(r.title)}`;
      if (seen.has(k) || (r.title && seen.has(kt))) return false;
      seen.add(k); if (r.title) seen.add(kt);
      return true;
    });

    let saved = 0;
    for (let i = 0; i < uniq.length; i += 200) {
      const chunk = uniq.slice(i, i + 200);
      //  사진은 thumb 칸에 따로 넣는다 — 신문 1면에 그림이 들어가야 신문으로 보인다.
      //  인스타 사진 주소는 며칠이면 만료돼서, 매일 돌 때 다시 덮어쓴다(ignoreDuplicates 를 끈 이유).
      const body = chunk.map(r => ({ ...r, thumb: (r.meta as { thumb?: string } | null)?.thumb ?? null }));
      const { error } = await db.from("news_items").upsert(body, { onConflict: "kind,url" });
      if (error) errs.push(`upsert ${error.message}`); else saved += chunk.length;
    }

    const detail = { sources: (srcs || []).length, found: rows.length, saved, skipped, errs: errs.slice(0, 5) };
    await log(errs.length ? "partial" : "ok", detail);
    return new Response(JSON.stringify({ ok: true, ...detail }), { headers: cors() });
  } catch (e) {
    await log("error", { message: (e as Error).message });
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), { status: 200, headers: cors() });
  }
});
