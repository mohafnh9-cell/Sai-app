import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/server/security-scanner/admin-client";

export function tryCreateMissionControlAdminClient(): SupabaseClient | null {
  try {
    return createAdminClient();
  } catch (error) {
    console.error({
      component: "mission-control",
      event: "admin_client_unavailable",
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
