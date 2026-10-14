"use client";

import { Clock, Bell } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatRelativeDate } from "@/lib/utils";
import { normalizeTimelineTitle } from "@/brain";
import { useEffect, useState } from "react";
import { RelativeTimeLabel } from "@/components/ui/relative-time-label";

type ActivityItem = {
  id: string;
  project_id: string;
  event_type: string;
  title: string;
  description: string | null;
  occurred_at: string;
};

type NotificationItem = {
  id: string;
  title: string;
  body: string;
  severity: string;
  read_at: string | null;
  created_at: string;
};

export function ProductionTimelineFeed({ projectId }: { projectId?: string }) {
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams({ limit: "20" });
    if (projectId) params.set("projectId", projectId);
    fetch(`/api/security-activity?${params}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((body) => {
        setActivity(Array.isArray(body.activity) ? body.activity : []);
        setNotifications(Array.isArray(body.notifications) ? body.notifications : []);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [projectId]);

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" />
          <CardTitle className="text-base">Production Timeline</CardTitle>
        </div>
        <CardDescription className="text-xs">
          Build → Analyze → Improve → Production Ready → Deploy
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading timeline…</p>
        ) : activity.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No events yet. Connect GitHub to analyze every push automatically.
          </p>
        ) : (
          <div className="space-y-3">
            {activity.map((item) => (
              <div
                key={item.id}
                className="flex items-start gap-3 border-b border-border/40 pb-3 last:border-0 last:pb-0"
              >
                <div className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{normalizeTimelineTitle(item.title)}</p>
                  {item.description && (
                    <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                  )}
                  <p className="text-[11px] text-muted-foreground mt-1">
                    <RelativeTimeLabel iso={item.occurred_at} format={(now) => formatRelativeDate(item.occurred_at, now)} />
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {notifications.length > 0 && (
          <div className="pt-2 border-t border-border/50">
            <div className="flex items-center gap-2 mb-2">
              <Bell className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-xs font-medium text-muted-foreground">Notifications</p>
            </div>
            <div className="space-y-2">
              {notifications.slice(0, 5).map((item) => (
                <div key={item.id} className="rounded-md bg-secondary/30 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium">{normalizeTimelineTitle(item.title)}</p>
                    <Badge
                      variant={item.severity === "critical" ? "destructive" : "secondary"}
                      className="text-[10px]"
                    >
                      {item.severity}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** @deprecated Use ProductionTimelineFeed */
export const SecurityActivityFeed = ProductionTimelineFeed;
