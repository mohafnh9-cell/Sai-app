"use client";

import { Loader2, CheckCircle2, Clock, AlertCircle, Link2Off, RefreshCw } from "lucide-react";
import type { AutopilotProjectView } from "@/brain/autopilot-experience";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n/client";
import { formatRelativeLocalized } from "@/lib/i18n/format";
import { RelativeTimeLabel } from "@/components/ui/relative-time-label";

function StateIconGlyph({
  state,
  spinning,
}: {
  state: AutopilotProjectView["state"];
  spinning: boolean;
}) {
  const className = `h-3.5 w-3.5 ${spinning ? "animate-spin" : ""}`;
  switch (state) {
    case "reviewing_changes":
      return <Loader2 className={className} aria-hidden />;
    case "up_to_date":
      return <CheckCircle2 className={className} aria-hidden />;
    case "waiting_for_changes":
    case "enabled":
      return <Clock className={className} aria-hidden />;
    case "review_failed":
      return <AlertCircle className={className} aria-hidden />;
    case "repository_disconnected":
      return <Link2Off className={className} aria-hidden />;
    default:
      return <RefreshCw className={className} aria-hidden />;
  }
}

export function AutopilotSection({ view }: { view: AutopilotProjectView }) {
  const { t, locale } = useI18n("autopilotExperience");

  const spinning = view.state === "reviewing_changes";

  const relativeLabels = {
    never: t("relative.never"),
    justNow: t("relative.justNow"),
    minutesAgo: t("relative.minutesAgo"),
    hoursAgo: t("relative.hoursAgo"),
    daysAgo: t("relative.daysAgo"),
  };

  const lastReviewAt = view.lastAutomaticReviewAt;
  const lastReviewLabel = lastReviewAt ? (
    <RelativeTimeLabel iso={lastReviewAt} format={(now) => formatRelativeLocalized(locale, lastReviewAt, relativeLabels, now)} />
  ) : null;

  return (
    <Card className="border-border/50 bg-card/50">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <CardTitle className="text-base font-semibold tracking-tight">
              {t("title")}
            </CardTitle>
            <p className="text-sm text-muted-foreground">{t("oneLiner")}</p>
          </div>
          <Badge
            variant={view.state === "review_failed" ? "destructive" : "secondary"}
            className="shrink-0 gap-1.5"
          >
            <StateIconGlyph state={view.state} spinning={spinning} />
            {t(`states.${view.state}`)}
          </Badge>
        </div>
      </CardHeader>
      {lastReviewLabel && (
        <CardContent className="pt-0">
          <p className="text-xs text-muted-foreground">
            {t("lastReviewLabel")}:{" "}
            <span className="text-foreground">{lastReviewLabel}</span>
          </p>
        </CardContent>
      )}
    </Card>
  );
}
