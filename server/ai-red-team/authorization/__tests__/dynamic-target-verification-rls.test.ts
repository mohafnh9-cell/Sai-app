import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "database/migrations/047_dynamic_target_verifications.sql"),
  "utf8"
);

describe("dynamic target verification RLS migration", () => {
  it("enables RLS and scopes reads to the authenticated organization", () => {
    expect(migration).toMatch(
      /alter table public\.dynamic_target_verifications enable row level security/i
    );
    expect(migration).toMatch(
      /m\.organization_id = dynamic_target_verifications\.organization_id/i
    );
    expect(migration).toMatch(/m\.user_id = auth\.uid\(\)/i);
  });

  it("requires the verification project to belong to the same organization", () => {
    expect(migration).toMatch(
      /constraint dynamic_target_verifications_tenant_fk[\s\S]*?foreign key \(project_id, organization_id\)[\s\S]*?references public\.projects \(id, organization_id\)/i
    );
    expect(migration).toMatch(/p\.id = dynamic_target_verifications\.project_id/i);
    expect(migration).toMatch(
      /p\.organization_id = dynamic_target_verifications\.organization_id/i
    );
  });

  it("does not expose verification tokens to anonymous users", () => {
    const policies = migration.match(/create policy[\s\S]*?;\s*/gi) ?? [];
    expect(policies).toHaveLength(1);
    expect(policies[0]).toMatch(/for select/i);
    expect(policies[0]).toMatch(/auth\.uid\(\)/i);
    expect(policies[0]).not.toMatch(/\bto\s+anon\b/i);
  });

  it("does not grant authenticated or anonymous token writes", () => {
    expect(migration).not.toMatch(
      /create policy[\s\S]*?\bfor\s+(?:all|insert|update|delete)\b/i
    );
  });

  it("keeps service-role writes available through the existing RLS pattern", () => {
    expect(migration).not.toMatch(/force row level security/i);
    expect(migration).toContain(
      "Writes remain service-role only because no"
    );
  });
});
