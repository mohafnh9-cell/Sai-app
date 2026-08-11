import type { AppLocale, MessageNamespace, Messages } from "./types";
import { mergeMessages } from "./translate";

import enCommon from "@/messages/en/common.json";
import enNavigation from "@/messages/en/navigation.json";
import enAuth from "@/messages/en/auth.json";
import enOnboarding from "@/messages/en/onboarding.json";
import enDashboard from "@/messages/en/dashboard.json";
import enProjects from "@/messages/en/projects.json";
import enVerdict from "@/messages/en/verdict.json";
import enSettings from "@/messages/en/settings.json";
import enErrors from "@/messages/en/errors.json";
import enIntegrations from "@/messages/en/integrations.json";
import enProductionJourney from "@/messages/en/productionJourney.json";
import enProductionIntelligence from "@/messages/en/productionIntelligence.json";
import enRepositorySync from "@/messages/en/repositorySync.json";
import enAutomaticReview from "@/messages/en/automaticReview.json";
import enAutomaticVerdictUpdate from "@/messages/en/automaticVerdictUpdate.json";
import enAutopilotExperience from "@/messages/en/autopilotExperience.json";
import enTechnicalDetails from "@/messages/en/technicalDetails.json";
import enMcp from "@/messages/en/mcp.json";
import enWorkspace from "@/messages/en/workspace.json";
import enSecurityTest from "@/messages/en/securityTest.json";
import enAttackCenter from "@/messages/en/attackCenter.json";
import enMissionControl from "@/messages/en/missionControl.json";
import enReviewProgress from "@/messages/en/reviewProgress.json";
import enEvidenceFinding from "@/messages/en/evidenceFinding.json";
import enLanding from "@/messages/en/landing.json";
import enReadiness from "@/messages/en/readiness.json";

import esCommon from "@/messages/es/common.json";
import esNavigation from "@/messages/es/navigation.json";
import esAuth from "@/messages/es/auth.json";
import esOnboarding from "@/messages/es/onboarding.json";
import esDashboard from "@/messages/es/dashboard.json";
import esProjects from "@/messages/es/projects.json";
import esVerdict from "@/messages/es/verdict.json";
import esSettings from "@/messages/es/settings.json";
import esErrors from "@/messages/es/errors.json";
import esIntegrations from "@/messages/es/integrations.json";
import esProductionJourney from "@/messages/es/productionJourney.json";
import esProductionIntelligence from "@/messages/es/productionIntelligence.json";
import esRepositorySync from "@/messages/es/repositorySync.json";
import esAutomaticReview from "@/messages/es/automaticReview.json";
import esAutomaticVerdictUpdate from "@/messages/es/automaticVerdictUpdate.json";
import esAutopilotExperience from "@/messages/es/autopilotExperience.json";
import esTechnicalDetails from "@/messages/es/technicalDetails.json";
import esMcp from "@/messages/es/mcp.json";
import esWorkspace from "@/messages/es/workspace.json";
import esSecurityTest from "@/messages/es/securityTest.json";
import esAttackCenter from "@/messages/es/attackCenter.json";
import esMissionControl from "@/messages/es/missionControl.json";
import esReviewProgress from "@/messages/es/reviewProgress.json";
import esEvidenceFinding from "@/messages/es/evidenceFinding.json";
import esLanding from "@/messages/es/landing.json";
import esReadiness from "@/messages/es/readiness.json";

const PACKAGES: Record<AppLocale, Record<MessageNamespace, Messages>> = {
  en: {
    common: enCommon,
    navigation: enNavigation,
    auth: enAuth,
    onboarding: enOnboarding,
    dashboard: enDashboard,
    projects: enProjects,
    verdict: enVerdict,
    productionJourney: enProductionJourney,
    productionIntelligence: enProductionIntelligence,
    repositorySync: enRepositorySync,
    automaticReview: enAutomaticReview,
    automaticVerdictUpdate: enAutomaticVerdictUpdate,
    autopilotExperience: enAutopilotExperience,
    integrations: enIntegrations,
    settings: enSettings,
    errors: enErrors,
    notifications: enCommon,
    technicalDetails: enTechnicalDetails,
    mcp: enMcp,
    workspace: enWorkspace,
    securityTest: enSecurityTest,
    attackCenter: enAttackCenter,
    missionControl: enMissionControl,
    reviewProgress: enReviewProgress,
    evidenceFinding: enEvidenceFinding,
    landing: enLanding,
    readiness: enReadiness,
  },
  es: {
    common: esCommon,
    navigation: esNavigation,
    auth: esAuth,
    onboarding: esOnboarding,
    dashboard: esDashboard,
    projects: esProjects,
    verdict: esVerdict,
    productionJourney: esProductionJourney,
    productionIntelligence: esProductionIntelligence,
    repositorySync: esRepositorySync,
    automaticReview: esAutomaticReview,
    automaticVerdictUpdate: esAutomaticVerdictUpdate,
    autopilotExperience: esAutopilotExperience,
    integrations: esIntegrations,
    settings: esSettings,
    errors: esErrors,
    notifications: esCommon,
    technicalDetails: esTechnicalDetails,
    mcp: esMcp,
    workspace: esWorkspace,
    securityTest: esSecurityTest,
    attackCenter: esAttackCenter,
    missionControl: esMissionControl,
    reviewProgress: esReviewProgress,
    evidenceFinding: esEvidenceFinding,
    landing: esLanding,
    readiness: esReadiness,
  },
};

export function loadNamespace(locale: AppLocale, namespace: MessageNamespace): Messages {
  return PACKAGES[locale][namespace] ?? {};
}

export function loadAllMessages(locale: AppLocale): Messages {
  return mergeMessages(
    { common: PACKAGES[locale].common },
    { navigation: PACKAGES[locale].navigation },
    { auth: PACKAGES[locale].auth },
    { onboarding: PACKAGES[locale].onboarding },
    { dashboard: PACKAGES[locale].dashboard },
    { projects: PACKAGES[locale].projects },
    { verdict: PACKAGES[locale].verdict },
    { settings: PACKAGES[locale].settings },
    { errors: PACKAGES[locale].errors },
    { integrations: PACKAGES[locale].integrations },
    { productionJourney: PACKAGES[locale].productionJourney },
    { productionIntelligence: PACKAGES[locale].productionIntelligence },
    { repositorySync: PACKAGES[locale].repositorySync },
    { automaticReview: PACKAGES[locale].automaticReview },
    { automaticVerdictUpdate: PACKAGES[locale].automaticVerdictUpdate },
    { autopilotExperience: PACKAGES[locale].autopilotExperience },
    { technicalDetails: PACKAGES[locale].technicalDetails },
    { mcp: PACKAGES[locale].mcp },
    { workspace: PACKAGES[locale].workspace },
    { securityTest: PACKAGES[locale].securityTest },
    { attackCenter: PACKAGES[locale].attackCenter },
    { missionControl: PACKAGES[locale].missionControl },
    { reviewProgress: PACKAGES[locale].reviewProgress },
    { evidenceFinding: PACKAGES[locale].evidenceFinding },
    { landing: PACKAGES[locale].landing },
    { readiness: PACKAGES[locale].readiness }
  );
}

export function loadMessagesForNamespaces(
  locale: AppLocale,
  namespaces: MessageNamespace[]
): Messages {
  const uniqueNamespaces = [...new Set(namespaces)];
  return mergeMessages(
    ...uniqueNamespaces.map((namespace) => ({
      [namespace]: PACKAGES[locale][namespace] ?? {},
    }))
  );
}
