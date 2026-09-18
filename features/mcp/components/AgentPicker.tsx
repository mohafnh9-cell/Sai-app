"use client";

import { Terminal, Sparkles, MoreHorizontal } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/client";

export type SupportedAgent = "cursor" | "claude-code";

const AGENT_ICON: Record<SupportedAgent, typeof Terminal> = {
  cursor: Terminal,
  "claude-code": Sparkles,
};

/**
 * Level-1 choice: "which agent do I use?" Only agents the backend actually
 * supports (server/mcp genuinely handles their transport) appear here --
 * Codex is deliberately omitted rather than shown as if it works, per
 * lib/mcp/agent-integrations.ts's status: "unsupported" for that client.
 */
export function AgentPicker({
  onSelect,
  onOther,
}: {
  onSelect: (agent: SupportedAgent) => void;
  onOther: () => void;
}) {
  const { t } = useI18n("onboarding");

  const agents: { id: SupportedAgent; name: string }[] = [
    { id: "cursor", name: "Cursor" },
    { id: "claude-code", name: "Claude Code" },
  ];

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center sm:text-left">
        <p className="text-xs font-medium uppercase tracking-[0.22em] text-primary">
          {t("agentPickerEyebrow")}
        </p>
        <h2 className="text-2xl font-semibold tracking-tight">{t("agentPickerTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("agentPickerSubtitle")}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {agents.map((agent) => {
          const Icon = AGENT_ICON[agent.id];
          return (
            <Card key={agent.id} className="border-border/70 bg-secondary/20">
              <CardHeader className="pb-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <Icon className="h-5 w-5 text-primary" aria-hidden />
                </div>
                <CardTitle className="text-base">{agent.name}</CardTitle>
                <CardDescription>{t("agentPickerConnectSequrai")}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full" onClick={() => onSelect(agent.id)}>
                  {t("agentPickerConnect")}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onOther}
        className="mx-auto flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground seq-transition"
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden />
        {t("agentPickerOther")}
      </button>
    </div>
  );
}
