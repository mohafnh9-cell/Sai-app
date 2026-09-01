"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { GitBranch, Webhook, Zap, RefreshCw, Check, Lock, Star } from "lucide-react";
import { IntegrationStatusBadge } from "@/components/sequrai";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { startGitHubOAuth } from "@/lib/github/oauth-client";
import { projectVerdictHref } from "@/lib/navigation/project-hrefs";
import type { GitHubRepo } from "@/lib/github";
import { useI18n } from "@/lib/i18n/client";
import { PageHeader } from "@/components/shared/PageHeader";
import { McpPromoBanner } from "@/features/mcp/components/McpPromoBanner";
import type { IntegrationConnectionState } from "@/lib/design-system/integration";

type Step = "idle" | "loading" | "selecting" | "saving" | "done" | "error";

type ConnectionPayload = {
  connection: {
    status:
      | "connected"
      | "not_connected"
      | "migration_reconnection_required"
      | "revoked"
      | "expired"
      | "insufficient_scope";
    githubLogin: string | null;
    connectedAt: string | null;
    repositoryCount: number;
    lastError: string | null;
  };
  workspaceId: string;
  workspaceName: string | null;
};

function mapGitHubConnectionStatus(
  status: ConnectionPayload["connection"]["status"] | undefined
): IntegrationConnectionState {
  switch (status) {
    case "connected":
      return "connected";
    case "migration_reconnection_required":
    case "insufficient_scope":
      return "warning";
    case "revoked":
    case "expired":
      return "error";
    default:
      return "not_connected";
  }
}

type WebhookHealthProject = {
  projectId: string;
  projectName: string;
  githubRepo: string | null;
  healthy: boolean;
  connectionStatus: string;
  lastError: string | null;
};

type WebhookHealthPayload = {
  projects: WebhookHealthProject[];
  summary: { total: number; healthy: number; degraded: number };
};

type GitHubAppStatusPayload = {
  configured: boolean;
  installation: {
    id: string;
    githubInstallationId: number;
    accountLogin: string;
    accountType: string;
    status: string;
    repositorySelection: string;
    installedAt: string;
  } | null;
  webhookUrl: string | null;
};

