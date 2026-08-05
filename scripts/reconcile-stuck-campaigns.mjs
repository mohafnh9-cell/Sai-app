#!/usr/bin/env node
/**
 * Reconcile attack campaigns stuck in "running" when all executions are terminal.
 */
import { createAdminScriptClient } from "./lib/supabase-admin.mjs";

const admin = createAdminScriptClient();

async function main() {
  const { data: stuck, error } = await admin
    .from("attack_simulation_campaigns")
    .select("id, organization_id, status")
    .eq("status", "running");

  if (error) {
    console.error("Failed to list campaigns:", error.message);
    process.exit(1);
  }

  const { reconcileAttackCampaignCompletion } = await import(
    "../server/attack-simulation/persistence/reconcile-campaign-completion.ts"
  );

  let reconciled = 0;
  for (const campaign of stuck ?? []) {
    const result = await reconcileAttackCampaignCompletion(admin, {
      campaignId: campaign.id,
      organizationId: campaign.organization_id,
    });
    if (result?.status === "completed" || result?.status === "failed") {
      reconciled += 1;
      console.log("reconciled", campaign.id, "->", result.status);
    }
  }

  console.log(`Done. ${reconciled}/${stuck?.length ?? 0} campaigns reconciled.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
