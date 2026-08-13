"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { appendAnalysisRunSearchParams } from "@/features/analysis-runs/lib/build-run-query";
import { trackEvent } from "@/lib/analytics/track";
import { useRouter, useSearchParams } from "next/navigation";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import { markOnboardingWizardComplete } from "@/lib/onboarding/mark-onboarding-complete";
import {
  type OnboardingContext,
  type OnboardingProject,
  type WizardStep,
  parseLegacyStepParam,
  parseWizardStep,
  resolveInitialWizardStep,
  resolveOnboardingProjectId,
  shouldSkipGitHubStep,
} from "../onboarding-flow";
import { OnboardingProgressTracker } from "./OnboardingProgressTracker";
import { OnboardingWelcomeStep } from "./OnboardingWelcomeStep";
import { OnboardingGitHubStep } from "./OnboardingGitHubStep";
import { OnboardingRepoPicker } from "./OnboardingRepoPicker";
import { OnboardingReviewStep } from "./OnboardingReviewStep";
import { OnboardingFinaleStep } from "./OnboardingFinaleStep";
import { OnboardingCursorStep } from "./OnboardingCursorStep";

type FlowState = {
  projectId: string | null;
  projectName: string | null;
  scanId: string | null;
  verdict: ProductionVerdictV1 | null;
};

const WIDE_STEPS = new Set<WizardStep>(["review", "finale", "cursor"]);

function missionControlOnboardedHref(projectId: string, scanId: string | null): string {
  const params = new URLSearchParams({ onboarded: "1" });
  appendAnalysisRunSearchParams(params, scanId);
  return `/projects/${projectId}/mission-control?${params.toString()}`;
}

function normalizeStep(
  step: WizardStep,
  context: OnboardingContext,
  projectId: string | null,
  hasVerdict: boolean,
  explicitStep: WizardStep | null
): WizardStep {
  if (step === "github" && shouldSkipGitHubStep(context) && explicitStep !== "github") {
    return "repository";
  }
  if ((step === "review" || step === "finale") && !projectId) return "repository";
  if (step === "finale" && !hasVerdict) return "review";
  return step;
}

function resolveProjectName(
  projectId: string | null,
  projects: OnboardingProject[]
): string | null {
  if (!projectId) return null;
  return projects.find((project) => project.id === projectId)?.name ?? null;
}

