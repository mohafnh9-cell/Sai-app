import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { SettingsSection } from "@/components/shared/SettingsSection";
import { LanguageSelector } from "@/components/shared/LanguageSelector";
import { getTranslator } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { DeleteAccountPanel } from "@/features/settings/DeleteAccountPanel";
import { VerdictAutopilotToggle } from "@/features/autopilot/components/VerdictAutopilotToggle";
import { McpApiKeysPanel } from "@/features/settings/McpApiKeysPanel";
import { isVerdictAutopilotEnabled } from "@/server/autopilot";
import { getServerAuthContext } from "@/lib/auth/dev-bypass";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const auth = await getServerAuthContext();
  if (!auth) redirect("/login");
  const { supabase, organizationId } = auth;
  const { t } = await getTranslator("settings");
  const { t: ta } = await getTranslator("autopilotExperience");

  const { data: org } = organizationId
    ? await supabase
        .from("organizations")
        .select("id, name, verdict_autopilot_enabled")
        .eq("id", organizationId)
        .maybeSingle()
    : { data: null };

  const autopilotEnabled = org
    ? await isVerdictAutopilotEnabled(supabase, org.id)
    : true;

  return (
    <div className="mx-auto max-w-2xl px-4 sm:px-8 py-8 sm:py-12">
      <PageHeader title={t("title")} description={t("subtitle")} className="mb-4" />

      {org ? (
        <SettingsSection title={ta("settings.title")} description={ta("settings.subtitle")}>
          <div className="space-y-3">
            <VerdictAutopilotToggle enabled={autopilotEnabled} />
            <p className="text-xs text-muted-foreground">
              {autopilotEnabled ? ta("settings.enabledHelp") : ta("settings.disabledHelp")}
            </p>
          </div>
        </SettingsSection>
      ) : null}

      {org ? (
        <SettingsSection
          title={t("workspaceManageLink")}
          description={t("workspaceManageDescription")}
        >
          <a href="/settings/workspaces" className="text-sm font-medium text-primary hover:underline">
            {t("workspaceManageCta")}
          </a>
        </SettingsSection>
      ) : null}

      {org ? (
        <SettingsSection id="mcp-setup" title={t("mcpTitle")} description={t("mcpSubtitle")}>
          <McpApiKeysPanel />
        </SettingsSection>
      ) : null}

      <SettingsSection title={t("languageTitle")} description={t("languageSubtitle")}>
        <LanguageSelector variant="settings" />
      </SettingsSection>

      <SettingsSection title={t("deleteAccountTitle")} variant="danger">
        <DeleteAccountPanel />
      </SettingsSection>
    </div>
  );
}
