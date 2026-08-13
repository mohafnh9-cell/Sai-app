export const APP_LOCALES = ["en", "es"] as const;

export type AppLocale = (typeof APP_LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = "en";

export type MessageNamespace =
  | "common"
  | "navigation"
  | "auth"
  | "onboarding"
  | "dashboard"
  | "projects"
  | "verdict"
  | "productionJourney"
  | "productionIntelligence"
  | "repositorySync"
  | "automaticReview"
  | "automaticVerdictUpdate"
  | "autopilotExperience"
  | "integrations"
  | "settings"
  | "errors"
  | "notifications"
  | "technicalDetails"
  | "mcp"
  | "workspace"
  | "securityTest"
  | "attackCenter"
  | "missionControl"
  | "reviewProgress"
  | "evidenceFinding"
  | "landing"
  | "billing"
  | "readiness";

export type Messages = Record<string, string | Record<string, unknown>>;

export type TranslateParams = Record<string, string | number | null | undefined>;

export type Translator = (
  key: string,
  params?: TranslateParams
) => string;
