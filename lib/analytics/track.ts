export type AnalyticsEvent =
  | "signup_completed"
  | "workspace_ready"
  | "github_connected"
  | "repository_selected"
  | "checkout_started"
  | "checkout_completed"
  | "first_review_requested"
  | "first_review_started"
  | "first_review_completed"
  | "first_review_failed"
  | "first_verdict_viewed"
  | "analyze_again_clicked"
  | "safe_fix_requested"
  | "second_review_completed"
  | "verdict_viewed"
  | "roadmap_viewed"
  | "priority_opened"
  | "fix_requested"
  | "technical_findings_opened"
  | "retry_scan_clicked"
  | "ready_to_ship_reached"
  | "coverage_methodology_opened"
  | "coverage_omissions_opened"
  | "production_journey_viewed"
  | "journey_range_changed"
  | "milestone_viewed"
  | "review_history_opened"
  | "latest_change_opened"
  | "production_journey_cta_clicked"
  | "production_intelligence_viewed"
  | "production_intelligence_cta_clicked"
  | "fix_prompt_copied"
  | "safe_fix_prompt_copied";

export type AnalyticsPayload = Record<string, string | number | boolean | null | undefined>;

export function trackEvent(event: AnalyticsEvent, payload?: AnalyticsPayload): void {
  if (process.env.NODE_ENV === "development") {
    console.info({ component: "analytics", event, ...payload });
  }

  if (typeof window === "undefined") return;

  void import("@vercel/analytics")
    .then(({ track }) => {
      track(event, payload as Record<string, string | number | boolean | null>);
    })
    .catch(() => undefined);
}
