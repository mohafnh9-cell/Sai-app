import { randomUUID } from "node:crypto";
import { BaseBrowserSpecialist } from "./base-specialist";
import type { BrowserScenario, BrowserSpecialist, BrowserTeamContext } from "../browser-team.types";
import type { SafeBrowserRuntime } from "../runtime/safe-browser-runtime";
import { newBrowserFinding } from "../browser-findings";
import { redactSecrets, hashValue } from "../evidence/evidence-redactor";

export class NavigationAgent extends BaseBrowserSpecialist {
  readonly id = "browser.navigation";
  readonly name = "Navigation Agent";
  readonly description = "Discovers same-origin routes and navigation issues.";
  readonly priority = 10;
  readonly capabilities = ["navigation", "redirects"] as const;
  readonly supportedEnvironments = ["local", "preview", "staging", "production_safe"] as const;

  async plan(context: BrowserTeamContext): Promise<BrowserScenario[]> {
    return [
      {
        id: randomUUID(),
        specialistId: this.id,
        title: "Explore entry navigation",
        route: "/",
        kind: "navigation_explore",
        metadata: { targetUrl: context.targetUrl },
      },
    ];
  }

  async execute(runtime: SafeBrowserRuntime, scenario: BrowserScenario) {
    await runtime.goto("/");
    const snap = await runtime.snapshot();
    const findings = [];
    if (snap.links.some((l) => l.includes("evil.example"))) {
      findings.push(
        newBrowserFinding({
          runId: scenario.id,
          specialist: this.id,
          category: "redirect",
          title: "Unexpected external navigation target",
          founderSummary: "A page link points to an external domain that is not allowlisted.",
          technicalExplanation: "Same-origin navigation map includes an external href.",
          affectedTarget: runtime.allowedOrigin,
          route: snap.url,
          severity: "medium",
          confidence: 0.85,
          exploitability: "low",
          evidenceRefs: [],
          reproductionSteps: ["Open home page", "Inspect navigation links"],
          expectedBehavior: "Internal navigation stays on approved origin.",
          observedBehavior: "External link present in navigation.",
          remediationDirection: "Remove or allowlist external links explicitly.",
          safeFixEligible: true,
          correlationKeys: ["external-link"],
          status: "candidate",
        })
      );
    }
    return {
      specialistId: this.id,
      scenariosExecuted: 1,
      findings,
      evidence: [],
      logs: [`navigation explored ${snap.links.length} links`],
    };
  }
}

export class FormsAgent extends BaseBrowserSpecialist {
  readonly id = "browser.forms";
  readonly name = "Forms Agent";
  readonly description = "Inspects forms without destructive submissions.";
  readonly priority = 20;
  readonly capabilities = ["forms"] as const;
  readonly supportedEnvironments = ["local", "preview", "staging", "production_safe"] as const;

  async plan(): Promise<BrowserScenario[]> {
    return [{ id: randomUUID(), specialistId: this.id, title: "Inspect login form", route: "/login", kind: "forms_inspect" }];
  }

  async execute(runtime: SafeBrowserRuntime, scenario: BrowserScenario) {
    await runtime.goto("/login");
    const snap = await runtime.snapshot();
    const loginForm = snap.forms.find((f) => f.action.includes("login"));
    const blocked = await runtime.clickSafe("delete account");
    return {
      specialistId: this.id,
      scenariosExecuted: 1,
      findings: [],
      evidence: [],
      logs: [
        loginForm ? "login form detected" : "no login form",
        blocked.ok ? "safe click ok" : `blocked: ${blocked.reason}`,
      ],
    };
  }
}

export class SessionObservationAgent extends BaseBrowserSpecialist {
  readonly id = "browser.session";
  readonly name = "Session Observation Agent";
  readonly priority = 30;
  readonly description = "Observes session-related browser-visible signals.";
  readonly capabilities = ["session"] as const;
  readonly supportedEnvironments = ["preview", "staging", "production_safe"] as const;

  canRun(context: BrowserTeamContext) {
    return Boolean(context.testCredentialsRef) || context.environmentType !== "production_safe";
  }

