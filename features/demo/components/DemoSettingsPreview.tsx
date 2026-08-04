import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LanguageSelector } from "@/components/shared/LanguageSelector";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getTranslator } from "@/lib/i18n/server";

export async function DemoSettingsPreview() {
  const { t } = await getTranslator("settings");
  const { t: ta } = await getTranslator("autopilotExperience");

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-2xl">
      <PageHeader title={t("title")} description="Read-only settings preview for product reviewers." />

      <Card className="border-border/50">
        <CardHeader className="pb-4">
          <CardTitle className="text-base">{ta("settings.title")}</CardTitle>
          <CardDescription>{ta("settings.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border border-border/50 p-3 opacity-70">
            <div>
              <p className="text-sm font-medium">{ta("settings.title")}</p>
              <p className="text-xs text-muted-foreground">{ta("settings.enabledHelp")}</p>
            </div>
            <Button size="sm" variant="outline" disabled aria-disabled>
              Enabled (demo)
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/50">
        <CardHeader className="pb-4">
          <CardTitle className="text-base">{t("mcpTitle")}</CardTitle>
          <CardDescription>{t("mcpSubtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 opacity-70">
          <div className="space-y-1.5">
            <Label htmlFor="demo-mcp-key">{t("mcpKeyNameLabel")}</Label>
            <Input id="demo-mcp-key" defaultValue="Cursor Connection (demo)" disabled readOnly />
          </div>
          <Button size="sm" disabled aria-disabled>
            {t("mcpGenerateKey")}
          </Button>
          <p className="text-xs text-muted-foreground">
            MCP keys are not generated in demo mode.
          </p>
        </CardContent>
      </Card>

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
