// 뉴스 수집기 — 하루 한 번 서버에서 돈다. 키는 Actions 비밀값으로만 들어온다.
//  ① 경쟁사: 인스타 Business Discovery (우리 IG 비즈니스 계정으로 남의 '비즈니스/크리에이터' 공개 지표를 본다)
//  ② 후기: 네이버 검색 API (블로그·카페·뉴스) + 구글 Custom Search
//  ③ 트렌드: 네이버 데이터랩 검색어 추이
// 셋 다 공식 API 다. 로그인 없이 몰래 긁는 방식은 쓰지 않는다.

const E = process.env;
const need = (k) => { if (!E[k]) { console.log(`· ${k} 없음 → 이 단계는 건너뜀`); return false; } return true; };
const SB = E.SUPABASE_URL, KEY = E.SUPABASE_SERVICE_KEY;
if (!SB || !KEY) { console.error('SUPABASE_URL / SUPABASE_SERVICE_KEY 가 필요합니다'); process.exit(1); }

const KST = (d = new Date()) => new Date(d.getTime() + 9 * 3600e3);
const today = KST().toISOString().slice(0, 10);

async function rest(path, opt = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    ...opt,
    headers: {
      apikey: KEY, Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      Prefer: opt.prefer || 'return=representation',
      ...(opt.headers || {}),
    },
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`${path} → ${r.status} ${txt.slice(0, 200)}`);
  return txt ? JSON.parse(txt) : [];
}
const upsert = (table, rows, onConflict) =>
  rows.length ? rest(`${table}?on_conflict=${onConflict}`, {
    method: 'POST', body: JSON.stringify(rows),
    prefer: 'resolution=merge-duplicates,return=minimal',
  }) : Promise.resolve();

const strip = (s) => String(s || '').replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();

// ── ① 경쟁사 인스타 ────────────────────────────────────────
async function competitors() {
  if (!need('IG_USER_ID') || !need('IG_ACCESS_TOKEN')) return;
  const list = await rest('competitors?select=id,handle,name&active=is.true');
  if (!list.length) { console.log('· 등록된 경쟁사 없음'); return; }
  const snaps = [], posts = [];
  for (const c of list) {
    const fields = `business_discovery.username(${c.handle}){followers_count,media_count,media.limit(8){id,caption,like_count,comments_count,timestamp,permalink,media_url}}`;
    const url = `https://graph.facebook.com/v21.0/${E.IG_USER_ID}?fields=${encodeURIComponent(fields)}&access_token=${E.IG_ACCESS_TOKEN}`;
    try {
      const r = await fetch(url);
      const j = await r.json();
      const bd = j.business_discovery;
      if (!bd) { console.log(`· ${c.handle}: 조회 안 됨 (비즈니스 계정이 아니거나 권한 없음)`); continue; }
      const media = (bd.media && bd.media.data) || [];
      const avg = (k) => media.length ? media.reduce((s, m) => s + (m[k] || 0), 0) / media.length : null;
      snaps.push({
        competitor_id: c.id, snap_date: today,
        followers: bd.followers_count ?? null, media_count: bd.media_count ?? null,
        avg_likes: avg('like_count'), avg_comments: avg('comments_count'),
      });
      media.forEach(m => posts.push({
        kind: 'competitor_post', source: 'instagram', competitor_id: c.id,
        title: c.name, snippet: strip(m.caption).slice(0, 300), url: m.permalink,
        author: c.handle, thumb: m.media_url || null,
        published_at: m.timestamp || null,
        meta: { likes: m.like_count, comments: m.comments_count },
      }));
      console.log(`· ${c.handle}: 팔로워 ${bd.followers_count} · 글 ${media.length}`);
    } catch (e) { console.log(`· ${c.handle} 실패: ${e.message.slice(0, 80)}`); }
  }
  // 직전 스냅샷과 견줘 올린 개수를 센다
  for (const s of snaps) {
    const prev = await rest(`competitor_snapshots?select=media_count&competitor_id=eq.${s.competitor_id}&snap_date=lt.${today}&order=snap_date.desc&limit=1`);
    if (prev[0] && prev[0].media_count != null && s.media_count != null) s.posts_delta = Math.max(0, s.media_count - prev[0].media_count);
  }
  await upsert('competitor_snapshots', snaps, 'competitor_id,snap_date');
  await upsert('news_items', posts, 'kind,url');
}

