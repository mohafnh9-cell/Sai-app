import type { AttackAuthorizationRecord } from "../../../authorization";
import { mockSafeBrowserRuntimeFactory } from "./mock-browser-runtime";
import type { SafeBrowserRuntimeFactory } from "./safe-browser-runtime";
import type { ExecutionBudget } from "./execution-budget";

/**
 * Playwright-backed runtime. Falls back to mock when Playwright is unavailable (CI default).
 * Install `playwright` and browsers in worker environments to enable live browsing.
 */
export const playwrightSafeBrowserRuntimeFactory: SafeBrowserRuntimeFactory = {
  async create(input: {
    targetUrl: string;
    authorization: AttackAuthorizationRecord;
    budget: ExecutionBudget;
    signal?: AbortSignal;
  }) {
    try {
      const { chromium } = await import("playwright");
      const origin = new URL(input.targetUrl).origin;
      const browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        locale: "en-US",
        timezoneId: "UTC",
        acceptDownloads: false,
      });
      const page = await context.newPage();
      page.on("console", () => undefined);
      await page.goto(input.targetUrl, { timeout: 30_000, waitUntil: "domcontentloaded" });

      return {
        allowedOrigin: origin,
        async goto(path: string) {
          const url = new URL(path, input.targetUrl).toString();
          if (new URL(url).origin !== origin) throw new Error("Navigation blocked: external origin");
          input.budget.recordNavigation();
          const response = await page.goto(url, { timeout: 20_000, waitUntil: "domcontentloaded" });
          return {
            url,
            status: response?.status() ?? null,
            headers: {},
            ok: response?.ok() ?? false,
          };
        },
        async snapshot() {
          const links = await page.$$eval("a[href]", (els) =>
            els.map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? "").filter(Boolean)
          );
          return {
            url: page.url(),
            title: await page.title(),
            links,
            forms: [],
            consoleEvents: [],
            pageErrors: [],
            storageKeys: { local: [], session: [] },
          };
        },
        async clickSafe(selector: string) {
          input.budget.recordAction();
          await page.click(selector, { timeout: 5_000 });
          return { ok: true };
        },
        async close() {
          await context.close();
          await browser.close();
        },
      };
    } catch {
      return mockSafeBrowserRuntimeFactory.create(input);
    }
  },
};
