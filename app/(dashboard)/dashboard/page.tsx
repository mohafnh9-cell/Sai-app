import { redirect } from "next/navigation";
import Link from "next/link";
import { FolderGit2, Plus, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/EmptyState";
import { PortfolioVerdictCard } from "@/features/production-verdict/components/PortfolioVerdictCard";
import { ProductionControlCenter } from "@/features/dashboard/components/ProductionControlCenter";
import { buildOrgBrain } from "@/server/brain/build-org-brain";
import { organizationHasProductionVerdict } from "@/server/onboarding/has-production-verdict";
import { getLatestVerdictsByOrganization } from "@/server/production-verdict/service";
import { getCachedServerAuthContext } from "@/lib/server/request-cache";
import { getTranslator } from "@/lib/i18n/server";
import {
  firstNameFromUser,
  greetingKeyForHour,
  pickPrimaryDashboardFocus,
} from "@/lib/dashboard/pick-primary-project";
import { onboardingResumePath } from "@/lib/onboarding/resume-path";
import { getWorkspaceGitHubConnectionView } from "@/server/github/workspace-connection-service";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Production Dashboard" };

export default async function DashboardPage() {
  const auth = await getCachedServerAuthContext();
  if (!auth) redirect("/login");
  const { t } = await getTranslator("dashboard");
  const { t: tc } = await getTranslator("common");

  const { supabase, organizationId, user } = auth;

  if (!organizationId) {
    return (
      <div className="app-cinematic-bg min-h-full flex flex-col items-center justify-center gap-8 p-12">
        <div className="surface-premium flex h-16 w-16 items-center justify-center rounded-2xl">
          <FolderGit2 className="h-8 w-8 text-primary" />
        </div>
        <div className="text-center max-w-md space-y-3">
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">{t("welcomeTitle")}</h1>
          <p className="text-muted-foreground">{t("welcomeBody")}</p>
        </div>
        <Button size="lg" className="rounded-xl shadow-premium" asChild>
          <Link href="/onboarding">
            <Plus className="mr-2 h-4 w-4" />
            {t("firstVerdictCta")}
          </Link>
        </Button>
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
    buildOrgBrain(supabase, organizationId),
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
      <div className="app-cinematic-bg min-h-full flex flex-col items-center justify-center gap-8 p-12">
        <div className="surface-premium flex h-16 w-16 items-center justify-center rounded-2xl">
          <FolderGit2 className="h-8 w-8 text-primary" />
        </div>
        <div className="text-center max-w-md space-y-3">
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">{t("workspaceEmptyTitle")}</h1>
          <p className="text-muted-foreground">{t("workspaceEmptyBody")}</p>
        </div>
        <Button size="lg" className="rounded-xl shadow-premium" asChild>
          <Link href={resumeHref}>
            <Plus className="mr-2 h-4 w-4" />
            {resumeLabel}
          </Link>
        </Button>
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

  return (
    <div className="app-cinematic-bg min-h-full">
      <div className="mx-auto max-w-5xl px-4 sm:px-8 pb-20">
        {focus && (
          <ProductionControlCenter
            greeting={greeting}
            focus={focus}
            labels={{
              canDeployQuestion: t("canDeployQuestion"),
              deployYes: t("deployYes"),
              deployNo: t("deployNo"),
              almostReady: t("almostReady"),
              fixThisFirst: t("fixThisFirst"),
              fixIssue: t("fixIssue"),
              reviewProject: t("reviewProject"),
              allReady: t("allReady"),
            }}
          />
        )}

        <section className="product-section space-y-6 pt-8 border-t border-border/40">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-lg font-medium tracking-tight">{t("projectsTitle")}</h2>
              <p className="text-sm text-muted-foreground mt-1">{t("projectsSecondary")}</p>
            </div>
            <Button variant="ghost" size="sm" asChild className="text-muted-foreground">
              <Link href="/projects" className="gap-1.5">
                {tc("viewAll")} <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>

          {!recentProjects || recentProjects.length === 0 ? (
            <EmptyState
              icon={FolderGit2}
              title={t("noProjectsTitle")}
              description={t("noProjectsBody")}
              action={{ label: t("connectRepository"), href: "/integrations" }}
            />
          ) : (
            <div className="space-y-2">
              {recentProjects.map((project) => {
                const summary = projectReadiness.get(project.id);
                return (
                  <PortfolioVerdictCard
                    key={project.id}
                    projectId={project.id}
                    projectName={project.name}
                    summary={summary}
                    lastActivityAt={project.last_scan_at ?? project.created_at}
                  />
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
