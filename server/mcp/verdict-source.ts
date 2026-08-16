import "server-only";

export type VerdictSource = "local" | "github" | "pr";

export function githubVerdictSource(): { source: "github" } {
  return { source: "github" };
}

export function prVerdictSource(): { source: "pr" } {
  return { source: "pr" };
}

export async function resolveVerdictSourceForScan(
  admin: import("@supabase/supabase-js").SupabaseClient,
  scanId: string | null | undefined
): Promise<VerdictSource> {
  if (!scanId) return "github";

  const { data } = await admin
    .from("pull_request_scans")
    .select("id")
    .eq("scan_id", scanId)
    .maybeSingle();

  return data ? "pr" : "github";
}
