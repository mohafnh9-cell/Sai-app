import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LanguageSelector } from "@/components/shared/LanguageSelector";
import { getTranslator } from "@/lib/i18n/server";
import type { Metadata } from "next";
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
    <div className="p-4 sm:p-6 space-y-6 max-w-2xl">
      <PageHeader title={t("title")} description={t("subtitle")} />

      {org && (
        <Card className="border-border/50">
          <CardHeader className="pb-4">
            <CardTitle className="text-base">{ta("settings.title")}</CardTitle>
            <CardDescription>{ta("settings.subtitle")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <VerdictAutopilotToggle enabled={autopilotEnabled} />
            <p className="text-xs text-muted-foreground">
              {autopilotEnabled ? ta("settings.enabledHelp") : ta("settings.disabledHelp")}
            </p>
          </CardContent>
        </Card>
      )}

      {org && (
        <Card className="border-border/50">
          <CardHeader className="pb-4">
            <CardTitle className="text-base">{t("workspaceManageLink")}</CardTitle>
            <CardDescription>{t("workspaceManageDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <a href="/settings/workspaces" className="text-sm text-primary hover:underline">
              {t("workspaceManageCta")}
            </a>
          </CardContent>
        </Card>
      )}

      {org && (
        <Card className="border-border/50" id="mcp-setup">
          <CardHeader className="pb-4">
            <CardTitle className="text-base">{t("mcpTitle")}</CardTitle>
            <CardDescription>{t("mcpSubtitle")}</CardDescription>
          </CardHeader>
          <CardContent>
            <McpApiKeysPanel />
          </CardContent>
        </Card>
      )}

      <Card className="border-border/50">
        <CardHeader className="pb-4">
          <CardTitle className="text-base">{t("languageTitle")}</CardTitle>
          <CardDescription>{t("languageSubtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          <LanguageSelector variant="settings" />
        </CardContent>
      </Card>
    </div>
  );
}
