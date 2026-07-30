const INFRASTRUCTURE_PG_CODES = new Set(["42P01", "PGRST205", "PGRST204", "42703"]);

export function isInfrastructurePgCode(code?: string | null): boolean {
  return code != null && INFRASTRUCTURE_PG_CODES.has(code);
}

export function infrastructureMigrationHint(): string {
  return "Apply database migration 042_attack_simulation_engine.sql (and 043 for Realtime) in Supabase, then reload the PostgREST schema cache.";
}
