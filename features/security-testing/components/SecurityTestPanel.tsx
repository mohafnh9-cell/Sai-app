"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SecurityTestContext, SecurityTestOption } from "../types";
import type { ProjectReviewUiContext } from "@/server/projects/review-ui-context";
import { AnalyzeProjectButton } from "@/features/projects/components/AnalyzeProjectButton";
import { SecurityTestProgressSteps } from "./SecurityTestProgressSteps";
import { DEFAULT_SECURITY_TEST_IDS } from "../user-test-catalog";

function recommendedTestIds(tests: SecurityTestOption[]): string[] {
  const picked = tests.filter((test) => test.recommended).map((test) => test.id);
  if (picked.length > 0) return picked;
  return tests.slice(0, 4).map((test) => test.id);
}

export function SecurityTestPanel({
  projectId,
  context,
  reviewContext,
  compact = false,
}: {
  projectId: string;
  context: SecurityTestContext;
  reviewContext: ProjectReviewUiContext;
  compact?: boolean;
}) {
  const router = useRouter();
  const [chooseOpen, setChooseOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>(() => recommendedTestIds(context.availableTests));
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const defaultTestIds = useMemo(
    () => recommendedTestIds(context.availableTests),
    [context.availableTests]
  );

  useEffect(() => {
    if (!context.reviewInProgress && context.phase !== "preparing") return;
    const timer = window.setInterval(() => router.refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [context.phase, context.reviewInProgress, router]);

  const startTests = useCallback(
    async (testIds: string[]) => {
      setStarting(true);
      setError(null);
      try {
        const response = await fetch(`/api/projects/${projectId}/security-tests`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ testIds }),
        });
        const body = (await response.json().catch(() => null)) as {
          ok?: boolean;
          error?: string;
          code?: string;
          attackCenterHref?: string;
        } | null;

        if (body?.code === "needs_review") {
          setError(body.error ?? "Run a security review first.");
          return;
        }

        if (!response.ok || !body?.ok) {
          setError(body?.error ?? "Could not start the security test.");
          return;
        }

        router.push(body.attackCenterHref ?? context.attackCenterHref);
        router.refresh();
      } finally {
        setStarting(false);
        setChooseOpen(false);
      }
    },
    [context.attackCenterHref, projectId, router]
  );

  const toggleTest = (testId: string) => {
    setSelectedIds((current) =>
      current.includes(testId) ? current.filter((id) => id !== testId) : [...current, testId]
    );
  };

  const showChooseTests =
    context.secondaryActionLabel === "Choose tests" ||
    context.secondaryActionLabel === "Test again";

  const primaryIsReview = context.phase === "needs_review";

  const primaryIsPreparing = context.phase === "preparing";

  const primaryIsStart =
    context.phase === "ready" || context.secondaryActionLabel === "Test again";

  const primaryIsLive =
    context.phase === "running" ||
    context.primaryActionLabel === "View live test" ||
    context.primaryActionLabel === "View results" ||
    context.primaryActionLabel === "Protect my application";

  return (
    <section
      className={
        compact
          ? "space-y-5"
          : "rounded-3xl border border-primary/20 bg-gradient-to-b from-primary/5 to-transparent p-8 space-y-6"
      }
    >
      <div className="flex items-start gap-3">
        <div className="rounded-2xl bg-primary/10 p-3 text-primary">
          <Shield className="h-5 w-5" />
        </div>
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.22em] text-primary">Security test</p>
          <h2 className="text-xl sm:text-2xl font-semibold tracking-tight">{context.headline}</h2>
          <p className="text-sm text-muted-foreground max-w-2xl">{context.description}</p>
        </div>
      </div>

      <SecurityTestProgressSteps steps={context.progressSteps} />

      {context.phase === "ready" && context.latestScan ? (
        <p className="text-sm text-muted-foreground">
          Testing version <span className="font-mono">{context.latestScan.commitSha.slice(0, 7)}</span>
          {" · "}
          {context.availableTests.length} safe tests available
        </p>
      ) : null}

      {context.phase === "needs_review" ? (
        <p className="text-sm text-muted-foreground">
          First, SequrAI reviews your latest code version. Then it runs the safe attack tests you choose.
        </p>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex flex-wrap gap-3">
        {primaryIsPreparing ? (
          <Button type="button" size={compact ? "sm" : "default"} disabled>
            <Loader2 className="h-4 w-4 animate-spin" />
            {context.primaryActionLabel}
          </Button>
        ) : null}

        {primaryIsReview ? (
          <AnalyzeProjectButton
            projectId={projectId}
            initialContext={reviewContext}
            showCommitHint={!compact}
            size={compact ? "sm" : "default"}
            className={compact ? undefined : "min-w-[220px]"}
            labelOverride="Test my application"
          />
        ) : null}

        {primaryIsStart ? (
          <Button
            type="button"
            size={compact ? "sm" : "default"}
            disabled={starting || context.reviewInProgress}
            onClick={() => void startTests(defaultTestIds)}
          >
            {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {context.primaryActionLabel}
          </Button>
        ) : null}

        {primaryIsLive ? (
          <Button
            type="button"
            size={compact ? "sm" : "default"}
            onClick={() => router.push(context.attackCenterHref)}
          >
            {context.primaryActionLabel}
          </Button>
        ) : null}

        {showChooseTests ? (
          <Button
            type="button"
            variant="outline"
            size={compact ? "sm" : "default"}
            disabled={starting || context.reviewInProgress}
            onClick={() => {
              setSelectedIds(defaultTestIds);
              setChooseOpen(true);
            }}
          >
            {context.secondaryActionLabel ?? "Choose tests"}
          </Button>
        ) : null}

        {context.secondaryActionLabel === "View live test" && context.phase === "issues_found" ? (
          <Button
            type="button"
            variant="outline"
            size={compact ? "sm" : "default"}
            onClick={() => router.push(context.attackCenterHref)}
          >
            View live test
          </Button>
        ) : null}
      </div>

      <Dialog open={chooseOpen} onOpenChange={setChooseOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Choose tests</DialogTitle>
            <DialogDescription>
              SequrAI will safely simulate only the scenarios you select. Nothing runs against real
              users or production traffic.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-3 py-2">
            {context.availableTests.map((test) => {
              const checked = selectedIds.includes(test.id);
              return (
                <li key={test.id}>
                  <label className="flex cursor-pointer gap-3 rounded-xl border border-border/60 p-4 hover:bg-accent/20">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={checked}
                      onChange={() => toggleTest(test.id)}
                    />
                    <span className="space-y-1">
                      <span className="block font-medium">{test.title}</span>
                      <span className="block text-sm text-muted-foreground">{test.description}</span>
                      <span className="block text-xs text-muted-foreground">{test.categoryLabel}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setSelectedIds(DEFAULT_SECURITY_TEST_IDS.slice() as unknown as string[])}
            >
              Reset recommended
            </Button>
            <Button
              type="button"
              disabled={selectedIds.length === 0 || starting}
              onClick={() => void startTests(selectedIds)}
            >
              {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Start security test
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
