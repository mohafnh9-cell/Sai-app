export type BreadcrumbItem = {
  label: string;
  href?: string;
};

type BreadcrumbLabels = Record<string, string>;

const SEGMENT_KEYS: Record<string, keyof BreadcrumbLabels | string> = {
  dashboard: "missionControl",
  projects: "projects",
  "scanner-results": "scannerResults",
  new: "analyzeCode",
  integrations: "integrations",
  settings: "settings",
  onboarding: "onboarding",
  "mission-control": "productionIntelligence",
  "attack-center": "attackCenter",
  journey: "journey",
  billing: "billing",
};

const SKIP_SEGMENTS = new Set(["demo"]);

export function buildBreadcrumbsFromPathname(
  pathname: string,
  options?: {
    labels?: BreadcrumbLabels;
    projectName?: (projectId: string) => string | null;
  }
): BreadcrumbItem[] {
  const labels = options?.labels ?? {};
  const segments = pathname.split("/").filter(Boolean).filter((s) => !SKIP_SEGMENTS.has(s));
  if (segments.length === 0) {
    return [{ label: labels.missionControl ?? "Mission Control", href: "/dashboard" }];
  }

  const items: BreadcrumbItem[] = [];
  let path = "";

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!;
    path += `/${segment}`;

    if (segment === "projects" && segments[i + 1] && /^[0-9a-f-]{36}$/i.test(segments[i + 1]!)) {
      items.push({ label: labels.projects ?? "Projects", href: "/projects" });
      const projectId = segments[i + 1]!;
      const projectLabel = options?.projectName?.(projectId) ?? labels.project ?? "Project";
      path += `/${projectId}`;
      i += 1;
      items.push({ label: projectLabel, href: path });

      const next = segments[i + 1];
      if (next && SEGMENT_KEYS[next]) {
        const labelKey = SEGMENT_KEYS[next]!;
        items.push({
          label: labels[labelKey] ?? next.replace(/-/g, " "),
          href: i + 1 === segments.length - 1 ? undefined : `${path}/${next}`,
        });
        path += `/${next}`;
        i += 1;
      }
      continue;
    }

    const labelKey = SEGMENT_KEYS[segment];
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment);
    const isLast = i === segments.length - 1;
    if (isUuid && isLast) {
      // A trailing raw ID (e.g. a scan result's UUID) isn't a meaningful
      // breadcrumb label -- drop it rather than showing a dash-mangled UUID.
      continue;
    }
    const label = labelKey ? labels[labelKey] ?? segment.replace(/-/g, " ") : segment.replace(/-/g, " ");
    items.push({ label, href: isLast ? undefined : path });
  }

  return items;
}
