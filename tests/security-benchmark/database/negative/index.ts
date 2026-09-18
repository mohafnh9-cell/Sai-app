import type { BenchmarkCase } from "../../types";

export const DATABASE_NEGATIVE_CASES: BenchmarkCase[] = [
  {
    id: "supabase.rls-missing-negative-01",
    ruleId: "supabase.rls-missing",
    expected: "no_detect",
    category: "database",
    language: "sql",
    framework: "postgres",
    kind: "negative",
    source: "existing-rule-test",
    description: "Plain Postgres schema accessed only through a server-mediated pg Pool -- no Supabase/PostgREST client exposure, so RLS is not the relevant control (rules.test.ts).",
    files: [
      {
        path: "database/schema.sql",
        content: "CREATE TABLE users (id serial primary key, email text);\nCREATE TABLE accounts (id serial primary key, user_id integer references users(id));",
      },
      {
        path: "server/db.ts",
        content: "import { Pool } from 'pg';\nconst pool = new Pool();\nexport async function getAccounts(userId) {\n  return pool.query('SELECT * FROM accounts WHERE user_id = $1', [userId]);\n}",
      },
    ],
  },
  {
    id: "database.unsafe-raw-query-negative-01",
    ruleId: "database.unsafe-raw-query",
    expected: "no_detect",
    category: "database",
    language: "typescript",
    framework: "prisma",
    kind: "negative",
    source: "benchmark-new",
    description: "Prisma's tagged-template $queryRaw with parameterized interpolation, not the Unsafe variant.",
    files: [{ path: "server/reports.ts", content: "await prisma.$queryRaw`SELECT * FROM reports WHERE id = ${reportId}`;" }],
  },
];
