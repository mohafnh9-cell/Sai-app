/** Optional peer dependency — browser team falls back to mock when not installed. */
declare module "playwright" {
  export const chromium: {
    launch(options?: { headless?: boolean }): Promise<{
      newContext(options?: Record<string, unknown>): Promise<PlaywrightBrowserContext>;
      close(): Promise<void>;
    }>;
  };

  interface PlaywrightBrowserContext {
    newPage(): Promise<PlaywrightPage>;
    close(): Promise<void>;
  }

  interface PlaywrightPage {
    goto(
      url: string,
      options?: { timeout?: number; waitUntil?: string },
    ): Promise<{ status(): number; ok(): boolean } | null>;
    url(): string;
    title(): Promise<string>;
    $$eval<T>(selector: string, fn: (elements: Element[]) => T): Promise<T>;
    click(selector: string, options?: { timeout?: number }): Promise<void>;
    on(event: string, handler: () => void): void;
    close(): Promise<void>;
  }
}