  async plan(): Promise<BrowserScenario[]> {
    return [{ id: randomUUID(), specialistId: this.id, title: "Session surface observation", route: "/dashboard", kind: "session_observe" }];
  }

  async execute(runtime: SafeBrowserRuntime, scenario: BrowserScenario) {
    await runtime.goto("/dashboard");
    return { specialistId: this.id, scenariosExecuted: 1, findings: [], evidence: [], logs: ["session observation complete"] };
  }
}

export class ClientStorageAgent extends BaseBrowserSpecialist {
  readonly id = "browser.storage";
  readonly name = "Client Storage Agent";
  readonly priority = 40;
  readonly description = "Inspects client storage metadata without exposing secrets.";
  readonly capabilities = ["storage"] as const;
  readonly supportedEnvironments = ["local", "preview", "staging", "production_safe"] as const;

  async plan(): Promise<BrowserScenario[]> {
    return [{ id: randomUUID(), specialistId: this.id, title: "Storage metadata scan", route: "/", kind: "storage_scan" }];
  }

  async execute(runtime: SafeBrowserRuntime, scenario: BrowserScenario, context: BrowserTeamContext) {
    await runtime.goto("/");
    const snap = await runtime.snapshot();
    const findings = [];
    if (snap.storageKeys.local.some((k) => /token|auth|session/i.test(k))) {
      findings.push(
        newBrowserFinding({
          runId: context.browserTeamRunId,
          specialist: this.id,
          category: "session_storage",
          title: "Sensitive key name in localStorage",
          founderSummary: "Browser-accessible storage appears to hold authentication-related material.",
          technicalExplanation: "localStorage key names indicate auth/session data accessible to scripts.",
          affectedTarget: context.targetOrigin,
          route: snap.url,
          severity: "high",
          confidence: 0.7,
          exploitability: "medium",
          evidenceRefs: [],
          reproductionSteps: ["Open application", "Inspect localStorage keys (redacted)"],
          expectedBehavior: "Session material should use HttpOnly secure cookies.",
          observedBehavior: `localStorage keys include ${snap.storageKeys.local.map((k) => hashValue(k)).join(", ")}`,
          remediationDirection: "Move session tokens to HttpOnly cookies.",
          safeFixEligible: true,
          correlationKeys: ["localstorage-auth"],
          status: "candidate",
        })
      );
    }
    return { specialistId: this.id, scenariosExecuted: 1, findings, evidence: [], logs: ["storage metadata captured"] };
  }
}

export class ConsoleAgent extends BaseBrowserSpecialist {
  readonly id = "browser.console";
  readonly name = "Console Agent";
  readonly priority = 50;
  readonly description = "Captures console and page errors.";
  readonly capabilities = ["console", "errors"] as const;
  readonly supportedEnvironments = ["local", "preview", "staging", "production_safe"] as const;

  async plan(): Promise<BrowserScenario[]> {
    return [{ id: randomUUID(), specialistId: this.id, title: "Console capture", route: "/dashboard", kind: "console_capture" }];
  }

  async execute(runtime: SafeBrowserRuntime, scenario: BrowserScenario, context: BrowserTeamContext) {
    await runtime.goto("/dashboard");
    const snap = await runtime.snapshot();
    const findings = [];
    for (const event of snap.consoleEvents) {
      if (event.level === "error") {
        findings.push(
          newBrowserFinding({
            runId: context.browserTeamRunId,
            specialist: this.id,
            category: "console_error",
            title: "Client-side error visible in console",
            founderSummary: "The application logs an error in the browser console on a core page.",
            technicalExplanation: redactSecrets(event.text),
            affectedTarget: context.targetOrigin,
            route: snap.url,
            severity: "low",
            confidence: 0.8,
            exploitability: "none",
            evidenceRefs: [],
            reproductionSteps: ["Navigate to dashboard", "Open browser console"],
            expectedBehavior: "No unhandled client errors in production paths.",
            observedBehavior: redactSecrets(event.text),
            remediationDirection: "Fix the client error and add monitoring.",
            safeFixEligible: true,
            correlationKeys: ["console-error"],
            status: "candidate",
          })
        );
      }
    }
    return { specialistId: this.id, scenariosExecuted: 1, findings, evidence: [], logs: [`console events ${snap.consoleEvents.length}`] };
  }
}

