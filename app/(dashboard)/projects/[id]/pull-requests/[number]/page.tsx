import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VerdictStatusBadge } from "@/features/production-verdict/components/VerdictStatusBadge";
import { getCachedServerAuthContext } from "@/lib/server/request-cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getLatestPullRequestScan } from "@/server/pull-request/get-pr-verdict";

interface PageProps {
  params: Promise<{ id: string; number: string }>;
  searchParams: Promise<{ head?: string }>;
}

export default async function PullRequestSecurityPage({ params, searchParams }: PageProps) {
  const { id: projectId, number: prNumberRaw } = await params;
  const { head: headSha } = await searchParams;
  const pullRequestNumber = Number.parseInt(prNumberRaw, 10);
  if (!Number.isFinite(pullRequestNumber)) notFound();

  const auth = await getCachedServerAuthContext();
  if (!auth) redirect("/login");

  // Explicit organization_id filter, not just RLS -- this query already
  // selected organization_id but never actually compared it against the
  // caller's org (Phase 12 audit finding: selecting the field without using
  // it for authorization is not a check).
  const { data: project } = await auth.supabase
    .from("projects")
    .select("id, name, github_repo, organization_id")
    .eq("id", projectId)
    .eq("organization_id", auth.organizationId)
    .maybeSingle();
  if (!project) notFound();

  const admin = createAdminClient();
  const prScan = await getLatestPullRequestScan(admin, {
    projectId,
    pullRequestNumber,
    headSha: headSha ?? null,
  });

  const go =
    prScan?.verdictStatus === "ready_to_ship" && prScan.scanStatus === "completed";
  const noGo =
    prScan?.scanStatus === "completed" &&
    prScan.verdictStatus != null &&
    prScan.verdictStatus !== "ready_to_ship";

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-10">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/projects/${projectId}/mission-control`}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Mission Control
          </Link>
        </Button>
      </div>

      <div className="space-y-2">
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
          Pull Request · source: pr
        </p>
        <h1 className="text-2xl font-semibold">
          #{pullRequestNumber}
          {prScan?.pullRequestTitle ? ` · ${prScan.pullRequestTitle}` : ""}
        </h1>
        <p className="text-sm text-muted-foreground">{project.name}</p>
      </div>

      {!prScan ? (
        <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          No SequrAI analysis recorded for this pull request yet. Open or update the PR on GitHub to
          trigger an incremental scan.
        </div>
      ) : (
        <>
          <div className="rounded-xl border bg-card p-6 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium">Production Verdict</span>
              {prScan.verdictStatus ? (
                <VerdictStatusBadge status={prScan.verdictStatus as never} />
              ) : (
                <span className="text-sm text-muted-foreground">Pending analysis</span>
              )}
              {go && (
                <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-700">
                  GO
                </span>
              )}
              {noGo && (
                <span className="rounded-full bg-red-500/10 px-3 py-1 text-xs font-semibold text-red-700">
                  NO-GO
                </span>
              )}
            </div>

            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Latest analyzed commit</dt>
                <dd className="font-mono text-xs mt-1">{prScan.headCommitSha ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Score</dt>
                <dd className="mt-1">{prScan.score ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Blockers</dt>
                <dd className="mt-1">{prScan.blockersCount}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Scan status</dt>
                <dd className="mt-1 capitalize">{prScan.scanStatus.replace("_", " ")}</dd>
              </div>
            </dl>

            {headSha && prScan.headCommitSha && headSha !== prScan.headCommitSha && (
              <p className="text-sm text-amber-700">
                The requested commit differs from the latest analyzed head SHA. A newer commit may
                require a fresh scan.
              </p>
            )}
          </div>

          {prScan.topBlockers.length > 0 && (
            <div className="rounded-xl border p-6 space-y-3">
              <h2 className="font-medium">Top blockers</h2>
              <ul className="space-y-2 text-sm">
                {prScan.topBlockers.map((blocker) => (
                  <li key={blocker.title} className="flex justify-between gap-4">
                    <span>{blocker.title}</span>
                    <span className="text-muted-foreground uppercase text-xs">{blocker.severity}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            SequrAI publishes a GitHub Check Run named &quot;SequrAI — Production Verdict&quot; that
            can be required in branch protection. SequrAI does not change branch protection settings
            automatically.
          </p>
        </>
      )}
    </div>
  );
}
