import type { AttackAuthorizationRecord } from "../../../authorization";
import { normalizeRoutePath, RouteGraphBuilder } from "../exploration/route-graph";
import { redactSecrets } from "../evidence/evidence-redactor";
import type {
  SafeBrowserRuntime,
  SafeBrowserRuntimeFactory,
  SafeNavigationResult,
  SafeBrowserPageSnapshot,
} from "./safe-browser-runtime";
import { assertSafeInteraction, assertSafeNavigation } from "./safe-browser-runtime";
import type { ExecutionBudget } from "./execution-budget";

type MockPage = {
  path: string;
  title: string;
  links: string[];
  forms: SafeBrowserPageSnapshot["forms"];
  console: SafeBrowserPageSnapshot["consoleEvents"];
};

const FIXTURE_SITE: Record<string, MockPage> = {
  "/": {
    path: "/",
    title: "Fixture App Home",
    links: ["/login", "/dashboard", "/settings"],
    forms: [],
    console: [],
  },
  "/login": {
    path: "/login",
    title: "Login",
    links: ["/"],
    forms: [{ action: "/login", method: "POST", fields: ["email", "password"] }],
    console: [{ level: "warning", text: "Deprecated auth helper loaded" }],
  },
  "/dashboard": {
    path: "/dashboard",
    title: "Dashboard",
    links: ["/settings", "https://evil.example/phish"],
    forms: [],
    console: [{ level: "error", text: "TypeError: Cannot read property 'x'" }],
  },
  "/settings": {
    path: "/settings",
    title: "Settings",
    links: ["/dashboard"],
    forms: [{ action: "/settings/profile", method: "POST", fields: ["displayName"] }],
    console: [],
  },
};

export class MockSafeBrowserRuntime implements SafeBrowserRuntime {
  readonly allowedOrigin: string;
  private currentPath = "/";
  private readonly graph = new RouteGraphBuilder();
  private readonly consoleEvents: SafeBrowserPageSnapshot["consoleEvents"] = [];
  private readonly pageErrors: string[] = [];

  private constructor(
    private readonly baseUrl: string,
    allowedOrigin: string,
    private readonly authorization: AttackAuthorizationRecord,
    private readonly budget: ExecutionBudget,
    private readonly signal?: AbortSignal
  ) {
    this.allowedOrigin = allowedOrigin;
  }

  static async create(input: {
    targetUrl: string;
    authorization: AttackAuthorizationRecord;
    budget: ExecutionBudget;
    signal?: AbortSignal;
  }): Promise<MockSafeBrowserRuntime> {
    const url = new URL(input.targetUrl);
    return new MockSafeBrowserRuntime(
      url.origin,
      input.authorization.targetOrigin,
      input.authorization,
      input.budget,
      input.signal
    );
  }

  async goto(path: string): Promise<SafeNavigationResult> {
    if (this.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    this.budget.recordNavigation();
    this.budget.recordRequest();
    const absolute = new URL(path, this.baseUrl).toString();
    assertSafeNavigation(absolute, this.authorization);
    if (absolute.includes("evil.example")) {
      throw new Error("Navigation blocked: external origin");
    }
    this.currentPath = normalizeRoutePath(new URL(absolute).pathname);
    this.budget.recordRoute();
    this.graph.addNode(this.currentPath, this.classify(this.currentPath));
    return { url: absolute, status: 200, headers: { "content-type": "text/html" }, ok: true };
  }

  async snapshot(): Promise<SafeBrowserPageSnapshot> {
    const page = FIXTURE_SITE[this.currentPath] ?? {
      path: this.currentPath,
      title: "Unknown",
      links: [],
      forms: [],
      console: [],
    };
    for (const link of page.links) {
      if (link.startsWith("/")) this.graph.addEdge(this.currentPath, link, "navigation");
    }
    const events = [...this.consoleEvents, ...page.console].map((e) => ({
      ...e,
      text: redactSecrets(e.text),
    }));
    return {
      url: `${this.baseUrl}${page.path}`,
      title: page.title,
      links: page.links,
      forms: page.forms,
      consoleEvents: events,
      pageErrors: this.pageErrors.map(redactSecrets),
      storageKeys: {
        local: ["auth_debug_token"],
        session: [],
      },
    };
  }

  async clickSafe(selector: string): Promise<{ ok: boolean; reason?: string }> {
    this.budget.recordAction();
    try {
      assertSafeInteraction({ label: selector, path: this.currentPath });
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : "blocked" };
    }
    if (selector.includes("delete")) {
      return { ok: false, reason: "Interaction blocked: potentially destructive action" };
    }
    return { ok: true };
  }

  async close(): Promise<void> {
    return;
  }

  getRouteGraph() {
    return this.graph.build();
  }

  private classify(path: string): string {
    if (path.includes("login")) return "authentication";
    if (path.includes("settings")) return "settings";
    if (path.includes("dashboard")) return "dashboard";
    return "public";
  }
}

export const mockSafeBrowserRuntimeFactory: SafeBrowserRuntimeFactory = {
  create: (input) => MockSafeBrowserRuntime.create(input),
};

export async function createPlaywrightSafeBrowserRuntimeFactory(): Promise<SafeBrowserRuntimeFactory> {
  try {
    const mod = await import("./playwright-runtime");
    return mod.playwrightSafeBrowserRuntimeFactory;
  } catch {
    return mockSafeBrowserRuntimeFactory;
  }
}
