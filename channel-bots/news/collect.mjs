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


// ── ④ 구글 뉴스 RSS — 키가 없어도 도는 단계 ────────────────
//  공개 RSS 라 발급받을 게 없다. 브랜드 이름으로 한 번, 업계 말머리로 한 번.
//  네이버·인스타 키가 들어오기 전까지 뉴스 칸을 채우는 건 이쪽이다.
function parseRss(xml) {
  const un = (v) => String(v || '')
    .replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  return xml.split('<item>').slice(1).map((ch) => {
    const tag = (t) => {
      const m = ch.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`));
      return m ? un(m[1]).trim() : '';
    };
    const title = tag('title');
    const outlet = tag('source');
    return {
      title: outlet && title.endsWith(' - ' + outlet) ? title.slice(0, -(outlet.length + 3)) : title,
      url: tag('link'),
      outlet: outlet || null,
      pub: tag('pubDate'),
      desc: strip(tag('description')).slice(0, 300),
    };
  }).filter((x) => x.title && x.url);
}

async function googleNews() {
  const brands = await rest('brands?select=id,name&status=neq.closed');
  const words = (E.NEWS_KEYWORDS || '아동복,유아복,키즈 패션,패션 리테일,의류 생산')
    .split(',').map((x) => x.trim()).filter(Boolean).slice(0, 8);
  //  [검색어, kind, brand_id] — 브랜드 이름은 '우리 후기', 말머리는 '트렌드·행사'
  const jobs = [
    ...brands.map((b) => [b.name, 'review', b.id]),
    ...words.map((w) => [w, 'news', null]),
  ];
  //  일반 검색은 잡음이 심하다 — '아동복' 이 '아동복지시설' 을, '토비' 가 텔레토비를 긁어온다.
  //  업계 매체로 한정하면 거의 사라진다. 매체를 늘리려면 NEWS_SITES 에 도메인을 적는다.
  const sites = (E.NEWS_SITES || 'fashionbiz.co.kr,apparelnews.co.kr,fpost.co.kr,fashionn.com,okfashion.co.kr,ktnews.com')
    .split(',').map((x) => x.trim()).filter(Boolean);
  const MED = `(${sites.map((d) => 'site:' + d).join(' OR ')})`;
  const qOf = (q) => `"${q}" ${MED} when:21d`;
  //  브랜드 이름은 말 속에 묻혀 들어오면 안 된다 — 텔레토'비' 가 '토비' 로 잡히는 식이다.
  //  앞뒤에 글자가 붙어 있으면 버린다. 업계 말머리는 매체가 이미 업계라 거르지 않는다.
  const hasWord = (txt, q) => {
    const t = String(txt || '').replace(/\s+/g, '');
    return q.split(/\s+/).filter(Boolean).every((w) => {
      for (let i = t.indexOf(w); i >= 0; i = t.indexOf(w, i + 1)) {
        const before = t[i - 1] || '';
        const after = t.slice(i + w.length, i + w.length + 2);
        if (!/[가-힣A-Za-z]/.test(before) && !/^(지|지시설|지사|지관)/.test(after)) return true;
      }
      return false;
    });
  };
  const rows = [];
  for (const [q, kind, brand_id] of jobs) {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(qOf(q))}&hl=ko&gl=KR&ceid=KR:ko`;
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; bhas-news/1.0)' } });
      if (!r.ok) { console.log(`· 구글뉴스 '${q}' → ${r.status}`); continue; }
      const all = parseRss(await r.text());
      //  업계 매체 피드는 그 자체가 쓸모 있다 — 말머리가 안 박혀 있어도 받는다.
      //  브랜드 이름만 엄격히 본다(엉뚱한 기사가 '우리 후기' 로 들어오면 안 된다).
      const got = (kind === 'review' ? all.filter((i) => hasWord(i.title + ' ' + i.desc, q)) : all).slice(0, 20);
      got.forEach((i) => rows.push({
        kind, source: 'google_news', brand_id,
        title: i.title, snippet: i.desc, url: i.url, author: i.outlet,
        published_at: i.pub ? new Date(i.pub).toISOString() : null,
        meta: { q },
      }));
      console.log(`· 구글뉴스 '${q}' ${got.length}건 (받은 것 ${all.length})`);
    } catch (e) { console.log(`· 구글뉴스 '${q}' 실패: ${e.message.slice(0, 80)}`); }
  }
  //  같은 기사가 두 말머리에 걸리면 뒤엣것은 버린다 (unique(kind,url))
  const seen = new Set();
  const uniq = rows.filter((x) => { const k = x.kind + '|' + x.url; if (seen.has(k)) return false; seen.add(k); return true; });
  await upsert('news_items', uniq, 'kind,url');
  console.log(`· 구글뉴스 모두 ${uniq.length}건`);
}

await competitors();
await reviews();
await googleNews();
await trends();
console.log('끝');
