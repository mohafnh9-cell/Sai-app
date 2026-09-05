import { redirect } from "next/navigation";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getCachedServerAuthContext } from "@/lib/server/request-cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAppAdminEmail } from "@/lib/auth/is-app-admin";
import { percentileSummary } from "@/server/observability/metrics";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin | SequrAI",
  robots: { index: false, follow: false },
};

const CONNECTION_STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  migration_reconnection_required: "destructive",
  revoked: "destructive",
  expired: "destructive",
  insufficient_scope: "destructive",
};

const CONNECTION_STATUS_LABEL: Record<string, string> = {
  active: "Activa",
  migration_reconnection_required: "Reconectar",
  revoked: "Revocada",
  expired: "Expirada",
  insufficient_scope: "Faltan permisos",
  not_connected: "Sin conectar",
};

const USERS_PAGE_SIZE = 200;

/** Supabase's admin listUsers only returns one page — loop until it stops filling up. */
async function listAllUsers(admin: SupabaseClient): Promise<User[]> {
  const users: User[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: USERS_PAGE_SIZE });
    if (error || !data?.users?.length) break;
    users.push(...data.users);
    if (data.users.length < USERS_PAGE_SIZE) break;
  }
  return users;
}

function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      {hint && (
        <CardContent className="pt-0 text-xs text-muted-foreground">{hint}</CardContent>
      )}
    </Card>
  );
}

