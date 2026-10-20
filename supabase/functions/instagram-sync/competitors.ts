// 경쟁사 인스타 수집 — Business Discovery (뉴스 '경쟁·유통' 칸)
//  우리 IG 비즈니스 계정 하나를 주체로 남의 비즈니스/크리에이터 계정 공개 지표를 읽는다.
//  · competitors.active=true 만 · 하루 한 번(오늘 스냅샷 있는 곳은 건너뜀 — instagram-sync 는 매시 돈다)
//  · 한 곳 실패해도 나머지는 계속, 실패 핸들·사유는 sync_log(ig:competitors) 에 남긴다
//  · 조회 불가(개인 계정·없는 핸들·비공개)여도 competitors 는 지우지 않는다
//  · 순차 호출 + 간격, 호출 한도 오류가 나면 그 실행은 멈추고 남은 곳은 다음 시간에
//  · dryRun 이면 DB 에 아무것도 쓰지 않는다(sync_log 포함)
//  db·fetch 를 밖에서 받는다 — 테스트는 가짜를 꽂는다(competitors.test.ts).

export const DISCOVERY = {
  GRAPH: "https://graph.facebook.com/v20.0", // instagram-sync 와 같은 버전
  MEDIA_LIMIT: 6,        // 핸들당 최근 글 몇 개를 볼지
  RECENT_DAYS: 14,       // 이보다 오래된 글은 news_items 에 넣지 않는다
  MAX_PER_RUN: 50,       // 한 번 실행에 부르는 최대 핸들 수
  GAP_MS: 400,           // 호출 사이 간격
  RATE_CODES: [4, 17, 32, 613], // Meta 호출 한도 오류 코드
};

// deno-lint-ignore no-explicit-any
type Db = any;
type Fetch = (url: string) => Promise<Response>;

export type Competitor = { id: string; handle: string; name: string; ig_business_id?: string | null };
export type Failure = { handle: string; reason: string };
export type CompetitorResult = {
  dry_run: boolean; active: number; skipped_today: number; tried: number; ok: number;
  posts: number; failed: Failure[]; rate_limited: boolean; deferred: number;
  planned?: { competitor_snapshots: number; news_items: number };
};

export const kstDate = (now = new Date()) => new Date(now.getTime() + 9 * 3600e3).toISOString().slice(0, 10);