export default function IntegrationsPage() {
  const webhookPayloadUrl = useMemo(() => {
    const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://sequrai-app.vercel.app";
    return `${base.replace(/\/$/, "")}/api/webhooks/github`;
  }, []);

  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n("integrations");
  const { t: tc } = useI18n("common");
  const [connectionState, setConnectionState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [connection, setConnection] = useState<ConnectionPayload | null>(null);
  const [step, setStep] = useState<Step>("idle");
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [savedCount, setSavedCount] = useState(0);
  const [webhookSummary, setWebhookSummary] = useState<{
    created: number;
    existing: number;
    skipped: number;
    warnings: string[];
  } | null>(null);
  const [webhookHealth, setWebhookHealth] = useState<WebhookHealthPayload | null>(null);
  const [webhookHealthState, setWebhookHealthState] = useState<"idle" | "loading" | "ready" | "error">(
    "idle"
  );
  const [githubAppStatus, setGithubAppStatus] = useState<GitHubAppStatusPayload | null>(null);

  const fetchConnection = useCallback(async () => {
    setConnectionState("loading");
    setRepos([]);
    setSelected(new Set());
    setStep("idle");
    const res = await fetch("/api/github/connection", { cache: "no-store" });
    const data = (await res.json().catch(() => null)) as ConnectionPayload | { error?: string } | null;
    if (!res.ok || !data || !("connection" in data)) {
      setConnectionState("error");
      setErrorMsg(
        (data as { error?: string } | null)?.error ?? t("connectionLoadFailed")
      );
      return;
    }
    setConnection(data);
    setConnectionState("ready");
  }, [t]);

  const fetchWebhookHealth = useCallback(async () => {
    setWebhookHealthState("loading");
    const res = await fetch("/api/github/webhook-health", { cache: "no-store" });
    const data = (await res.json().catch(() => null)) as WebhookHealthPayload | null;
    if (!res.ok || !data) {
      setWebhookHealthState("error");
      return;
    }
    setWebhookHealth(data);
    setWebhookHealthState("ready");
  }, []);

  const fetchGitHubAppStatus = useCallback(async () => {
    const res = await fetch("/api/github/app/status", { cache: "no-store" });
    const data = (await res.json().catch(() => null)) as GitHubAppStatusPayload | null;
    if (!res.ok || !data) return;
    setGithubAppStatus(data);
  }, []);

  const fetchRepos = useCallback(async () => {
    setStep("loading");
    setErrorMsg("");

    const useAppRepos =
      githubAppStatus?.configured === true &&
      githubAppStatus.installation?.status === "active";

    const res = await fetch(useAppRepos ? "/api/github/app/repos" : "/api/github/repos");
    const data = await res.json();

    if (data.needsReauth || res.status === 403) {
      setStep("idle");
      setErrorMsg(data.error || t("githubNotConnected"));
      return;
    }

    if (!res.ok) {
      setErrorMsg(data.error || "Failed to load repos");
      setStep("error");
      return;
    }

    if (useAppRepos && data.installationActive === false) {
      setErrorMsg("GitHub App installation is not active for this workspace.");
      setStep("error");
      return;
    }

    setRepos(data.repos);
    setStep("selecting");
  }, [githubAppStatus, t]);

  const connectGitHub = useCallback(async () => {
    setErrorMsg("");
    try {
      if (githubAppStatus?.installation?.status === "active") {
        // The GitHub App is already installed for this account (e.g. after a
        // repo rename, or a stale local connection record). Redirecting to
        // GitHub's install URL in this state sends the user straight to
        // GitHub's own "manage installation" page instead of back to us --
        // there's nothing to install, just repos to load with what's
        // already granted.
        await fetchRepos();
        return;
      }
      if (githubAppStatus?.configured) {
        window.location.href = "/api/github/app/install?next=%2Fintegrations";
        return;
      }
      await startGitHubOAuth("/integrations");
    } catch (oauthError) {
      setErrorMsg(
        oauthError instanceof Error ? oauthError.message : t("connectFailed")
      );
      setStep("error");
    }
  }, [t, githubAppStatus, fetchRepos]);

  const disconnectGitHub = useCallback(async () => {
    setErrorMsg("");
    const res = await fetch("/api/github/connection", { method: "DELETE" });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setErrorMsg(data?.error ?? t("disconnectFailed"));
      return;
    }
    await fetchConnection();
  }, [fetchConnection, t]);

  useEffect(() => {
    queueMicrotask(() => void fetchConnection());
    queueMicrotask(() => void fetchGitHubAppStatus());
  }, [fetchConnection, fetchGitHubAppStatus]);

  useEffect(() => {
    if (connectionState !== "ready" || connection?.connection.status !== "connected") {
      return;
    }
    queueMicrotask(() => void fetchWebhookHealth());
  }, [connection?.connection.status, connectionState, fetchWebhookHealth]);

  const githubErrorParam = searchParams.get("githubError");
  const githubAppParam = searchParams.get("githubApp");
  const repoCountParam = searchParams.get("repoCount");
  const githubErrorMessage = useMemo(() => {
    if (!githubErrorParam) return null;
    const messages: Record<string, string> = {
      oauth_state_invalid: t("oauthStateInvalid"),
      oauth_state_expired: t("oauthStateExpired"),
      workspace_access_denied: t("workspaceAccessDenied"),
      github_connection_failed: t("connectFailed"),
    };
    return messages[githubErrorParam] ?? t("connectFailed");
  }, [githubErrorParam, t]);

  const githubAppMessage = useMemo(() => {
    if (!githubAppParam) return null;
    const errorMessages: Record<string, string> = {
      not_configured: t("githubAppNotConfigured"),
      invalid_setup: t("githubAppInvalidSetup"),
      invalid_installation: t("githubAppInvalidInstallation"),
      internal_error: t("githubAppInternalError"),
      state_mismatch: t("githubAppStateMismatch"),
      workspace_denied: t("githubAppWorkspaceDenied"),
      installation_not_found: t("githubAppInstallationNotFound"),
      installation_suspended: t("githubAppInstallationSuspended"),
      insufficient_permissions: t("githubAppInsufficientPermissions"),
    };
    if (githubAppParam === "installed") {
      return {
        kind: "success" as const,
        text: t("githubAppInstalled", { count: Number(repoCountParam) || 0 }),
      };
    }
    return { kind: "error" as const, text: errorMessages[githubAppParam] ?? t("githubAppConnectFailed") };
  }, [githubAppParam, repoCountParam, t]);

  useEffect(() => {
    if (!githubErrorParam && !githubAppParam) return;
    router.replace("/integrations", { scroll: false });
  }, [githubAppParam, githubErrorParam, router]);

  const githubAppErrorMessage = githubAppMessage?.kind === "error" ? githubAppMessage.text : null;
  const githubAppSuccessMessage = githubAppMessage?.kind === "success" ? githubAppMessage.text : null;

  const displayError = errorMsg || githubErrorMessage || githubAppErrorMessage || "";

  useEffect(() => {
    const pending = localStorage.getItem("sequrai_github_connect");
    if (pending) {
      localStorage.removeItem("sequrai_github_connect");
    }
  }, []);

  const toggleRepo = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(filtered.map((r) => r.id)));
  const clearAll = () => setSelected(new Set());

  const saveRepos = async () => {
    const toSave = repos.filter((r) => selected.has(r.id));
    if (!toSave.length) return;

    setStep("saving");
    setErrorMsg("");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await fetch("/api/github/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repos: toSave }),
        signal: controller.signal,
      });
      const data = (await res.json().catch(() => null)) as
        | {
            saved?: number;
            projectIds?: string[];
            error?: string;
            needsReauth?: boolean;
            webhooksCreated?: number;
            webhooksExisting?: number;
            webhooksSkipped?: number;
            webhookWarnings?: string[];
          }
        | null;
      if (data?.needsReauth || res.status === 403) {
        localStorage.setItem("sequrai_github_connect", "1");
        try {
          await connectGitHub();
        } catch (oauthError) {
          throw new Error(
            oauthError instanceof Error
              ? oauthError.message
              : "Could not start GitHub authorization."
          );
        }
        return;
      }
      if (!res.ok) {
        throw new Error(data?.error || `Could not save repositories (${res.status}).`);
      }

      setSavedCount(data?.saved ?? toSave.length);
      setWebhookSummary({
        created: data?.webhooksCreated ?? 0,
        existing: data?.webhooksExisting ?? 0,
        skipped: data?.webhooksSkipped ?? 0,
        warnings: data?.webhookWarnings ?? [],
      });
      const projectIds = data?.projectIds ?? [];
      if (projectIds.length === 1) {
        router.push(projectVerdictHref(projectIds[0], { connected: "1" }));
        return;
      }
      setStep("done");
    } catch (error) {
      setErrorMsg(
        error instanceof DOMException && error.name === "AbortError"
          ? "Saving took too long. Please try again."
          : error instanceof Error
            ? error.message
            : "Failed to save repositories."
      );
      setStep("error");
    } finally {
      window.clearTimeout(timeout);
    }
  };

  const filtered = repos.filter(
    (r) =>
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.full_name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 space-y-8 max-w-4xl">
      <PageHeader title={t("title")} description={t("subtitle")} />

      {connectionState === "ready" && connection?.connection.status === "connected" ? (
        <McpPromoBanner />
      ) : null}

      {/* GitHub Card */}
      <Card className="border-border/50">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary">
                <GitBranch className="h-5 w-5 text-foreground" />
              </div>
              <div>
                <CardTitle className="text-base">{t("githubTitle")}</CardTitle>
                <CardDescription className="text-xs">{t("githubSubtitle")}</CardDescription>
              </div>
            </div>
            <IntegrationStatusBadge
              status={mapGitHubConnectionStatus(connection?.connection.status)}
              label={
                connection?.connection.status === "connected"
                  ? t("statusConnected")
                  : connection?.connection.status === "migration_reconnection_required"
                    ? t("statusReconnectRequired")
                    : t("statusNotConnected")
              }
            />
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {connectionState === "loading" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" />
              {t("loadingConnection")}
            </div>
          )}

          {connectionState === "ready" && connection && (
            <div className="rounded-lg border border-border/50 bg-secondary/20 p-3 text-sm space-y-1">
              <p className="font-medium">{connection.workspaceName ?? t("currentWorkspace")}</p>
              {connection.connection.status === "connected" ? (
                <>
                  <p className="text-muted-foreground">
                    {t("connectedAs", { login: connection.connection.githubLogin ?? "GitHub" })}
                  </p>
                  <p className="text-muted-foreground">
                    {t("connectedRepositories", {
                      count: connection.connection.repositoryCount,
                    })}
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground">
                  {connection.connection.status === "migration_reconnection_required"
                    ? t("migrationReconnectBody")
                    : t("githubNotConnectedBody")}
                </p>
              )}
            </div>
          )}

          {connectionState === "ready" &&
            connection &&
            connection.connection.status !== "connected" && (
              <Button onClick={() => void connectGitHub()} className="gap-2">
                <GitBranch className="h-4 w-4" />
                {connection.connection.status === "migration_reconnection_required"
                  ? t("reconnectGitHub")
                  : t("connectGitHubToWorkspace")}
              </Button>
            )}

          {connectionState === "ready" &&
            connection?.connection.status === "connected" &&
            step === "idle" && (
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void fetchRepos()} className="gap-2">
                  <GitBranch className="h-4 w-4" />
                  {t("loadRepositories")}
                </Button>
                <Button variant="outline" onClick={() => void connectGitHub()}>
                  {t("reconnectGitHub")}
                </Button>
                <Button variant="ghost" onClick={() => void disconnectGitHub()}>
                  {t("disconnectGitHub")}
                </Button>
              </div>
            )}

          {githubAppSuccessMessage && !displayError && (
            <p className="text-sm text-emerald-600 dark:text-emerald-400">{githubAppSuccessMessage}</p>
          )}

          {connectionState === "ready" && step === "idle" && connection?.connection.status === "connected" && repos.length === 0 && !displayError && (
            <p className="text-sm text-muted-foreground">{t("loadRepositoriesHint")}</p>
          )}

          {step === "loading" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" />
              {t("loadingRepos")}
            </div>
          )}

          {(step === "error" || (step === "idle" && displayError)) && (
            <div className="space-y-3">
              <p className="text-sm text-destructive">{displayError}</p>
              <Button variant="outline" onClick={fetchRepos} className="gap-2">
                <RefreshCw className="h-4 w-4" />
                {tc("retry")}
              </Button>
            </div>
          )}

          {step === "done" && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-sm text-success">
                <Check className="h-4 w-4" />
                <span>{savedCount} repositories connected successfully.</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setStep("selecting");
                    setSavedCount(0);
                    setWebhookSummary(null);
                  }}
                >
                  Edit selection
                </Button>
              </div>
              {webhookSummary && (
                <div className="rounded-md border border-border/50 bg-secondary/20 p-3 text-xs space-y-1">
                  <p className="font-medium text-foreground">GitHub webhooks</p>
                  <p className="text-muted-foreground">
                    {webhookSummary.created} created · {webhookSummary.existing} already active
                    {webhookSummary.skipped > 0 ? ` · ${webhookSummary.skipped} skipped` : ""}
                  </p>
                  {webhookSummary.warnings.length > 0 && (
                    <ul className="text-warning space-y-0.5 list-disc pl-4">
                      {webhookSummary.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}

          {(step === "selecting" || step === "saving") && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Search repositories..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="max-w-sm h-8 text-sm"
                />
                <Button variant="ghost" size="sm" onClick={selectAll} className="text-xs">
                  Select all
                </Button>
                <Button variant="ghost" size="sm" onClick={clearAll} className="text-xs">
                  Clear
                </Button>
                <span className="text-xs text-muted-foreground ml-auto">
                  {selected.size} selected
                </span>
              </div>

              <div className="grid gap-2 max-h-96 overflow-y-auto pr-1">
                {filtered.map((repo) => {
                  const isSelected = selected.has(repo.id);
                  return (
                    <button
                      key={repo.id}
                      onClick={() => toggleRepo(repo.id)}
                      className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors w-full ${
                        isSelected
                          ? "border-primary/50 bg-primary/5"
                          : "border-border/50 hover:border-border"
                      }`}
                    >
                      <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        isSelected ? "bg-primary border-primary" : "border-muted-foreground/40"
                      }`}>
                        {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">{repo.full_name}</span>
                          {repo.private && <Lock className="h-3 w-3 text-muted-foreground shrink-0" />}
                        </div>
                        {repo.description && (
                          <p className="text-xs text-muted-foreground truncate mt-0.5">{repo.description}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {repo.language && (
                          <span className="text-xs text-muted-foreground">{repo.language}</span>
                        )}
                        {repo.stargazers_count > 0 && (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Star className="h-3 w-3" />
                            {repo.stargazers_count}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}

                {filtered.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-6">No repositories found</p>
                )}
              </div>

              <div className="flex items-center gap-2 pt-2 border-t border-border/50">
                <Button
                  onClick={saveRepos}
                  disabled={selected.size === 0 || step === "saving"}
                  className="gap-2"
                >
                  {step === "saving" ? (
                    <><RefreshCw className="h-4 w-4 animate-spin" />Saving...</>
                  ) : (
                    <><Check className="h-4 w-4" />Protect {selected.size} repo{selected.size !== 1 ? "s" : ""}</>
                  )}
                </Button>
                <Button variant="ghost" size="sm" onClick={fetchRepos} className="gap-1.5">
                  <RefreshCw className="h-3.5 w-3.5" />
                  Refresh
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {connectionState === "ready" && connection?.connection.status === "connected" && (
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Webhook className="h-4 w-4 text-primary" />
              <CardTitle className="text-sm">{t("webhookHealthTitle")}</CardTitle>
            </div>
            <CardDescription className="text-xs">{t("webhookHealthSubtitle")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-0 text-sm">
            {webhookHealthState === "loading" && (
              <div className="flex items-center gap-2 text-muted-foreground text-xs">
                <RefreshCw className="h-4 w-4 animate-spin" />
                {t("webhookHealthLoading")}
              </div>
            )}

            {webhookHealthState === "ready" && webhookHealth && (
              <>
                <p className="text-xs text-muted-foreground">
                  {webhookHealth.summary.degraded === 0
                    ? t("webhookHealthAllHealthy")
                    : t("webhookHealthSomeDegraded", { count: webhookHealth.summary.degraded })}
                </p>

                {webhookHealth.projects.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t("webhookHealthEmpty")}</p>
                ) : (
                  <ul className="space-y-2">
                    {webhookHealth.projects.map((project) => (
                      <li
                        key={project.projectId}
                        className="flex items-start justify-between gap-3 rounded-lg border border-border/50 bg-secondary/20 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="font-medium truncate">{project.projectName}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {project.githubRepo ?? "—"}
                          </p>
                          {project.lastError && (
                            <p className="text-xs text-warning mt-1">{project.lastError}</p>
                          )}
                        </div>
                        <IntegrationStatusBadge
                          status={project.healthy ? "connected" : "warning"}
                          label={
                            project.healthy ? t("webhookHealthHealthy") : t("webhookHealthDegraded")
                          }
                        />
                      </li>
                    ))}
                  </ul>
                )}

                {webhookHealth.summary.degraded > 0 && (
                  <p className="text-xs text-muted-foreground">{t("webhookHealthReconnect")}</p>
                )}

                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 px-0 h-auto text-xs"
                  onClick={() => void fetchWebhookHealth()}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {tc("retry")}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* GitHub webhook automation */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Webhook className="h-4 w-4 text-primary" />
            <CardTitle className="text-sm">GitHub Production Automation</CardTitle>
          </div>
          <CardDescription className="text-xs">
            Webhooks are registered automatically when you connect repositories. Manual setup is
            only needed if automation was skipped.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 pt-0 text-sm">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Payload URL</p>
            <code className="block rounded-md bg-secondary/50 px-3 py-2 text-xs break-all">
              {webhookPayloadUrl}
            </code>
          </div>
          <p className="text-xs text-muted-foreground">
            Events: <span className="text-foreground">push, pull_request, delete, repository</span>.
            Set the same secret as <code className="text-foreground">GITHUB_WEBHOOK_SECRET</code> in
            Vercel.
          </p>
        </CardContent>
      </Card>

      {/* Channel integrations */}
      <div className="grid gap-4 sm:grid-cols-2">
        {[
          { name: "Slack", description: "Get notified about critical issues in Slack.", icon: Zap },
          { name: "Discord", description: "Security alerts in your Discord server.", icon: Zap },
        ].map((item) => (
          <Card key={item.name} className="border-border/50 opacity-50">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary">
                  <item.icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <IntegrationStatusBadge status="inactive" label="Soon" />
              </div>
              <CardTitle className="text-sm mt-3">{item.name}</CardTitle>
              <CardDescription className="text-xs">{item.description}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
}
