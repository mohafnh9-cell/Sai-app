"use client";

import { useCallback, useEffect, useState } from "react";
import { OnboardingBackButton } from "./OnboardingBackButton";
import { GitBranch, Lock, RefreshCw, Search, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { startGitHubOAuth } from "@/lib/github/oauth-client";
import { useI18n } from "@/lib/i18n/client";
import { formatRelativeLocalized } from "@/lib/i18n/format";
import type { GitHubRepo } from "@/lib/github";

type Step = "idle" | "loading" | "selecting" | "saving" | "error";

export function OnboardingRepoPicker({
  organizationId,
  onRepositoryConnected,
  onBack,
}: {
  organizationId?: string | null;
  onRepositoryConnected: (projectId: string, projectName?: string) => void;
  onBack?: () => void;
}) {
  const { t, locale } = useI18n("onboarding");
  const { t: tc } = useI18n("common");
  const [step, setStep] = useState<Step>("idle");
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const dateLabels = {
    never: tc("never"),
    justNow: tc("justNow"),
    minutesAgo: tc("minutesAgo"),
    hoursAgo: tc("hoursAgo"),
    daysAgo: tc("daysAgo"),
  };

  const fetchRepos = useCallback(async () => {
    setStep("loading");
    setErrorMsg("");

    const res = await fetch("/api/github/repos");
    const data = await res.json();

    if (data.needsReauth || res.status === 403) {
      localStorage.setItem("sequrai_github_connect", "1");
      await startGitHubOAuth("/onboarding?step=github");
      return;
    }

    if (!res.ok) {
      setErrorMsg(data.error || t("repoLoadFailed"));
      setStep("error");
      return;
    }

    setRepos(data.repos);
    setStep("selecting");
  }, [t]);

  useEffect(() => {
    queueMicrotask(() => void fetchRepos());
  }, [fetchRepos]);

  const saveRepo = async () => {
    const repo = repos.find((r) => r.id === selectedId);
    if (!repo) return;

    setStep("saving");
    setErrorMsg("");

    try {
      const res = await fetch("/api/github/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repos: [repo],
          ...(organizationId ? { organizationId } : {}),
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | {
            projectIds?: string[];
            saved?: number;
            error?: string;
            code?: string;
            needsReauth?: boolean;
            recovered?: boolean;
          }
        | null;

      if (data?.needsReauth || res.status === 403) {
        localStorage.setItem("sequrai_github_connect", "1");
        await startGitHubOAuth("/onboarding?step=github");
        return;
      }

      if (!res.ok) {
        if (data?.code === "repository_already_connected") {
          throw new Error(t("repoAlreadyConnectedOtherWorkspace"));
        }
        throw new Error(data?.error || t("repoConnectFailed"));
      }

      const projectId = data?.projectIds?.[0];
      if (!projectId) {
        throw new Error(t("projectResolveFailed"));
      }
      onRepositoryConnected(projectId, repo.full_name);
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : t("repoSaveFailed"));
      setStep("error");
    }
  };

  const filtered = repos.filter(
    (r) =>
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.full_name.toLowerCase().includes(search.toLowerCase())
  );

  if (step === "loading" || step === "idle") {
    return (
      <div className="space-y-4 animate-in fade-in duration-300">
        <h2 className="text-xl font-semibold">{t("chooseProjectTitle")}</h2>
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
          <RefreshCw className="h-4 w-4 animate-spin" aria-hidden />
          {t("loadingRepos")}
        </div>
      </div>
    );
  }

  if (step === "error") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">{t("chooseProjectTitle")}</h2>
        {repos.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 p-6 text-center space-y-3">
            <p className="text-sm font-medium">{t("noReposTitle")}</p>
            <p className="text-sm text-muted-foreground">{t("noReposBody")}</p>
          </div>
        ) : (
          <p className="text-sm text-destructive">{errorMsg}</p>
        )}
        <Button variant="outline" onClick={() => void fetchRepos()} className="gap-2">
          <RefreshCw className="h-4 w-4" />
          {tc("retry")}
        </Button>
      </div>
    );
  }

  if (repos.length === 0) {
    return (
      <div className="space-y-4 animate-in fade-in duration-300">
        <h2 className="text-xl font-semibold">{t("chooseProjectTitle")}</h2>
        <div className="rounded-xl border border-dashed border-border/70 p-6 text-center space-y-3">
          <p className="text-sm font-medium">{t("noReposTitle")}</p>
          <p className="text-sm text-muted-foreground">{t("noReposBody")}</p>
        </div>
        <Button variant="outline" onClick={() => void fetchRepos()} className="gap-2">
          <RefreshCw className="h-4 w-4" />
          {t("refreshRepos")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-500">
      {onBack && <OnboardingBackButton onClick={onBack} label={t("backToStart")} />}
      <div>
        <h2 className="text-xl font-semibold">{t("chooseProjectTitle")}</h2>
        <p className="text-sm text-muted-foreground mt-1">{t("chooseProjectSubtitle")}</p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("searchRepos")}
          className="pl-9"
          aria-label={t("searchRepos")}
        />
      </div>

      <ul className="space-y-2 max-h-[320px] overflow-y-auto pr-1" role="listbox" aria-label={t("searchRepos")}>
        {filtered.length === 0 ? (
          <li className="rounded-xl border border-dashed border-border/70 p-6 text-center space-y-3">
            <p className="text-sm font-medium">{t("searchNoResultsTitle")}</p>
            <p className="text-sm text-muted-foreground">{t("searchNoResultsBody")}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => setSearch("")}>
              {t("searchClear")}
            </Button>
          </li>
        ) : (
          filtered.map((repo) => {
          const selected = selectedId === repo.id;
          return (
            <li key={repo.id}>
              <button
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => setSelectedId(repo.id)}
                className={`w-full rounded-xl border p-4 text-left transition-all ${
                  selected
                    ? "border-primary bg-primary/10 ring-1 ring-primary/30"
                    : "border-border/60 bg-secondary/20 hover:border-border"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{repo.full_name}</p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        {t("updated")}{" "}
                        {formatRelativeLocalized(locale, repo.updated_at, dateLabels)}
                      </span>
                      <span className="flex items-center gap-1">
                        <GitBranch className="h-3 w-3" aria-hidden />
                        {repo.default_branch}
                      </span>
                      <span className="flex items-center gap-1">
                        {repo.private ? (
                          <Lock className="h-3 w-3" aria-hidden />
                        ) : (
                          <Unlock className="h-3 w-3" aria-hidden />
                        )}
                        {repo.private ? t("private") : t("public")}
                      </span>
                    </div>
                  </div>
                </div>
              </button>
            </li>
          );
        })
        )}
      </ul>

      <Button
        className="w-full"
        size="lg"
        disabled={selectedId == null || step === "saving"}
        onClick={() => void saveRepo()}
      >
        {step === "saving" ? t("connectingRepository") : t("analyzeRepository")}
      </Button>
    </div>
  );
}
