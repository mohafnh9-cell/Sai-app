import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ExternalLink, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProjectVerdictSummary } from "@/features/production-verdict/components/ProductionVerdictExperience";
import { ProjectSafeFixHero } from "@/features/projects/components/ProjectSafeFixHero";
import { ProjectOnboardedBanner } from "@/features/projects/components/ProjectOnboardedBanner";
import { ProjectSubNav } from "@/features/production-journey/components/ProjectSubNav";
import { ProductionIntelligencePanel } from "@/features/production-intelligence/components/ProductionIntelligencePanel";
import { buildProjectBrain } from "@/server/brain/build-project-brain";
import { getProjectReviewUiContext } from "@/server/projects/review-ui-context";
import { getCachedServerAuthContext } from "@/lib/server/request-cache";
import { getProductionIntelligence } from "@/server/production-intelligence/service";
import { getTranslator } from "@/lib/i18n/server";
import { fixPromptContextFromScan } from "@/features/production-verdict/fix-prompt-context";
import type { ProjectRow } from "@/types/database";
import type { Metadata } from "next";
import { isFeatureEnabled } from "@/server/feature-flags";

interface ProjectDetailPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ connected?: string; reviewComplete?: string; onboarded?: string }>;
}

export async function generateMetadata({
  params,
}: ProjectDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  const auth = await getCachedServerAuthContext();
  if (!auth?.organizationId) return { title: "Project" };
  const { data } = await auth.supabase
    .from("projects")
    .select("name")
    .eq("id", id)
    .maybeSingle();
  return { title: data?.name ?? "Project" };
}

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

export default async function ProjectDetailPage({
  params,
  searchParams,
}: ProjectDetailPageProps) {
  const { id } = await params;
  const query = await searchParams;
  const auth = await getCachedServerAuthContext();
  if (!auth?.organizationId) redirect("/login");

  const { t } = await getTranslator("projects");

  const { data: project, error } = await auth.supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !project) notFound();

  if (isFeatureEnabled("mission_control", { organizationId: auth.organizationId })) {
    const qs = new URLSearchParams();
    if (query.onboarded === "1") qs.set("onboarded", "1");
    if (query.connected === "1") qs.set("connected", "1");
    if (query.reviewComplete === "1") qs.set("reviewComplete", "1");
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    redirect(`/projects/${id}/mission-control${suffix}`);
  }

  const p = project as ProjectRow;

  const [brain, reviewContext, latestScanResult, intelligence] = await Promise.all([
    buildProjectBrain(auth.supabase, p.id),
    getProjectReviewUiContext(auth.supabase, p.id),
    auth.supabase
      .from("scans")
      .select("id, detected_stack")
      .eq("project_id", p.id)
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    getProductionIntelligence(auth.supabase, p.id, auth.user.id).catch(() => null),
  ]);

  if (!reviewContext) notFound();

  const latestScan = latestScanResult.data;
  const latestScanHref = latestScan?.id ? `/projects/${p.id}/scans/${latestScan.id}` : undefined;
  const latestReportHref = latestScan?.id
    ? `/projects/${p.id}/scans/${latestScan.id}/report`
    : undefined;

  const fixPromptContext = brain?.currentVerdict
    ? fixPromptContextFromScan({
        projectName: p.name,
        detectedStack: latestScan?.detected_stack,
        framework: p.framework,
        currentVerdictStatus: brain.currentVerdict.status,
        currentScore: brain.currentVerdict.score,
      })
    : undefined;

  return (
    <div className="app-cinematic-bg min-h-full">
      <div className="mx-auto max-w-5xl px-4 sm:px-8 pb-24 space-y-12 sm:space-y-16">
        <div className="pt-6 sm:pt-10 space-y-8 product-section">
          <Button variant="ghost" size="sm" asChild className="gap-1.5 -ml-2 text-muted-foreground">
            <Link href="/projects">
              <ArrowLeft className="h-4 w-4" />
              {t("backToProjects")}
            </Link>
          </Button>

          <div className="space-y-4">
            <h1 className="text-3xl sm:text-5xl font-semibold tracking-tight">{p.name}</h1>
            <div className="flex flex-wrap items-center gap-3">
              {p.framework && (
                <Badge variant="secondary" className="rounded-lg text-xs">
                  {FRAMEWORK_LABELS[p.framework] ?? p.framework}
                </Badge>
              )}
              {p.github_repo && (
                <a
                  href={p.github_repo}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors duration-200"
                >
                  <GitBranch className="h-3.5 w-3.5 shrink-0" />
                  {p.github_repo.replace("https://github.com/", "")}
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                </a>
              )}
            </div>
          </div>
        </div>

        {query.onboarded === "1" && brain?.currentVerdict && (
          <ProjectOnboardedBanner readyToShip={brain.currentVerdict.status === "ready_to_ship"} />
        )}

        {query.connected === "1" && (
          <div className="surface-premium rounded-2xl p-5 product-section">
            <p className="text-sm font-medium">{t("connectedGuidanceTitle")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t("connectedGuidanceBody")}</p>
          </div>
        )}

        {query.reviewComplete === "1" && brain?.currentVerdict && (
          <div className="surface-premium rounded-2xl p-5 product-section">
            <p className="text-sm font-medium">{t("reviewCompleteGuidanceTitle")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t("reviewCompleteGuidanceBody")}</p>
          </div>
        )}

        {reviewContext.isStale && (
          <div className="rounded-2xl border border-brand-warning/30 bg-brand-warning/5 px-5 py-4 text-sm text-foreground/90 product-section">
            {t("latestCommitNotReviewedBanner")}
          </div>
        )}

        {brain?.currentVerdict ? (
          <div className="product-section">
            <ProjectVerdictSummary
              verdict={brain.currentVerdict}
              projectId={p.id}
              latestScanHref={latestScanHref}
            />
          </div>
        ) : (
          <div className="surface-premium rounded-3xl p-12 text-center product-section">
            <p className="text-muted-foreground">{t("notAnalyzedYet")}</p>
          </div>
        )}

        {brain?.currentVerdict && (
          <ProjectSafeFixHero
            verdict={brain.currentVerdict}
            projectId={p.id}
            projectName={p.name}
            fixPromptContext={fixPromptContext}
            reviewContext={reviewContext}
          />
        )}

        <section className="product-section space-y-6 pt-4 border-t border-border/40">
          <ProjectSubNav projectId={p.id} latestReportHref={latestReportHref} />

          {intelligence && (
            <details className="surface-premium rounded-2xl p-5 group">
              <summary className="cursor-pointer text-sm font-medium list-none [&::-webkit-details-marker]:hidden">
                {t("secondaryDetails")}
              </summary>
              <div className="mt-6">
                <ProductionIntelligencePanel
                  intelligence={intelligence}
                  projectId={p.id}
                  latestReportHref={latestReportHref}
                  compact
                  topPriority={brain?.currentVerdict?.topPriorities[0]}
                  fixPromptContext={fixPromptContext}
                />
              </div>
            </details>
          )}
        </section>
      </div>
    </div>
  );
}
