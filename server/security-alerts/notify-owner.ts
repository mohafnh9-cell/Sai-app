import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendCriticalVulnerabilityEmail } from "@/lib/resend";

function log(event: string, fields: Record<string, unknown>) {
  console.info({ component: "security-alerts", event, ...fields });
}

async function resolveOrganizationOwnerEmail(
  admin: SupabaseClient,
  organizationId: string
): Promise<string | null> {
  const { data: owner } = await admin
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("role", "OWNER")
    .limit(1)
    .maybeSingle();
  if (!owner?.user_id) return null;

  const { data: profile } = await admin
    .from("profiles")
    .select("email")
    .eq("id", owner.user_id as string)
    .maybeSingle();

  const email = (profile?.email as string | null)?.trim();
  return email || null;
}

/**
 * M7 (audit): sendCriticalVulnerabilityEmail existed but had zero call
 * sites anywhere -- no critical-severity alert ever actually reached an
 * inbox. Called from deliverAlertCandidate, which already enforces the
 * real idempotency this needs: it only reaches its insert once per
 * dedupe_key (an existing row short-circuits earlier), so this only fires
 * once per distinct alert, never repeatedly for the same condition.
 *
 * Deliberately fire-and-forget from the caller's perspective: any failure
 * here (missing owner email, Resend API error, RESEND_API_KEY unset) is
 * caught and logged, never thrown -- alert delivery, and the scan that
 * triggered it, must never fail because notification email failed.
 */
export async function notifyOwnerOfCriticalAlert(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    projectId: string;
    projectName: string;
    alertId: string;
    titlePlain: string;
  }
): Promise<void> {
  try {
    const email = await resolveOrganizationOwnerEmail(admin, input.organizationId);
    if (!email) {
      log("critical_alert_email_skipped_no_owner_email", {
        organizationId: input.organizationId,
        projectId: input.projectId,
        alertId: input.alertId,
      });
      return;
    }

    await sendCriticalVulnerabilityEmail({
      to: email,
      projectName: input.projectName,
      vulnerabilityTitle: input.titlePlain,
      vulnerabilityId: input.alertId,
    });

    log("critical_alert_email_sent", {
      organizationId: input.organizationId,
      projectId: input.projectId,
      alertId: input.alertId,
    });
  } catch (error) {
    log("critical_alert_email_failed", {
      organizationId: input.organizationId,
      projectId: input.projectId,
      alertId: input.alertId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