// 토큰이 사유 문자열에 섞여 로그로 새지 않게
export function scrub(s: string, token = "") {
  let out = String(s || "")
    .replace(/(https?:\/\/[^\s?"']+)\?[^\s"']*/g, "$1?…") // URL 쿼리(필드·토큰)는 통째로 뺀다
    .replace(/access_token=[^&\s"']+/g, "access_token=***");
  if (token) out = out.split(token).join("***");
  return out.slice(0, 200);
}

const clean = (s: string) => String(s || "").replace(/\s+/g, " ").trim();
//  캡션 첫 줄을 제목으로, 나머지를 본문으로 (news-sync 인스타 후기와 같은 방식, 단순판)
export function splitCaption(caption: string, fallback: string) {
  const lines = String(caption || "").split(/\n+/).map(clean).filter((l) => /[A-Za-z가-힣0-9]/.test(l));
  if (!lines.length) return { title: fallback, snippet: "" };
  let title = lines[0], rest = lines.slice(1).join(" ");
  if (title.length > 44) {
    const cut = title.lastIndexOf(" ", 44);
    const head = title.slice(0, cut > 16 ? cut : 44).trim();
    rest = clean(`${title.slice(head.length)} ${rest}`);
    title = head;
  }
  return { title, snippet: rest.slice(0, 260) };
}

export function discoveryUrl(igUserId: string, handle: string, token: string) {
  const f = `business_discovery.username(${handle}){id,username,followers_count,media_count,` +
    `media.limit(${DISCOVERY.MEDIA_LIMIT}){id,caption,like_count,comments_count,timestamp,permalink,media_url,thumbnail_url,media_type}}`;
  return `${DISCOVERY.GRAPH}/${igUserId}?fields=${encodeURIComponent(f)}&access_token=${encodeURIComponent(token)}`;
}

type Media = { id?: string; caption?: string; like_count?: number; comments_count?: number; timestamp?: string;
  permalink?: string; media_url?: string; thumbnail_url?: string; media_type?: string };

export async function syncCompetitors(o: {
  db: Db; fetch: Fetch; token: string; igUserId: string;
  today?: string; now?: Date; dryRun?: boolean; force?: boolean;
  sleep?: (ms: number) => Promise<unknown>;
}): Promise<CompetitorResult> {
  const now = o.now || new Date();
  const today = o.today || kstDate(now);
  const sleep = o.sleep || ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const dry = !!o.dryRun;
  const res: CompetitorResult = { dry_run: dry, active: 0, skipped_today: 0, tried: 0, ok: 0, posts: 0, failed: [], rate_limited: false, deferred: 0 };
  if (dry) res.planned = { competitor_snapshots: 0, news_items: 0 };

  const { data: list, error: le } = await o.db.from("competitors").select("id, handle, name, ig_business_id").eq("active", true).order("handle");
  if (le) throw new Error(`competitors 읽기 실패: ${le.message || le}`);
  const comps: Competitor[] = list || [];
  res.active = comps.length;

  let todo = comps;
  if (!o.force && comps.length) {
    const { data: done } = await o.db.from("competitor_snapshots").select("competitor_id").eq("snap_date", today);
    const doneSet = new Set((done || []).map((d: { competitor_id: string }) => d.competitor_id));
    todo = comps.filter((c) => !doneSet.has(c.id));
    res.skipped_today = comps.length - todo.length;
  }
  if (todo.length > DISCOVERY.MAX_PER_RUN) { res.deferred = todo.length - DISCOVERY.MAX_PER_RUN; todo = todo.slice(0, DISCOVERY.MAX_PER_RUN); }

  const cutoff = now.getTime() - DISCOVERY.RECENT_DAYS * 86400e3;
  for (let i = 0; i < todo.length; i++) {
    const c = todo[i];
    if (i > 0) await sleep(DISCOVERY.GAP_MS);
    res.tried++;
    let j: { error?: { message?: string; code?: number }; business_discovery?: Record<string, unknown> };
    let status = 0;
    try {
      const r = await o.fetch(discoveryUrl(o.igUserId, c.handle, o.token));
      status = r.status;
      j = await r.json();
    } catch (e) {
      res.failed.push({ handle: c.handle, reason: scrub(`요청 실패: ${(e as Error).message}`, o.token) });
      continue;
    }
    if (status === 429 || (j.error && DISCOVERY.RATE_CODES.includes(Number(j.error.code)))) {
      res.failed.push({ handle: c.handle, reason: scrub(`호출 한도: ${j.error?.message || status}`, o.token) });
      res.rate_limited = true;
      res.deferred += todo.length - i - 1;
      break;
    }
    if (j.error || !j.business_discovery) {
      const why = j.error ? `${j.error.code ?? ""} ${j.error.message ?? ""}`.trim() : "business_discovery 없음";
      res.failed.push({ handle: c.handle, reason: scrub(`조회 불가(비즈니스 계정 아님·없는 핸들·권한): ${why}`, o.token) });
      continue;
    }
    const bd = j.business_discovery as { id?: string; followers_count?: number; media_count?: number; media?: { data?: Media[] } };
    const media = bd.media?.data || [];
    const avg = (k: "like_count" | "comments_count") => media.length ? media.reduce((s, m) => s + Number(m[k] || 0), 0) / media.length : null;

    const snap: Record<string, unknown> = {
      competitor_id: c.id, snap_date: today,
      followers: bd.followers_count ?? null, media_count: bd.media_count ?? null,
      posts_delta: 0, avg_likes: avg("like_count"), avg_comments: avg("comments_count"),
    };
    const posts = media
      .filter((m) => m.permalink && (!m.timestamp || new Date(m.timestamp).getTime() >= cutoff))
      .map((m) => {
        const { title, snippet } = splitCaption(m.caption || "", `${c.name} 새 게시물`);
        return {
          kind: "competitor_post", source: "instagram", competitor_id: c.id,
          title, snippet, url: m.permalink, author: c.handle,
          thumb: m.thumbnail_url || m.media_url || null,
          published_at: m.timestamp ? new Date(m.timestamp).toISOString() : null,
          meta: { likes: m.like_count ?? null, comments: m.comments_count ?? null, media_type: m.media_type ?? null, name: c.name },
        };
      });

    try {
      const { data: prev } = await o.db.from("competitor_snapshots").select("media_count")
        .eq("competitor_id", c.id).lt("snap_date", today).order("snap_date", { ascending: false }).limit(1).maybeSingle();
      if (prev?.media_count != null && bd.media_count != null) snap.posts_delta = Math.max(0, Number(bd.media_count) - Number(prev.media_count));

      if (dry) {
        res.planned!.competitor_snapshots++;
        res.planned!.news_items += posts.length;
      } else {
        const s1 = await o.db.from("competitor_snapshots").upsert(snap, { onConflict: "competitor_id,snap_date" });
        if (s1.error) throw new Error(`스냅샷 저장: ${s1.error.message || s1.error}`);
        if (posts.length) {
          const s2 = await o.db.from("news_items").upsert(posts, { onConflict: "kind,url" });
          if (s2.error) throw new Error(`글 저장: ${s2.error.message || s2.error}`);
        }
        if (!c.ig_business_id && bd.id) {
          const s3 = await o.db.from("competitors").update({ ig_business_id: String(bd.id) }).eq("id", c.id).is("ig_business_id", null);
          if (s3?.error) throw new Error(`ig_business_id 저장: ${s3.error.message || s3.error}`);
        }
      }
      res.ok++;
      res.posts += posts.length;
    } catch (e) {
      res.failed.push({ handle: c.handle, reason: scrub((e as Error).message, o.token) });
    }
  }

  if (!dry && res.tried > 0) { // 매시 실행 — 부른 게 없으면 로그도 안 남긴다
    const result = res.failed.length === 0 ? "ok" : res.ok ? "partial" : "error";
    await o.db.from("sync_log").insert([{ channel: "instagram", type: "ig:competitors", result, detail: { ...res, today } }]);
  }
  return res;
}
