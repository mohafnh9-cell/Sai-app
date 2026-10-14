"use client";

import type { AutopilotDashboardView } from "@/brain/autopilot-experience";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/client";
import { formatRelativeLocalized } from "@/lib/i18n/format";
import { useDemoNavigation } from "@/features/demo/use-demo-navigation";
import { Button } from "@/components/ui/button";
import { RelativeTimeLabel } from "@/components/ui/relative-time-label";

export function AutopilotDashboardSection({
  view,
}: {
  view: AutopilotDashboardView;
}) {
  const { t, locale } = useI18n("autopilotExperience");
  const { href } = useDemoNavigation();
  const relativeLabels = {
    never: t("relative.never"),
    justNow: t("relative.justNow"),
    minutesAgo: t("relative.minutesAgo"),
    hoursAgo: t("relative.hoursAgo"),
    daysAgo: t("relative.daysAgo"),
  };

  if (!view.autopilotEnabled) {
    return null;
  }

  const latestReviewAt = view.latestAutomaticReviewAt;
  const latestReviewLabel = latestReviewAt ? (
    <RelativeTimeLabel iso={latestReviewAt} format={(now) => formatRelativeLocalized(locale, latestReviewAt, relativeLabels, now)} />
  ) : null;

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t("dashboard.title")}</CardTitle>
        <CardDescription>{t("oneLiner")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pt-0">
        <div className="text-sm text-muted-foreground">
          {view.monitoredCount > 0 ? (
            <>
              <span className="text-foreground font-medium">{view.monitoredCount}</span>{" "}
              {t("dashboard.monitored")}
              {latestReviewLabel && (
                <span className="block mt-1">
                  {t("dashboard.latestReview")}: {latestReviewLabel}
                  {view.latestAutomaticReviewProjectName &&
                    ` ${t("dashboard.latestReviewProject", { project: view.latestAutomaticReviewProjectName })}`}
                </span>
              )}
            </>
          ) : (
            t("dashboard.empty")
          )}
        </div>
        {view.monitoredCount === 0 && (
          <Button size="sm" variant="outline" asChild>
            <Link href={href("/integrations")}>{t("dashboard.connect")}</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