export default async function AdminPage() {
  const auth = await getCachedServerAuthContext();
  if (!auth) redirect("/login");
  const emailVerified = auth.bypass || Boolean(auth.user.email_confirmed_at);
  if (!emailVerified || !isAppAdminEmail(auth.user.email)) redirect("/dashboard");

  const admin = createAdminClient();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [users, connectionsResult, orgsResult, projectsCountResult, scansResult, mcpKeysResult] =
    await Promise.all([
      listAllUsers(admin),
      admin
        .from("workspace_github_connections")
        .select("organization_id, github_login, status, connected_at, connected_by_user_id")
        .order("connected_at", { ascending: false }),
      admin.from("organizations").select("id, name"),
      admin.from("projects").select("id", { count: "exact", head: true }),
      admin
        .from("scans")
        .select("status, created_at, completed_at, metrics")
        .gte("created_at", thirtyDaysAgo)
        // Phase 23: this now also selects `metrics` (heavier than the prior
        // status/timestamps-only select) to surface registry-health stats
        // below -- bounded defensively since this is a force-dynamic page
        // with no other pagination.
        .order("created_at", { ascending: false })
        .limit(2000),
      admin
        .from("mcp_api_keys")
        .select("created_at, first_used_at")
        .gte("created_at", thirtyDaysAgo),
    ]);

  const totalUsers = users.length;
  const signupsLast7d = users.filter((u) => u.created_at && u.created_at > sevenDaysAgo).length;

  const orgNameById = new Map((orgsResult.data ?? []).map((o) => [o.id, o.name as string]));
  const userEmailById = new Map(users.map((u) => [u.id, u.email ?? "—"]));
  const connections = connectionsResult.data ?? [];

  const scans = scansResult.data ?? [];
  const completedDurations = scans
    .filter((s) => s.status === "completed" && s.completed_at)
    .map((s) => (new Date(s.completed_at as string).getTime() - new Date(s.created_at).getTime()) / 1000);
  const p95 = percentileSummary(completedDurations);
  const failedCount = scans.filter((s) => s.status === "failed").length;
  const failureRate = scans.length ? ((failedCount / scans.length) * 100).toFixed(1) : "0.0";

  // Phase 23 -- registry/dependency-intelligence health, sourced from the
  // aggregate-only registryMetrics each scan already persists in its own
  // `metrics` column (Phase 22/23 instrumentation) -- no new table, no
  // per-dependency data, just per-scan aggregates rolled up here. A scan
  // with no registryMetrics (skipped, package-security didn't run, or
  // telemetry capture failed) is simply excluded, never treated as an error.
  const registryMetricsList = scans
    .map((s) => (s.metrics as { registryMetrics?: Record<string, number> } | null)?.registryMetrics)
    .filter((m): m is Record<string, number> => Boolean(m));
  const registryPhaseDurations = registryMetricsList
    .map((m) => m.registryPhaseDurationMs)
    .filter((v): v is number => typeof v === "number");
  const registryPhaseP = percentileSummary(registryPhaseDurations);
  const totalLookups = registryMetricsList.reduce((sum, m) => sum + (m.registryLookupCount ?? 0), 0);
  const totalUnavailable = registryMetricsList.reduce((sum, m) => sum + (m.unavailableCount ?? 0), 0);
  const totalTimeouts = registryMetricsList.reduce((sum, m) => sum + (m.timeoutCount ?? 0), 0);
  const totalNetworkRequests = registryMetricsList.reduce((sum, m) => sum + (m.networkRequestCount ?? 0), 0);
  const unavailableRate = totalNetworkRequests
    ? ((totalUnavailable / totalNetworkRequests) * 100).toFixed(2)
    : "0.00";
  const timeoutRate = totalNetworkRequests ? ((totalTimeouts / totalNetworkRequests) * 100).toFixed(2) : "0.00";
  const avgSemaphoreWaitMs = registryMetricsList.length
    ? Math.round(
        registryMetricsList.reduce((sum, m) => sum + (m.semaphoreWaitTotalMs ?? 0), 0) /
          registryMetricsList.length
      )
    : 0;

  const mcpKeys = mcpKeysResult.data ?? [];
  const mcpSetupDurations = mcpKeys
    .filter((k) => k.first_used_at)
    .map((k) => (new Date(k.first_used_at as string).getTime() - new Date(k.created_at).getTime()) / 1000);
  const mcpSetupP = percentileSummary(mcpSetupDurations);
  const mcpKeysNeverUsed = mcpKeys.filter((k) => !k.first_used_at).length;

  return (
    <div className="p-6 space-y-8 max-w-6xl">
      <PageHeader
        title="Admin"
        description="Métricas internas de usuarios, conexiones de GitHub y salud de scans. Visible solo para administradores."
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Usuarios totales" value={totalUsers} />
        <StatCard label="Registros últimos 7 días" value={signupsLast7d} />
        <StatCard label="Proyectos conectados" value={projectsCountResult.count ?? 0} />
        <StatCard
          label="Scans últimos 30 días"
          value={scans.length}
          hint={`${failureRate}% de fallos`}
        />
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <StatCard label="P50 veredicto" value={p95.p50 !== null ? `${p95.p50.toFixed(0)}s` : "—"} />
        <StatCard label="P95 veredicto" value={p95.p95 !== null ? `${p95.p95.toFixed(0)}s` : "—"} hint="Objetivo: <120s" />
        <StatCard label="P99 veredicto" value={p95.p99 !== null ? `${p95.p99.toFixed(0)}s` : "—"} />
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <StatCard
          label="P50 setup MCP"
          value={mcpSetupP.p50 !== null ? `${mcpSetupP.p50.toFixed(0)}s` : "—"}
        />
        <StatCard
          label="P95 setup MCP"
          value={mcpSetupP.p95 !== null ? `${mcpSetupP.p95.toFixed(0)}s` : "—"}
          hint="Objetivo: <60s"
        />
        <StatCard
          label="Keys MCP sin usar"
          value={mcpKeysNeverUsed}
          hint={`de ${mcpKeys.length} generadas en 30 días`}
        />
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          label="Registry P95 (fase)"
          value={registryPhaseP.p95 !== null ? `${(registryPhaseP.p95 / 1000).toFixed(1)}s` : "—"}
          hint={`de ${registryPhaseP.count} scans con telemetría`}
        />
        <StatCard
          label="Registry no disponible"
          value={`${unavailableRate}%`}
          hint={`Umbral: WARN >1%, CRITICAL >2-3%`}
        />
        <StatCard
          label="Timeout rate"
          value={`${timeoutRate}%`}
          hint={`de ${totalLookups} lookups totales`}
        />
        <StatCard
          label="Espera media de semáforo"
          value={`${avgSemaphoreWaitMs}ms`}
          hint="Presión del proceso (cap=32)"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Conexiones de GitHub</CardTitle>
          <CardDescription>Quién conectó su cuenta de GitHub a un workspace y el estado actual.</CardDescription>
        </CardHeader>
        <CardContent>
          {connections.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin conexiones registradas todavía.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/70 text-left text-muted-foreground">
                    <th className="pb-2 pr-3 font-medium">Usuario</th>
                    <th className="pb-2 pr-3 font-medium">Workspace</th>
                    <th className="pb-2 pr-3 font-medium">GitHub</th>
                    <th className="pb-2 pr-3 font-medium whitespace-nowrap">Estado</th>
                    <th className="pb-2 font-medium whitespace-nowrap">Conectado</th>
                  </tr>
                </thead>
                <tbody>
                  {connections.map((c, i) => (
                    <tr key={`${c.organization_id}-${i}`} className="border-b border-border/40 last:border-0">
                      <td className="py-2 pr-3 max-w-[160px] truncate">{userEmailById.get(c.connected_by_user_id) ?? "—"}</td>
                      <td className="py-2 pr-3 max-w-[120px] truncate">{orgNameById.get(c.organization_id) ?? c.organization_id}</td>
                      <td className="py-2 pr-3">{c.github_login ?? "—"}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        <Badge variant={CONNECTION_STATUS_VARIANT[c.status] ?? "outline"}>
                          {CONNECTION_STATUS_LABEL[c.status] ?? c.status}
                        </Badge>
                      </td>
                      <td className="py-2 text-muted-foreground whitespace-nowrap">
                        {c.connected_at ? new Date(c.connected_at).toLocaleDateString() : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Usuarios</CardTitle>
          <CardDescription>Todas las cuentas registradas, ordenadas por fecha de registro.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/70 text-left text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">Email</th>
                  <th className="pb-2 font-medium">Registrado</th>
                </tr>
              </thead>
              <tbody>
                {[...users]
                  .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
                  .map((u) => (
                    <tr key={u.id} className="border-b border-border/40 last:border-0">
                      <td className="py-2 pr-4">{u.email ?? "—"}</td>
                      <td className="py-2 text-muted-foreground">
                        {u.created_at ? new Date(u.created_at).toLocaleString() : "—"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
