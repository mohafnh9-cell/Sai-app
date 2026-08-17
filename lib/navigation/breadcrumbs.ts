export type BreadcrumbItem = {
  label: string;
  href?: string;
};

type SegmentResolver = (segment: string, index: number, segments: string[]) => BreadcrumbItem | null;

const STATIC_LABELS: Record<string, string> = {
  dashboard: "Mission Control",
  projects: "Projects",
  integrations: "Integrations",
  settings: "Settings",
  onboarding: "Onboarding",
  "mission-control": "Production Intelligence",
  "attack-center": "Security Test",
  journey: "History",
  billing: "Billing",
};

const SKIP_SEGMENTS = new Set(["demo"]);

export function buildBreadcrumbsFromPathname(
  pathname: string,
  resolvers?: {
    projectName?: (projectId: string) => string | null;
  }
): BreadcrumbItem[] {
  const segments = pathname.split("/").filter(Boolean).filter((s) => !SKIP_SEGMENTS.has(s));
  if (segments.length === 0) return [{ label: "Mission Control", href: "/dashboard" }];

  const items: BreadcrumbItem[] = [];
  let path = "";

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!;
    path += `/${segment}`;

    if (segment === "projects" && segments[i + 1] && /^[0-9a-f-]{36}$/i.test(segments[i + 1]!)) {
      items.push({ label: STATIC_LABELS.projects ?? "Projects", href: "/projects" });
      const projectId = segments[i + 1]!;
      const projectLabel = resolvers?.projectName?.(projectId) ?? "Project";
      path += `/${projectId}`;
      i += 1;
      items.push({ label: projectLabel, href: path });

      const next = segments[i + 1];
      if (next && STATIC_LABELS[next]) {
        items.push({
          label: STATIC_LABELS[next]!,
          href: i + 1 === segments.length - 1 ? undefined : `${path}/${next}`,
        });
        path += `/${next}`;
        i += 1;
      }
      continue;
    }

    const label = STATIC_LABELS[segment] ?? segment.replace(/-/g, " ");
    const isLast = i === segments.length - 1;
    items.push({ label, href: isLast ? undefined : path });
  }

  return items;
}
