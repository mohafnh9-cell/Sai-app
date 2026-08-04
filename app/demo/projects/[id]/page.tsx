import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  FolderGit2,
  ExternalLink,
  GitBranch,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProjectVerdictSummary } from "@/features/production-verdict/components/ProductionVerdictExperience";
import { getTranslator } from "@/lib/i18n/server";
import { ProjectWorkflowNav } from "@/features/mission-control/components/ProjectWorkflowNav";
import { ProductionIntelligencePanel } from "@/features/production-intelligence/components/ProductionIntelligencePanel";
import { AutopilotSection } from "@/features/autopilot/components/AutopilotSection";
import {
  buildDemoDataset,
  getDemoProject,
} from "@/features/demo/fixtures/build-demo-dataset";
import { demoHref } from "@/features/demo/paths";
import { parseDemoScenario } from "@/features/demo/scenarios";
import { DEMO_SCAN_ACME } from "@/features/demo/constants";
import type { ProjectRow } from "@/types/database";

const FRAMEWORK_LABELS: Record<string, string> = {
  NEXTJS: "Next.js",
  REACT: "React",
  VUE: "Vue",
  SVELTE: "SvelteKit",
  NUXT: "Nuxt",
  REMIX: "Remix",
  ASTRO: "Astro",
  OTHER: "Other",
};

export default async function DemoProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scenario?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const scenario = parseDemoScenario(query.scenario);
  const dataset = buildDemoDataset(scenario);
  const project = getDemoProject(dataset, id);
  if (!project) notFound();

  const { t } = await getTranslator("projects");
  const brain = dataset.projectBrains[id];
  const intelligence = dataset.intelligenceByProject[id] ?? null;
  const autopilot = dataset.autopilotByProject[id] ?? null;
  const latestReportHref = brain?.currentVerdict
    ? `/projects/${id}/scans/${DEMO_SCAN_ACME}/report`
    : undefined;
  const p = project as ProjectRow;

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-6xl">
      <Button variant="ghost" size="sm" asChild className="gap-1.5 -ml-1">
        <Link href={demoHref("/projects", scenario)}>
          <ArrowLeft className="h-4 w-4" />
          {t("backToProjects")}
        </Link>
      </Button>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-4 min-w-0">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-secondary">
            <FolderGit2 className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight truncate">{p.name}</h1>
            <div className="flex flex-wrap items-center gap-2 mt-1">
              {p.framework && (
                <Badge variant="secondary" className="text-xs">
                  {FRAMEWORK_LABELS[p.framework] ?? p.framework}
                </Badge>
              )}
              {p.github_repo && (
                <span className="text-xs text-muted-foreground flex items-center gap-1 truncate max-w-[240px]">
                  <GitBranch className="h-3 w-3 shrink-0" />
                  {p.github_repo.replace("https://github.com/", "")}
                  <ExternalLink className="h-3 w-3 shrink-0 opacity-50" />
                </span>
              )}
            </div>
          </div>
        </div>
        <Button variant="outline" size="sm" disabled aria-disabled>
          {t("edit")} (demo)
        </Button>
      </div>

      <ProjectWorkflowNav projectId={p.id} showSecurityTest={false} />

      {brain?.currentVerdict ? (
        <ProjectVerdictSummary
          verdict={brain.currentVerdict}
          projectId={p.id}
          latestScanHref={`/projects/${p.id}/scans/${DEMO_SCAN_ACME}`}
        />
      ) : (
        <div className="rounded-xl border border-dashed border-border/70 p-8 text-center text-sm text-muted-foreground">
          {t("runFirstReview")}
        </div>
      )}

      {intelligence && (
        <ProductionIntelligencePanel
          intelligence={intelligence}
          projectId={p.id}
          latestReportHref={latestReportHref}
          compact
        />
      )}

      {autopilot && <AutopilotSection view={autopilot} />}
    </div>
  );
}