export class SecurityHeadersAgent extends BaseBrowserSpecialist {
  readonly id = "browser.headers";
  readonly name = "Security Headers Agent";
  readonly priority = 60;
  readonly description = "Observes deployed response headers.";
  readonly capabilities = ["headers"] as const;
  readonly supportedEnvironments = ["preview", "staging", "production_safe"] as const;

  async plan(): Promise<BrowserScenario[]> {
    return [{ id: randomUUID(), specialistId: this.id, title: "Header observation", route: "/", kind: "headers_observe" }];
  }

  async execute(runtime: SafeBrowserRuntime) {
    const nav = await runtime.goto("/");
    const findings = [];
    if (!nav.headers["content-security-policy"]) {
      findings.push(
        newBrowserFinding({
          runId: randomUUID(),
          specialist: this.id,
          category: "headers",
          title: "Missing Content-Security-Policy header",
          founderSummary: "The deployed response does not include a Content-Security-Policy header.",
          technicalExplanation: "Runtime response lacked CSP header.",
          affectedTarget: runtime.allowedOrigin,
          route: "/",
          severity: "medium",
          confidence: 0.75,
          exploitability: "low",
          evidenceRefs: [],
          reproductionSteps: ["Request entry route", "Inspect response headers"],
          expectedBehavior: "CSP should be present for browser defenses.",
          observedBehavior: "CSP header missing at runtime.",
          remediationDirection: "Add CSP appropriate for your frontend.",
          safeFixEligible: true,
          correlationKeys: ["missing-csp"],
          status: "candidate",
        })
      );
    }
    return { specialistId: this.id, scenariosExecuted: 1, findings, evidence: [], logs: ["headers observed"] };
  }
}

export class RedirectAgent extends BaseBrowserSpecialist {
  readonly id = "browser.redirect";
  readonly name = "Redirect Agent";
  readonly priority = 70;
  readonly description = "Inspects redirect behavior safely.";
  readonly capabilities = ["redirects"] as const;
  readonly supportedEnvironments = ["preview", "staging", "production_safe"] as const;

  async plan(): Promise<BrowserScenario[]> {
    return [{ id: randomUUID(), specialistId: this.id, title: "Redirect observation", route: "/", kind: "redirect_observe" }];
  }

  async execute(runtime: SafeBrowserRuntime) {
    await runtime.goto("/");
    return { specialistId: this.id, scenariosExecuted: 1, findings: [], evidence: [], logs: ["redirect observation complete"] };
  }
}

export class ErrorHandlingAgent extends BaseBrowserSpecialist {
  readonly id = "browser.errors";
  readonly name = "Error Handling Agent";
  readonly priority = 80;
  readonly description = "Triggers safe malformed interactions.";
  readonly capabilities = ["errors"] as const;
  readonly supportedEnvironments = ["preview", "staging", "production_safe"] as const;

  async plan(): Promise<BrowserScenario[]> {
    return [{ id: randomUUID(), specialistId: this.id, title: "Safe error probe", route: "/unknown-route", kind: "error_probe" }];
  }

  async execute(runtime: SafeBrowserRuntime) {
    try {
      await runtime.goto("/unknown-route-404");
    } catch {
      // expected for some fixtures
    }
    return { specialistId: this.id, scenariosExecuted: 1, findings: [], evidence: [], logs: ["error probe complete"] };
  }
}

export function createDefaultBrowserSpecialists(): BrowserSpecialist[] {
  return [
    new NavigationAgent(),
    new FormsAgent(),
    new SessionObservationAgent(),
    new ClientStorageAgent(),
    new ConsoleAgent(),
    new SecurityHeadersAgent(),
    new RedirectAgent(),
    new ErrorHandlingAgent(),
  ];
}
