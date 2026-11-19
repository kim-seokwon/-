const ymd = v => {
    const s = String(v || '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
};

const addDays = (day, amount) => {
    const d = new Date(`${day}T00:00:00+09:00`);
    d.setUTCDate(d.getUTCDate() + amount);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
};

const median = values => {
    const a = values.filter(Number.isFinite).sort((x, y) => x - y);
    if (!a.length) return null;
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

export async function loadFollowerSnapshots(supabase, since, pageSize = 1000) {
    const rows = [];
    for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase.from('competitor_snapshots')
            .select('competitor_id,snap_date,followers')
            .gte('snap_date', since)
            .order('snap_date', { ascending: true })
            .range(from, from + pageSize - 1);
        if (error) throw error;
        const page = data || [];
        rows.push(...page);
        if (page.length < pageSize) break;
    }
    return rows;
}

const snapMaps = (rows, key) => {
    const out = new Map();
    for (const row of rows || []) {
        const id = String(row?.[key] || ''), day = ymd(row?.snap_date), followers = Number(row?.followers);
        if (!id || !day || !Number.isFinite(followers)) continue;
        if (!out.has(id)) out.set(id, new Map());
        out.get(id).set(day, followers);
    }
    return out;
};

const commonEnd = (ownRows, competitorRows) => {
    const own = new Set((ownRows || []).map(x => ymd(x.snap_date)).filter(Boolean));
    const comp = new Set((competitorRows || []).map(x => ymd(x.snap_date)).filter(Boolean));
    const common = [...own].filter(x => comp.has(x)).sort();
    if (common.length) return common.at(-1);
    return [...own, ...comp].sort().at(-1) || '';
};

const buildLines = (accounts, maps, dates, start, end, kind) => {
    const lines = [], insufficient = [];
    for (const account of accounts || []) {
        const id = String(account?.id || '');
        const snaps = maps.get(id), baseline = snaps?.get(start), finish = snaps?.get(end);
        const label = String(account?.label || account?.username || account?.name || account?.handle || '이름 없음');
        if (!snaps?.has(start) || !snaps?.has(end) || !Number.isFinite(baseline) || baseline <= 0 || !Number.isFinite(finish)) {
            insufficient.push({ id, label, kind });
            continue;
        }
        lines.push({ id, label, kind, brand_id: account?.brand_id || null, points: dates.map(date => {
            const followers = snaps.get(date);
            return { date, value: Number.isFinite(followers) ? (followers - baseline) / baseline * 100 : null };
        }) });
    }
    return { lines, insufficient };
};

export function buildFollowerGrowth({ ownAccounts = [], ownSnapshots = [], competitors = [], competitorSnapshots = [], days = 7, endDate = '' } = {}) {
    const period = days === 30 ? 30 : 7;
    const end = ymd(endDate) || commonEnd(ownSnapshots, competitorSnapshots);
    if (!end) return { days: period, start: '', end: '', dates: [], own: [], competitors: [], median: [], insufficient: [] };
    const start = addDays(end, -period);
    const dates = Array.from({ length: period + 1 }, (_, i) => addDays(start, i));
    const own = buildLines((ownAccounts || []).filter(x => x?.active !== false), snapMaps(ownSnapshots, 'account_id'), dates, start, end, 'own');
    const comp = buildLines((competitors || []).filter(x => x?.active !== false), snapMaps(competitorSnapshots, 'competitor_id'), dates, start, end, 'competitor');
    const baseline = dates.map((date, i) => ({ date, value: median(comp.lines.map(line => line.points[i]?.value)) }));
    return { days: period, start, end, dates, own: own.lines, competitors: comp.lines, median: baseline, insufficient: [...own.insufficient, ...comp.insufficient] };
}

