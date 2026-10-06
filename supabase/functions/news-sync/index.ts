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
            rows.push({
              kind: s.bucket, source: s.kind === "cafe" ? "naver_cafe" : "naver_blog",
              title: clean(it.title), snippet: clean(it.description), url: it.link,
              author: cafe || clean(it.bloggername || "") || null,
              // 블로그는 postdate(YYYYMMDD), 카페글은 날짜를 안 준다 → 모르면 비워 둔다
              published_at: /^\d{8}$/.test(it.postdate || "") ? `${it.postdate.slice(0,4)}-${it.postdate.slice(4,6)}-${it.postdate.slice(6,8)}` : null,
              brand_id: s.brand_id || null,
              meta: { query: s.query, cafe: cafe || undefined },
            });
          }
        } else if (s.kind === "news") {
          // 네이버 뉴스(키 있으면) + 구글 뉴스 RSS(항상)
          if (nid && nsec) {
            for (const it of await naver("news.json", s.query, nid, nsec, 30)) {
              rows.push({
                kind: s.bucket, source: "naver_news", title: clean(it.title), snippet: clean(it.description),
                url: it.originallink || it.link, author: null,
                published_at: it.pubDate ? new Date(it.pubDate).toISOString() : null,
                brand_id: s.brand_id || null, meta: { query: s.query },
              });
            }
          }
          for (const it of await googleNews(s.query)) {
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

    // 같은 (kind,url) 은 한 줄이다 — 매일 돌아도 쌓이지 않게
    const seen = new Set<string>();
    const uniq = rows.filter(r => {
      if (!r.url) return false;
      const k = `${r.kind}|${r.url}`;
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });

    let saved = 0;
    for (let i = 0; i < uniq.length; i += 200) {
      const chunk = uniq.slice(i, i + 200);
      const { error } = await db.from("news_items").upsert(chunk, { onConflict: "kind,url", ignoreDuplicates: true });
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
