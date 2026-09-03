import { redirect } from "next/navigation";
import Link from "next/link";
import { FolderGit2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/EmptyState";
import { PortfolioVerdictCard } from "@/features/production-verdict/components/PortfolioVerdictCard";
import { ProductionControlCenter } from "@/features/dashboard/components/ProductionControlCenter";
import { getCachedOrgBrain } from "@/server/brain/build-org-brain";
import { organizationHasProductionVerdict } from "@/server/onboarding/has-production-verdict";
import { getLatestVerdictsByOrganization } from "@/server/production-verdict/service";
import { getCachedServerAuthContext } from "@/lib/server/request-cache";
import { getTranslator } from "@/lib/i18n/server";
import {
  firstNameFromUser,
  greetingKeyForHour,
  pickPrimaryDashboardFocus,
} from "@/lib/dashboard/pick-primary-project";
import { partitionPortfolioProjects } from "@/lib/dashboard/filter-portfolio-projects";
import { onboardingResumePath } from "@/lib/onboarding/resume-path";
import { getWorkspaceGitHubConnectionView } from "@/server/github/workspace-connection-service";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Mission Control" };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ firstVerdict?: string; onboarded?: string }>;
}) {
  const params = await searchParams;
  const auth = await getCachedServerAuthContext();
  if (!auth) redirect("/login");
  const { t } = await getTranslator("dashboard");
  const { t: tv } = await getTranslator("verdict");
  const { t: tc } = await getTranslator("common");

  const { supabase, organizationId, user } = auth;

  if (!organizationId) {
    return (
      <div className="min-h-full flex flex-col items-center justify-center p-12">
        <EmptyState
          icon={FolderGit2}
          title={t("welcomeTitle")}
          description={t("welcomeBody")}
          action={{ label: t("firstVerdictCta"), href: "/onboarding" }}
          className="max-w-md border-none bg-transparent py-8"
        />
      </div>
    );
  }

  const [hasVerdict, { data: recentProjects }, brain, verdictsByProject, githubConnection] =
    await Promise.all([
      organizationHasProductionVerdict(supabase, organizationId),
      supabase
        .from("projects")
        .select("id, name, created_at, last_scan_at")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(8),
      getCachedOrgBrain(supabase, organizationId),
      getLatestVerdictsByOrganization(supabase, organizationId),
      getWorkspaceGitHubConnectionView(supabase, organizationId),
    ]);

  if (!hasVerdict) {
    const githubConnected = githubConnection.status === "connected";
    const resumeHref = onboardingResumePath({
      hasProjects: (recentProjects?.length ?? 0) > 0,
      firstProjectId: recentProjects?.[0]?.id,
      githubConnected,
    });
    const resumeLabel =
      recentProjects && recentProjects.length > 0
        ? t("resumeReviewCta")
        : githubConnected
          ? t("connectRepository")
          : t("firstVerdictCta");

    return (
      <div className="min-h-full flex flex-col items-center justify-center p-12">
        <EmptyState
          icon={FolderGit2}
          title={t("workspaceEmptyTitle")}
          description={t("workspaceEmptyBody")}
          action={{ label: resumeLabel, href: resumeHref }}
          className="max-w-md border-none bg-transparent py-8"
        />
      </div>
    );
  }

  const projectReadiness = new Map(brain.projects.map((item) => [item.projectId, item]));
  const focus = pickPrimaryDashboardFocus(brain.projects, verdictsByProject);
  const firstName = firstNameFromUser({
    fullName: user.user_metadata?.full_name as string | undefined,
    email: user.email,
  });
  const greeting = t(greetingKeyForHour(new Date().getHours()), { name: firstName });
  const projects = recentProjects ?? [];
  const showPortfolio = projects.length > 1;
  const { needsAttention } = partitionPortfolioProjects(projects, projectReadiness);
  const showNeedsAttention = showPortfolio && needsAttention.length > 0;
  const needsAttentionIds = new Set(needsAttention.map((p) => p.id));

  return (
    <div className="min-h-full">
      <div className="mx-auto max-w-6xl px-4 sm:px-8 py-8 sm:py-12 pb-20 space-y-12">
        {focus ? (
          <div className={showPortfolio ? "grid gap-6 lg:grid-cols-[1fr_320px] items-start" : undefined}>
            <ProductionControlCenter
              greeting={greeting}
              focus={focus}
              showFirstVerdictWelcome={params.firstVerdict === "1"}
              labels={{
                productionVerdict: tv("productionVerdict"),
                readyToShipQuestion: t("readyToShipQuestion"),
                deployYes: t("deployYes"),
                deployNo: t("deployNo"),
                almostReady: t("almostReady"),
                fixThisFirst: t("fixThisFirst"),
                fixIssue: t("fixIssue"),
                reviewProject: t("reviewProject"),
                firstVerdictWelcome: t("firstVerdictWelcome"),
              }}
            />
            {showPortfolio ? (
              <div className="rounded-xl border border-border bg-surface p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-border/40 pb-3">
                  <span className="text-sm text-muted-foreground">{t("yourAppsTitle")}</span>
                  <span className="text-lg font-semibold tabular-nums">{projects.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{t("needsAttentionTitle")}</span>
                  <span className="text-lg font-semibold tabular-nums">{needsAttention.length}</span>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {showPortfolio ? (
          <>
            {showNeedsAttention ? (
              <section className="space-y-4">
                <div>
                  <p className="text-label-caps">{t("needsAttentionTitle")}</p>
                  <p className="text-sm text-muted-foreground mt-1">{t("needsAttentionSubtitle")}</p>
                </div>
                <div className="space-y-1">
                  {needsAttention.map((project) => (
                    <PortfolioVerdictCard
                      key={project.id}
                      projectId={project.id}
                      projectName={project.name}
                      summary={projectReadiness.get(project.id)}
                      needsAttention
                    />
                  ))}
                </div>
              </section>
            ) : null}

            <section className="space-y-4">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="text-label-caps">{t("yourAppsTitle")}</p>
                  <p className="text-sm text-muted-foreground mt-1">{t("yourAppsSubtitle")}</p>
                </div>
                <Button variant="ghost" size="sm" asChild className="text-muted-foreground">
                  <Link href="/projects" className="gap-1.5">
                    {tc("viewAll")} <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              </div>

              {projects.length === 0 ? (
                <EmptyState
                  icon={FolderGit2}
                  title={t("noProjectsTitle")}
                  description={t("noProjectsBody")}
                  action={{ label: t("connectRepository"), href: "/integrations" }}
                />
              ) : (
                <div className="space-y-1">
                  {projects.map((project) => (
                    <PortfolioVerdictCard
                      key={project.id}
                      projectId={project.id}
                      projectName={project.name}
                      summary={projectReadiness.get(project.id)}
                      needsAttention={needsAttentionIds.has(project.id)}
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
