import { redirect } from "next/navigation";
import Link from "next/link";
import { Plus, FolderGit2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { ProjectCard } from "@/features/projects/components/ProjectCard";
import { getCachedOrgBrain } from "@/server/brain/build-org-brain";
import { getCachedServerAuthContext } from "@/lib/server/request-cache";
import { getTranslator } from "@/lib/i18n/server";
import { projectNeedsAttention } from "@/lib/dashboard/filter-portfolio-projects";
import type { ProjectRow } from "@/types/database";
import type { Metadata } from "next";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator("projects");
  return { title: t("title") };
}

export default async function ProjectsPage() {
  const auth = await getCachedServerAuthContext();
  if (!auth) redirect("/login");
  if (!auth.organizationId) redirect("/onboarding");

  const { t } = await getTranslator("projects");

  const [{ data: projects }, brain] = await Promise.all([
    auth.supabase
      .from("projects")
      .select("*")
      .eq("organization_id", auth.organizationId)
      .order("created_at", { ascending: false }),
    getCachedOrgBrain(auth.supabase, auth.organizationId),
  ]);

  const summaryByProject = new Map(brain.projects.map((item) => [item.projectId, item]));
  const projectList = (projects ?? []) as ProjectRow[];

  const sorted = [...projectList].sort((a, b) => {
    const aAttention = projectNeedsAttention(
      summaryByProject.get(a.id),
      a.last_scan_at ?? a.created_at
    );
    const bAttention = projectNeedsAttention(
      summaryByProject.get(b.id),
      b.last_scan_at ?? b.created_at
    );
    if (aAttention !== bAttention) return aAttention ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="min-h-full">
      <div className="mx-auto max-w-4xl px-4 sm:px-8 py-8 sm:py-12 space-y-8">
        <PageHeader
          title={t("title")}
          description={t("subtitle", { count: projectList.length })}
          action={
            <Button size="sm" asChild>
              <Link href="/integrations">
                <Plus className="mr-2 h-4 w-4" />
                {t("connectRepository")}
              </Link>
            </Button>
          }
        />

        {projectList.length === 0 ? (
          <EmptyState
            icon={FolderGit2}
            title={t("noProjectsTitle")}
            description={t("noProjectsBody")}
            action={{ label: t("connectRepository"), href: "/integrations" }}
            className="py-16"
          />
        ) : (
          <div className="space-y-1">
            <p className="text-label-caps px-1 pb-2">{t("portfolioEyebrow")}</p>
            {sorted.map((project) => {
              const summary = summaryByProject.get(project.id);
              const needsAttention = projectNeedsAttention(
                summary,
                project.last_scan_at ?? project.created_at
              );
              return (
                <ProjectCard
                  key={project.id}
                  project={project}
                  summary={summary}
                  needsAttention={needsAttention}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
