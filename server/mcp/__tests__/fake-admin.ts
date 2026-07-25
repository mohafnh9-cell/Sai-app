/**
 * Minimal in-memory fake of the Supabase query builder surface used by the
 * MCP canonical tools and review_now's orchestration layer. Supports
 * select/insert/update/upsert with eq/neq/in/gte/order/limit filters, both
 * `.maybeSingle()` / `.single()` terminals, a `{ count: "exact", head: true }`
 * select mode, and awaiting the chain directly (which real supabase-js query
 * builders also support).
 */
type Row = Record<string, unknown>;
type Filter = { col: string; op: "eq" | "neq" | "in" | "gte"; value: unknown };

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every((f) => {
    if (f.op === "eq") return row[f.col] === f.value;
    if (f.op === "neq") return row[f.col] !== f.value;
    if (f.op === "in") return Array.isArray(f.value) && (f.value as unknown[]).includes(row[f.col]);
    if (f.op === "gte") {
      const rowValue = row[f.col];
      if (typeof rowValue === "string" && typeof f.value === "string") return rowValue >= f.value;
      return (rowValue as number) >= (f.value as number);
    }
    return true;
  });
}

let fakeIdCounter = 0;

class FakeQuery
  implements PromiseLike<{ data: Row[] | null; error: { message: string; code?: string } | null; count?: number }>
{
  private filters: Filter[] = [];
  private orderCol?: string;
  private ascending = true;
  private limitN?: number;
  private errorToReturn: { message: string; code?: string } | null = null;
  private pendingRows: Row[] | null = null;
  private countMode = false;

  constructor(private rows: Row[]) {}

  select(_columns?: string, opts?: { count?: string; head?: boolean }) {
    if (opts?.count) this.countMode = true;
    return this;
  }
  eq(col: string, value: unknown) {
    this.filters.push({ col, op: "eq", value });
    return this;
  }
  neq(col: string, value: unknown) {
    this.filters.push({ col, op: "neq", value });
    return this;
  }
  in(col: string, value: unknown[]) {
    this.filters.push({ col, op: "in", value });
    return this;
  }
  gte(col: string, value: unknown) {
    this.filters.push({ col, op: "gte", value });
    return this;
  }
  is(col: string, value: unknown) {
    this.filters.push({ col, op: "eq", value: value === null ? null : value });
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderCol = col;
    this.ascending = opts?.ascending ?? true;
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }

  insert(row: Row | Row[]) {
    const toInsert = (Array.isArray(row) ? row : [row]).map((r) => ({
      id: r.id ?? `fake-id-${(fakeIdCounter += 1)}`,
      created_at: r.created_at ?? new Date().toISOString(),
      updated_at: r.updated_at ?? new Date().toISOString(),
      ...r,
    }));
    this.rows.push(...toInsert);
    this.pendingRows = toInsert;
    return this;
  }

  update(values: Row) {
    const self = this;
    const applied = { done: false };
    const apply = () => {
      if (applied.done) return;
      applied.done = true;
      const matched = self.rows.filter((r) => matches(r, self.filters));
      for (const row of matched) Object.assign(row, values, { updated_at: new Date().toISOString() });
      self.pendingRows = matched;
    };
    const originalEq = this.eq.bind(this);
    const originalIn = this.in.bind(this);
    this.eq = (col: string, value: unknown) => {
      originalEq(col, value);
      apply();
      return this;
    };
    this.in = (col: string, value: unknown[]) => {
      originalIn(col, value);
      apply();
      return this;
    };
    apply();
    return this;
  }

  upsert(row: Row, opts?: { onConflict?: string }) {
    const conflictCols = (opts?.onConflict ?? "id").split(",").map((c) => c.trim());
    const existing = this.rows.find((r) => conflictCols.every((c) => r[c] === row[c]));
    if (existing) {
      Object.assign(existing, row, { updated_at: new Date().toISOString() });
      this.pendingRows = [existing];
    } else {
      const inserted = {
        id: row.id ?? `fake-id-${(fakeIdCounter += 1)}`,
        created_at: row.created_at ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...row,
      };
      this.rows.push(inserted);
      this.pendingRows = [inserted];
    }
    return this;
  }

  private resolveRows(): Row[] {
    if (this.pendingRows) return this.pendingRows;
    let result = this.rows.filter((r) => matches(r, this.filters));
    if (this.orderCol) {
      const col = this.orderCol;
      result = [...result].sort((a, b) => {
        const av = a[col] as string | number;
        const bv = b[col] as string | number;
        if (av < bv) return this.ascending ? -1 : 1;
        if (av > bv) return this.ascending ? 1 : -1;
        return 0;
      });
    }
    if (this.limitN != null) result = result.slice(0, this.limitN);
    return result;
  }

  async maybeSingle() {
    if (this.errorToReturn) return { data: null, error: this.errorToReturn };
    const rows = this.resolveRows();
    return { data: rows[0] ?? null, error: null };
  }

  async single() {
    if (this.errorToReturn) return { data: null, error: this.errorToReturn };
    const rows = this.resolveRows();
    return { data: rows[0] ?? null, error: rows[0] ? null : { message: "not found" } };
  }

  then<
    TResult1 = { data: Row[] | null; error: { message: string; code?: string } | null; count?: number },
    TResult2 = never,
  >(
    onfulfilled?:
      | ((value: {
          data: Row[] | null;
          error: { message: string; code?: string } | null;
          count?: number;
        }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    const rows = this.errorToReturn ? [] : this.resolveRows();
    const payload = this.errorToReturn
      ? { data: null, error: this.errorToReturn }
      : this.countMode
        ? { data: null, error: null, count: this.rows.filter((r) => matches(r, this.filters)).length }
        : { data: rows, error: null };
    return Promise.resolve(payload).then(onfulfilled, onrejected);
  }
}

export type FakeTables = Record<string, Row[]>;

export function createFakeAdmin(tables: FakeTables) {
  return {
    from(table: string) {
      if (!tables[table]) tables[table] = [];
      return new FakeQuery(tables[table]);
    },
  };
}
