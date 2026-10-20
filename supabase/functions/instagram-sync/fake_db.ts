// 테스트 전용 가짜 Supabase — instagram-sync 가 쓰는 체인만 흉내 낸다. 실제 DB·네트워크는 건드리지 않는다.
// deno-lint-ignore-file no-explicit-any
type Row = Record<string, any>;

export class FakeDb {
  tables: Record<string, Row[]> = {};
  writes: { table: string; op: string; n: number }[] = [];
  failUpsert: Record<string, string> = {}; // 테이블 → 오류문 (저장 실패 흉내)
  failUpdate: Record<string, string> = {}; // 테이블 → 오류문 (update 실패 흉내)
  constructor(seed: Record<string, Row[]> = {}) {
    for (const [k, v] of Object.entries(seed)) this.tables[k] = v.map((r) => ({ ...r }));
  }
  t(name: string) { return (this.tables[name] ||= []); }
  from(name: string) { return new Q(this, name); }
}

class Q {
  private filters: ((r: Row) => boolean)[] = [];
  private orders: { col: string; asc: boolean }[] = [];
  private lim = Infinity;
  private op: "select" | "update" = "select";
  private patch: Row = {};
  constructor(private db: FakeDb, private name: string) {}
  select(_cols?: string) { return this; }
  eq(c: string, v: any) { this.filters.push((r) => r[c] === v); return this; }
  lt(c: string, v: any) { this.filters.push((r) => r[c] < v); return this; }
  is(c: string, v: any) { this.filters.push((r) => (r[c] ?? null) === v); return this; }
  not(c: string, op: string, v: any) { if (op === "is") this.filters.push((r) => (r[c] ?? null) !== v); return this; }
  in(c: string, vs: any[]) { this.filters.push((r) => vs.includes(r[c])); return this; }
  order(col: string, o: { ascending?: boolean } = {}) { this.orders.push({ col, asc: o.ascending !== false }); return this; }
  limit(n: number) { this.lim = n; return this; }
  private rows() {
    let rs = this.db.t(this.name).filter((r) => this.filters.every((f) => f(r)));
    rs = [...rs].sort((a, b) => {
      for (const o of this.orders) { if (a[o.col] === b[o.col]) continue; return (a[o.col] < b[o.col] ? -1 : 1) * (o.asc ? 1 : -1); }
      return 0;
    });
    return rs.slice(0, this.lim);
  }
  maybeSingle() { return Promise.resolve({ data: this.rows()[0] ?? null, error: null }); }
  update(p: Row) { this.op = "update"; this.patch = p; return this; }
  upsert(rows: Row | Row[], o: { onConflict: string } = { onConflict: "id" }) {
    if (this.db.failUpsert[this.name]) return Promise.resolve({ error: { message: this.db.failUpsert[this.name] } });
    const list = Array.isArray(rows) ? rows : [rows];
    const keys = o.onConflict.split(",");
    const t = this.db.t(this.name);
    for (const r of list) {
      const hit = t.find((x) => keys.every((k) => x[k] === r[k]));
      if (hit) Object.assign(hit, r); else t.push({ id: crypto.randomUUID(), ...r });
    }
    this.db.writes.push({ table: this.name, op: "upsert", n: list.length });
    return Promise.resolve({ error: null });
  }
  insert(rows: Row[]) {
    this.db.t(this.name).push(...rows.map((r) => ({ id: crypto.randomUUID(), ...r })));
    this.db.writes.push({ table: this.name, op: "insert", n: rows.length });
    return Promise.resolve({ error: null });
  }
  then(ok: (v: any) => any, bad?: (e: any) => any) {
    let v: any;
    if (this.op === "update" && this.db.failUpdate[this.name]) {
      v = { data: null, error: { message: this.db.failUpdate[this.name] } };
    } else if (this.op === "update") {
      const rs = this.db.t(this.name).filter((r) => this.filters.every((f) => f(r)));
      rs.forEach((r) => Object.assign(r, this.patch));
      this.db.writes.push({ table: this.name, op: "update", n: rs.length });
      v = { data: null, error: null };
    } else v = { data: this.rows(), error: null };
    return Promise.resolve(v).then(ok, bad);
  }
}

// 가짜 fetch: URL 을 보고 응답을 고른다. 부른 URL 은 calls 에 쌓는다.
export function fakeFetch(route: (url: string) => { status?: number; body?: unknown; throws?: string }) {
  const calls: string[] = [];
  const f = (url: string) => {
    calls.push(url);
    const r = route(url);
    if (r.throws) return Promise.reject(new Error(r.throws));
    return Promise.resolve(new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 }));
  };
  return { fetch: f, calls };
}