export function OnboardingFlow({ initialContext }: { initialContext: OnboardingContext }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const explicitStep =
    parseWizardStep(searchParams.get("step")) ??
    parseLegacyStepParam(searchParams.get("step"));

  const forcedStep = explicitStep;
  const paramProjectId = searchParams.get("projectId");

  const checkoutSuccess = searchParams.get("checkout") === "success";

  useEffect(() => {
    if (checkoutSuccess) {
      trackEvent("checkout_completed");
    }
  }, [checkoutSuccess]);

  const [context, setContext] = useState(() =>
    checkoutSuccess && initialContext.hasOrg
      ? { ...initialContext, hasActiveSubscription: true }
      : initialContext
  );
  const [rawStep, setRawStep] = useState<WizardStep>(() =>
    resolveInitialWizardStep(initialContext, forcedStep)
  );
  const initialProjectId = resolveOnboardingProjectId(initialContext, paramProjectId);
  const [flow, setFlow] = useState<FlowState>(() => ({
    projectId: initialProjectId,
    projectName: resolveProjectName(initialProjectId, initialContext.projects),
    scanId: initialContext.latestCompletedScan?.id ?? initialContext.activeScan?.id ?? null,
    verdict: initialContext.latestVerdict,
  }));

  const step = useMemo(
    () =>
      normalizeStep(
        rawStep,
        context,
        flow.projectId,
        Boolean(flow.verdict ?? context.latestVerdict),
        explicitStep
      ),
    [rawStep, context, flow.projectId, flow.verdict, explicitStep]
  );

  const progressContext = useMemo(
    () => ({
      githubConnected: context.githubConnected || step !== "welcome",
      projects: flow.projectId
        ? [
            {
              id: flow.projectId,
              name: flow.projectName ?? "",
              githubRepo: null,
              defaultBranch: null,
              isPrivate: null,
              updatedAt: null,
            },
            ...context.projects,
          ]
        : context.projects,
      activeScan: context.activeScan,
      latestCompletedScan:
        flow.scanId && (flow.verdict ?? context.latestVerdict)
          ? {
              id: flow.scanId,
              projectId: flow.projectId ?? "",
              status: "completed",
              progress: 100,
              progressMessage: null,
            }
          : context.latestCompletedScan,
      latestVerdict: flow.verdict ?? context.latestVerdict,
    }),
    [context, flow, step]
  );

  const goTo = useCallback(
    (next: WizardStep, options?: { projectId?: string }) => {
      setRawStep(next);
      const params = new URLSearchParams({ step: next });
      const projectId = options?.projectId ?? flow.projectId;
      if (projectId && ["review", "finale", "cursor"].includes(next)) {
        params.set("projectId", projectId);
      }
      router.replace(`/onboarding?${params.toString()}`, { scroll: false });
    },
    [router, flow.projectId, setRawStep]
  );

  const finishWizard = useCallback(
    async (href: string) => {
      await markOnboardingWizardComplete();
      router.push(href);
    },
    [router]
  );

  const handleGitHubConnected = useCallback(() => {
    setContext((prev) => ({ ...prev, githubConnected: true }));
    goTo("repository");
  }, [goTo, setContext]);

  const handleRepositoryConnected = useCallback(
    (projectId: string, projectName?: string) => {
      setFlow((prev) => ({
        ...prev,
        projectId,
        projectName: projectName ?? prev.projectName,
        scanId: null,
        verdict: null,
      }));
      setContext((prev) => ({
        ...prev,
        projects: prev.projects.some((project) => project.id === projectId)
          ? prev.projects
          : [
              {
                id: projectId,
                name: projectName ?? "",
                githubRepo: null,
                defaultBranch: null,
                isPrivate: null,
                updatedAt: null,
              },
              ...prev.projects,
            ],
      }));
      goTo("review", { projectId });
    },
    [goTo, setFlow, setContext]
  );

  const handleReviewComplete = useCallback(
    (scanId: string, verdict: ProductionVerdictV1) => {
      setFlow((prev) => ({ ...prev, scanId, verdict }));
      setContext((prev) => ({ ...prev, latestVerdict: verdict }));
      goTo("finale");
    },
    [goTo, setFlow, setContext]
  );

  const activeVerdict = flow.verdict ?? context.latestVerdict;
  const activeProjectId = flow.projectId ?? context.projects[0]?.id ?? null;
  const activeProjectName =
    flow.projectName ??
    resolveProjectName(activeProjectId, context.projects) ??
    "Your app";

  const containerClass = WIDE_STEPS.has(step) ? "max-w-2xl" : "max-w-xl";

  return (
    <div className={`w-full ${containerClass} space-y-8 transition-all duration-500`}>
      {step !== "welcome" && step !== "cursor" && (
        <OnboardingProgressTracker wizardStep={step} context={progressContext} />
      )}

      {step === "welcome" && (
        <OnboardingWelcomeStep
          hasOrg={context.hasOrg}
          onContinue={() => goTo(context.githubConnected ? "repository" : "github")}
        />
      )}

      {step === "github" && (
        <OnboardingGitHubStep onConnected={handleGitHubConnected} onBack={() => goTo("welcome")} />
      )}

      {step === "repository" && (
        <OnboardingRepoPicker
          organizationId={context.orgId}
          onRepositoryConnected={handleRepositoryConnected}
          onBack={() => goTo(context.githubConnected ? "welcome" : "github")}
        />
      )}

      {step === "review" && flow.projectId && (
        <OnboardingReviewStep
          projectId={flow.projectId}
          existingScanId={flow.scanId}
          onComplete={handleReviewComplete}
        />
      )}

      {step === "finale" && activeVerdict && activeProjectId && (
        <OnboardingFinaleStep
          verdict={activeVerdict}
          projectId={activeProjectId}
          projectName={activeProjectName}
          onVerdictUpdated={(verdict) => {
            setFlow((prev) => ({ ...prev, verdict }));
            setContext((prev) => ({ ...prev, latestVerdict: verdict }));
          }}
          onConnectCursor={() => goTo("cursor", { projectId: activeProjectId })}
          onGoToDashboard={() => void finishWizard("/dashboard?onboarded=1")}
        />
      )}

      {step === "cursor" && (
        <OnboardingCursorStep
          onFinish={() => void finishWizard("/dashboard?onboarded=1")}
          onSkip={() => {
            const href = activeProjectId
              ? missionControlOnboardedHref(activeProjectId, flow.scanId)
              : "/dashboard?onboarded=1";
            void finishWizard(href);
          }}
        />
      )}
    </div>
  );
}
