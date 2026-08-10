import { describe, expect, it } from "vitest";
import { selectAttacksFromFindings } from "../select-attacks-from-findings";

describe("selectAttacksFromFindings", () => {
  it("selects rate-limit adapter for auth rate limit findings", () => {
    const adapters = selectAttacksFromFindings({
      staticFindings: [
        {
          id: "1",
          ruleId: "rate-limit.auth-missing",
          title: "Authentication route lacks visible rate limiting",
          severity: "high",
          category: "availability",
        },
      ],
    });

    expect(adapters).toContain("rate-limit-brute-force");
  });

  it("selects injection and ssrf adapters from extended rule ids", () => {
    const adapters = selectAttacksFromFindings({
      staticFindings: [
        {
          id: "1",
          ruleId: "injection.ssrf",
          title: "User-controlled outbound request URL",
          severity: "high",
          category: "injection",
        },
        {
          id: "2",
          ruleId: "api.mass-assignment",
          title: "Privileged field may be accepted from request body",
          severity: "high",
          category: "authorization",
        },
      ],
    });

    expect(adapters).toContain("ssrf-probe-safe");
    expect(adapters).toContain("mass-assignment-probe");
  });

  it("falls back to baseline adapters when no findings match", () => {
    const adapters = selectAttacksFromFindings({ staticFindings: [] });
    expect(adapters.length).toBeGreaterThan(0);
    expect(adapters).toContain("idor-cross-tenant");
  });
});
