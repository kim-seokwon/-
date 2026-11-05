// 정산 탭 원본 받기 — PostgREST 는 한 번에 1000줄까지만 준다(운영 max_rows=1000, 조용히 잘림).
//  하이헤이호 10월만 1,513건이라 '한 번에 받기'는 월 화면에서도 잘렸다(11-05 실측).
//  기간을 달 단위로 나눠 동시에 받고, 한 달이 1000줄을 넘으면 그 달 안에서 시각 커서로 이어 받는다.
//  offset 페이지는 뒤로 갈수록 느려(slim 뷰 offset 6000 = 2.8초) 쓰지 않는다.
export const PAGE = 1000;

//  [from, to) 를 KST 달 경계로 자른 구간들. ISO 는 '+09:00' 표기 그대로 돌려준다.
export function monthWindows(fromISO, toISO) {
    const kst = iso => new Date(new Date(iso).getTime() + 9 * 3600e3);
    const iso = d => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}+09:00`;
    const end = new Date(toISO).getTime(), out = [];
    let cur = fromISO;
    while (new Date(cur).getTime() < end) {
        const k = kst(cur);
        const next = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth() + 1, 1));   // 다음 달 1일 00:00 KST(표기상)
        const nextISO = iso(next);
        const stop = new Date(nextISO).getTime() < end ? nextISO : toISO;
        out.push([cur, stop]);
        cur = stop;
    }
    return out;
}

//  한 구간을 order_date 내림차순으로 끝까지. build(q) 로 같은 조건을 매번 새로 만든다.
//  같은 시각 주문이 페이지 경계에 걸려도 빠지지 않게 '이하(lte)'로 이어 받고 id 로 중복을 뺀다.
async function pageWindow(build, from, to, onPage) {
    const seen = new Set(), rows = [];
    let cursor = null;
    for (;;) {
        let q = build().gte('order_date', from);
        q = cursor ? q.lte('order_date', cursor) : q.lt('order_date', to);
        const { data, error } = await q.order('order_date', { ascending: false }).limit(PAGE);
        if (error) throw error;
        const got = data || [];
        let added = 0;
        const fresh = [];
        for (const r of got) if (!seen.has(r.id)) { seen.add(r.id); rows.push(r); fresh.push(r); added++; }
        if (onPage && fresh.length) onPage(fresh);
        if (got.length < PAGE) break;
        const last = got[got.length - 1].order_date;
        if (!added || last === cursor) throw new Error(`같은 시각 주문이 ${PAGE}건을 넘어 다 받지 못함(${last})`);
        cursor = last;
    }
    return rows;
}

//  [from, to) 를 n 조각으로(시각 균등). 한 달 화면도 여러 조각을 동시에 받아 1,000줄 넘는 달이 '1000줄 → 나머지' 차례로 기다리지 않게 한다.
function splitWindow([a, b], n) {
    const t0 = new Date(a).getTime(), t1 = new Date(b).getTime(), out = [];
    const iso = t => { const d = new Date(t + 9 * 3600e3); return d.toISOString().slice(0, 19) + '+09:00'; };
    for (let i = 0; i < n; i++) out.push([i ? iso(t0 + Math.round((t1 - t0) * i / n / 1000) * 1000) : a, i === n - 1 ? b : iso(t0 + Math.round((t1 - t0) * (i + 1) / n / 1000) * 1000)]);
    return out;
}

//  기간 전체 — 달마다(달이 적으면 달을 쪼개 최소 minParts 조각) 동시에. 최신순으로 합쳐 돌려준다.
//  onPage(rows): 한 페이지가 올 때마다 — 상품줄을 원본이 다 오기 전부터 받기 시작하려고.
export async function fetchByMonth(build, fromISO, toISO, { onPage, minParts = 4 } = {}) {
    const months = monthWindows(fromISO, toISO);
    const per = Math.max(1, Math.ceil(minParts / months.length));
    const wins = per > 1 ? months.flatMap(w => splitWindow(w, per)) : months;
    const parts = await Promise.all(wins.map(([a, b]) => pageWindow(build, a, b, onPage)));
    return parts.flat().sort((x, y) => (x.order_date < y.order_date ? 1 : x.order_date > y.order_date ? -1 : 0));
}

//  주문 id 들의 상품줄 — 100개씩(URL 길이) 나눠 동시에 최대 conc 개.
//  itemPool: 여러 번 나눠 부르는 상품줄 요청이 같은 동시 한도를 나눠 쓴다(원본 페이지가 올 때마다 바로 넣는다).
export function itemPool(sb, { chunk = 100, conc = 8 } = {}) {
    const queue = [];
    let live = 0;
    const pump = () => {
        while (live < conc && queue.length) {
            const { ids, done } = queue.shift();
            live++;
            Promise.resolve(sb.from('channel_order_items').select('*').in('channel_order_id', ids))
                .then(({ data, error }) => {
                    if (error) console.warn('[items] load fail:', error.message || error);   // 예전처럼 그 묶음만 비우고 화면은 뜬다
                    done(data || []);
                }, e => { console.warn('[items] load fail:', e?.message || e); done([]); })
                .finally(() => { live--; pump(); });
        }
    };
    return ids => {
        if (!ids || !ids.length) return Promise.resolve([]);
        const ps = [];
        for (let i = 0; i < ids.length; i += chunk) ps.push(new Promise(done => queue.push({ ids: ids.slice(i, i + chunk), done })));
        pump();
        return Promise.all(ps).then(x => x.flat());
    };
}
export function fetchItems(sb, ids, opts) { return itemPool(sb, opts)(ids); }
