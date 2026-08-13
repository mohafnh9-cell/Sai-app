import "server-only";

import { projectVerdictHref } from "@/lib/navigation/project-hrefs";

export function buildProjectReportUrl(projectId: string): string | null {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) return null;
  const base = appUrl.replace(/\/$/, "");
  return `${base}${projectVerdictHref(projectId, { technical: "open" })}`;
}

export function buildProjectHistoryUrl(projectId: string): string | null {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) return null;
  const base = appUrl.replace(/\/$/, "");
  return `${base}/projects/${projectId}/scans`;
}
