import type { VerdictStatus } from "./schema";

/**
 * i18n key of the one-word "Can I deploy?" answer. The affirmative key is
 * only ever returned for a ready_to_ship verdict that the canonical evidence
 * gate (`verdictAffirmsDeploy`) affirmed; a ready_to_ship status without that
 * evidence gets the "limited" answer, never "YES".
 */
export function canIDeployKey(status: VerdictStatus, affirms: boolean): string {
  switch (status) {
    case "ready_to_ship":
      return affirms ? "verdict.canIDeploy.yes" : "verdict.canIDeploy.limited";
    case "almost_ready":
      return "verdict.canIDeploy.almost";
    case "insufficient_data":
    case "analysis_failed":
      return "verdict.canIDeploy.insufficient";
    default:
      return "verdict.canIDeploy.no";
  }
}