// ── ② 브랜드 후기 ──────────────────────────────────────────
async function reviews() {
  const brands = await rest('brands?select=id,name&status=neq.closed');
  if (!brands.length) { console.log('· 브랜드 없음'); return; }
  const rows = [];

  if (E.NAVER_CLIENT_ID && E.NAVER_CLIENT_SECRET) {
    for (const b of brands) {
      for (const [api, src] of [['blog', 'naver_blog'], ['cafearticle', 'naver_cafe'], ['news', 'naver_news']]) {
        try {
          const r = await fetch(`https://openapi.naver.com/v1/search/${api}.json?query=${encodeURIComponent(b.name)}&display=20&sort=date`, {
            headers: { 'X-Naver-Client-Id': E.NAVER_CLIENT_ID, 'X-Naver-Client-Secret': E.NAVER_CLIENT_SECRET },
          });
          const j = await r.json();
          (j.items || []).forEach(i => rows.push({
            kind: 'review', source: src, brand_id: b.id,
            title: strip(i.title), snippet: strip(i.description).slice(0, 300),
            url: i.link, author: i.bloggername || i.cafename || null,
            published_at: i.postdate ? `${i.postdate.slice(0,4)}-${i.postdate.slice(4,6)}-${i.postdate.slice(6,8)}` : (i.pubDate ? new Date(i.pubDate).toISOString() : null),
          }));
        } catch (e) { console.log(`· 네이버 ${api} ${b.name} 실패: ${e.message.slice(0, 60)}`); }
      }
      console.log(`· 네이버 '${b.name}' 수집`);
    }
  } else { console.log('· NAVER_CLIENT_ID/SECRET 없음 → 네이버 건너뜀'); }

  if (E.GOOGLE_CSE_KEY && E.GOOGLE_CSE_CX) {
    for (const b of brands) {
      try {
        const r = await fetch(`https://www.googleapis.com/customsearch/v1?key=${E.GOOGLE_CSE_KEY}&cx=${E.GOOGLE_CSE_CX}&q=${encodeURIComponent(b.name + ' 후기')}&num=10&dateRestrict=d30`);
        const j = await r.json();
        (j.items || []).forEach(i => rows.push({
          kind: 'review', source: 'google', brand_id: b.id,
          title: i.title, snippet: (i.snippet || '').slice(0, 300), url: i.link,
          author: i.displayLink || null,
        }));
        console.log(`· 구글 '${b.name}' 수집`);
      } catch (e) { console.log(`· 구글 ${b.name} 실패: ${e.message.slice(0, 60)}`); }
    }
  } else { console.log('· GOOGLE_CSE_KEY/CX 없음 → 구글 건너뜀'); }

  await upsert('news_items', rows, 'kind,url');
  console.log(`· 후기 ${rows.length}건`);
}

// ── ③ 트렌드 (네이버 데이터랩) ─────────────────────────────
async function trends() {
  if (!need('NAVER_CLIENT_ID') || !need('NAVER_CLIENT_SECRET')) return;
  const words = (E.TREND_KEYWORDS || '아동복,유아복,키즈룩,돌복,입학복').split(',').map(x => x.trim()).filter(Boolean);
  const end = today, start = KST(new Date(Date.now() - 90 * 864e5)).toISOString().slice(0, 10);
  try {
    const r = await fetch('https://openapi.naver.com/v1/datalab/search', {
      method: 'POST',
      headers: {
        'X-Naver-Client-Id': E.NAVER_CLIENT_ID, 'X-Naver-Client-Secret': E.NAVER_CLIENT_SECRET,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        startDate: start, endDate: end, timeUnit: 'week',
        keywordGroups: words.slice(0, 5).map(w => ({ groupName: w, keywords: [w] })),
      }),
    });
    const j = await r.json();
    const rows = (j.results || []).map(g => {
      const d = g.data || [];
      const last = d[d.length - 1], prev = d[d.length - 2];
      const delta = (last && prev && prev.ratio) ? ((last.ratio - prev.ratio) / prev.ratio * 100) : null;
      return {
        kind: 'trend', source: 'datalab',
        title: g.title, snippet: delta == null ? '' : `지난주 대비 ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`,
        url: `datalab:${g.title}:${end}`, score: last ? last.ratio : null,
        published_at: end, meta: { series: d.slice(-12) },
      };
    });
    await upsert('news_items', rows, 'kind,url');
    console.log(`· 트렌드 ${rows.length}개`);
  } catch (e) { console.log(`· 데이터랩 실패: ${e.message.slice(0, 80)}`); }
}

await competitors();
await reviews();
await trends();
console.log('끝');
