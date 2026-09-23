/**
 * Minimal in-memory fake of the Supabase query builder surface used by the
 * MCP canonical tools and review_now's orchestration layer. Supports
 * select/insert/update/upsert with eq/neq/in/gte/order/limit filters, both
 * `.maybeSingle()` / `.single()` terminals, a `{ count: "exact", head: true }`
 * select mode, and awaiting the chain directly (which real supabase-js query
 * builders also support).
 */
type Row = Record<string, unknown>;
type Filter = { col: string; op: "eq" | "neq" | "in" | "gte" | "gt" | "lt" | "lte"; value: unknown };

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
    if (f.op === "gt") {
      const rowValue = row[f.col];
      if (typeof rowValue === "string" && typeof f.value === "string") return rowValue > f.value;
      return (rowValue as number) > (f.value as number);
    }
    if (f.op === "lt") {
      const rowValue = row[f.col];
      if (typeof rowValue === "string" && typeof f.value === "string") return rowValue < f.value;
      return (rowValue as number) < (f.value as number);
    }
    if (f.op === "lte") {
      const rowValue = row[f.col];
      if (typeof rowValue === "string" && typeof f.value === "string") return rowValue <= f.value;
      return (rowValue as number) <= (f.value as number);
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
  private rangeFrom = 0;
  private errorToReturn: { message: string; code?: string } | null = null;
  private pendingRows: Row[] | null = null;
  private pendingUpdateValues: Row | null = null;
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
  gt(col: string, value: unknown) {
    this.filters.push({ col, op: "gt", value });
    return this;
  }
  lt(col: string, value: unknown) {
    this.filters.push({ col, op: "lt", value });
    return this;
  }
  lte(col: string, value: unknown) {
    this.filters.push({ col, op: "lte", value });
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
  range(from: number, to: number) {
    this.rangeFrom = from;
    this.limitN = to - from + 1;
    return this;
  }

  insert(row: Row | Row[]) {
    const toInsert = (Array.isArray(row) ? row : [row]).map((r) => ({
      id:
        r.id ??
        `00000000-0000-4000-8000-${String((fakeIdCounter += 1)).padStart(12, "0")}`,
      created_at: r.created_at ?? new Date().toISOString(),
      updated_at: r.updated_at ?? new Date().toISOString(),
      ...r,
    }));
    this.rows.push(...toInsert);
    this.pendingRows = toInsert;
    return this;
  }

  update(values: Row) {
    // Lazy, like a real postgrest-js builder: the update isn't applied
    // until the FULL filter chain has been built and the query is actually
    // consumed (resolveRows(), on await/maybeSingle()/single()) -- applying
    // eagerly per-.eq()-call (as an earlier version of this fake did) means
    // a multi-filter chain like .update(...).eq("id", x).eq("org_id", y)
    // would apply the mutation after the FIRST .eq() alone, ignoring the
    // second filter entirely. That silently broke tenant-scoped update
    // assertions -- always resolve the complete filter set first.
    this.pendingUpdateValues = values;
    return this;
  }

  delete() {
    const matched = this.rows.filter((r) => matches(r, this.filters));
    this.rows.splice(0, this.rows.length, ...this.rows.filter((r) => !matches(r, this.filters)));
    this.pendingRows = matched;
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
        id:
          row.id ??
          `00000000-0000-4000-8000-${String((fakeIdCounter += 1)).padStart(12, "0")}`,
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
    if (this.pendingUpdateValues) {
      const values = this.pendingUpdateValues;
      this.pendingUpdateValues = null;
      const matched = this.rows.filter((r) => matches(r, this.filters));
      for (const row of matched) Object.assign(row, values, { updated_at: new Date().toISOString() });
      this.pendingRows = matched;
    }
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
    if (this.limitN != null) result = result.slice(this.rangeFrom, this.rangeFrom + this.limitN);
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

/**
 * Mirrors the real `consume_free_scan_credit` Postgres function (migration
 * 060) against the in-memory `subscriptions` table: self-heals a missing
 * row, then conditionally increments `free_scans_used` only while it is
 * below `p_limit`. This proves the decision logic (2 allowed, 3rd rejected;
 * per-organization isolation) is correct. It does NOT prove true concurrent-
 * request safety under real load -- that guarantee comes from Postgres row
 * locking in the real function and can only be verified against a live
 * database, not this synchronous, single-threaded fake.
 */
function fakeConsumeFreeScanCredit(tables: FakeTables, args: Record<string, unknown>) {
  const organizationId = args.p_organization_id as string;
  const limit = args.p_limit as number;
  if (!tables.subscriptions) tables.subscriptions = [];
  let row = tables.subscriptions.find((r) => r.organization_id === organizationId);
  if (!row) {
    row = {
      id: `00000000-0000-4000-8000-${String((fakeIdCounter += 1)).padStart(12, "0")}`,
      organization_id: organizationId,
      plan: "FREE",
      status: "canceled",
      free_scans_used: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    tables.subscriptions.push(row);
  }
  const used = (row.free_scans_used as number | undefined) ?? 0;
  if (used >= limit) return { data: false, error: null };
  row.free_scans_used = used + 1;
  row.updated_at = new Date().toISOString();
  return { data: true, error: null };
}

/**
 * Mirrors the real claim_next_security_job Postgres function (migration
 * 063): atomically claims the oldest/highest-priority QUEUED row, flips it
 * to RUNNING, and returns it -- or returns no row if nothing is queued.
 * Single-threaded here, so it doesn't prove real FOR UPDATE SKIP LOCKED
 * concurrency safety (that guarantee comes from Postgres row locking in the
 * real function), but it does prove the claim-then-transition contract the
 * worker code depends on.
 */
function fakeClaimNextSecurityJob(tables: FakeTables, args: Record<string, unknown>) {
  const workerId = args.p_worker_id as string;
  const jobs = tables.security_jobs ?? [];
  const queued = jobs
    .filter((r) => r.status === "QUEUED")
    .sort((a, b) => {
      const priorityDiff = ((b.priority as number) ?? 0) - ((a.priority as number) ?? 0);
      if (priorityDiff !== 0) return priorityDiff;
      return String(a.requested_at ?? "").localeCompare(String(b.requested_at ?? ""));
    });
  const job = queued[0];
  if (!job) return { data: [], error: null };

  job.status = "RUNNING";
  job.claimed_by = workerId;
  job.claimed_at = new Date().toISOString();
  job.started_at = new Date().toISOString();
  job.attempt = ((job.attempt as number) ?? 0) + 1;
  job.updated_at = new Date().toISOString();
  return { data: [job], error: null };
}

export function createFakeAdmin(tables: FakeTables) {
  return {
    from(table: string) {
      if (!tables[table]) tables[table] = [];
      return new FakeQuery(tables[table]);
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      if (fn === "consume_free_scan_credit") return fakeConsumeFreeScanCredit(tables, args);
      if (fn === "claim_next_security_job") return fakeClaimNextSecurityJob(tables, args);
      throw new Error(`unexpected rpc ${fn}`);
    },
  };
}
