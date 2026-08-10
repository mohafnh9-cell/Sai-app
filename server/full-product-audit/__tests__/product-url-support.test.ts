import { describe, expect, it } from "vitest";
import { normalizeOrigin } from "@/server/ai-red-team/authorization/types";
import { parseTargetOriginFromUserText } from "@/server/ai-red-team/authorization/dynamic-target-authorization-service";

describe("product URL support", () => {
  it("normalizes custom domains to origin", () => {
    expect(normalizeOrigin("https://mycompany.com/some/path")).toBe("https://mycompany.com");
  });

  it("normalizes Vercel domains the same as any HTTPS origin", () => {
    expect(normalizeOrigin("https://myapp.vercel.app/api/health")).toBe("https://myapp.vercel.app");
  });

  it("normalizes Netlify and Railway domains", () => {
    expect(normalizeOrigin("https://myapp.netlify.app/page")).toBe("https://myapp.netlify.app");
    expect(normalizeOrigin("https://myapp.railway.app/dashboard")).toBe("https://myapp.railway.app");
  });

  it("parses URLs from natural language without exposing internal terminology", () => {
    expect(parseTargetOriginFromUserText("Comprueba https://staging.mycompany.com")).toBe(
      "https://staging.mycompany.com"
    );
    expect(parseTargetOriginFromUserText("sin url")).toBeNull();
  });
});
