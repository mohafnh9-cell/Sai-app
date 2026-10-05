import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/auth/safe-next-path";

const FALLBACK = "/onboarding";
const ORIGIN = "https://app.example.test";

/** What a browser would do with the returned value if it navigates to it as-is. */
function resolvesToSameOrigin(value: string): boolean {
  try {
    return new URL(value, ORIGIN).origin === ORIGIN;
  } catch {
    return false;
  }
}

describe("safeNextPath: defaults and legitimate internal paths", () => {
  it("falls back for empty / null / undefined input", () => {
    expect(safeNextPath(null)).toBe(FALLBACK);
    expect(safeNextPath(undefined)).toBe(FALLBACK);
    expect(safeNextPath("")).toBe(FALLBACK);
  });

  it("honors a caller-provided fallback and never returns attacker input as the fallback", () => {
    expect(safeNextPath("https://evil.com", "/integrations")).toBe("/integrations");
    expect(safeNextPath(null, "/dashboard")).toBe("/dashboard");
  });

  it.each([
    ["/dashboard", "/dashboard"],
    ["/onboarding", "/onboarding"],
    ["/settings", "/settings"],
    ["/projects/123", "/projects/123"],
    ["/projects/abc", "/projects/abc"],
    ["/projects/123?tab=findings", "/projects/123?tab=findings"],
    ["/projects/123#findings", "/projects/123#findings"],
    ["/projects/123?tab=findings&sort=severity#top", "/projects/123?tab=findings&sort=severity#top"],
    ["/search?q=a%20b", "/search?q=a%20b"], // an encoded space is harmless and stays usable
    ["/integrations", "/integrations"],
    ["/dashboard/", "/dashboard/"],
  ])("allows the internal path %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it("is idempotent for accepted values", () => {
    for (const v of ["/dashboard", "/projects/123?tab=findings#x", "/a/./b"]) {
      const once = safeNextPath(v);
      expect(safeNextPath(once)).toBe(once);
    }
  });
});

describe("safeNextPath: rejected destinations fall back", () => {
  it.each([
    ["absolute https URL", "https://evil.com"],
    ["absolute http URL", "http://evil.com/x"],
    ["protocol-relative", "//evil.com"],
    ["protocol-relative with path", "//evil.com/dashboard"],
    ["backslash after slash", "/\\evil.com"],
    ["double backslash", "/\\\\evil.com"],
    ["slash then backslash then slash", "/\\/evil.com"],
    ["backslash first", "\\evil.com"],
    ["javascript: URL", "javascript:alert(1)"],
    ["data: URL", "data:text/html,<script>alert(1)</script>"],
    ["vbscript: URL", "vbscript:msgbox(1)"],
    ["no leading slash", "dashboard"],
    ["whitespace then protocol-relative", " //evil.com"],
    ["tab inside", "/\t/evil.com"],
    ["newline inside", "/\n/evil.com"],
    ["carriage return inside", "/\r/evil.com"],
    ["tab at end", "/dashboard\t"],
    ["plain space", "/dash board"],
    ["NUL byte", "/dash\u0000board"],
    ["C1 control", "/dash\u0085board"],
    ["no-break space", "/ /evil.com"],
    ["line separator", "/ /evil.com"],
    ["zero-width space", "/​/evil.com"],
    ["encoded backslash %5c", "/%5cevil.com"],
    ["encoded backslash %5C", "/%5Cevil.com"],
    ["encoded backslash later", "/a/%5c%5cevil.com"],
    ["encoded tab %09", "/%09/evil.com"],
    ["encoded newline %0a", "/%0a/evil.com"],
    ["encoded CR %0d", "/%0d/evil.com"],
    ["encoded NUL %00", "/%00evil"],
    ["encoded slash makes protocol-relative", "/%2fevil.com"],
    ["encoded slash after slash", "//%2fevil.com"],
    ["double-encoded backslash", "/%255cevil.com"],
    ["double-encoded tab", "/%2509/evil.com"],
    ["triple-encoded backslash", "/%25255cevil.com"],
    ["deeply nested encoding", "/%252525252525255cevil.com"],
    ["dot segment collapses to protocol-relative", "/.//evil.com"],
    ["parent segment collapses to protocol-relative", "/a/..//evil.com"],
    ["malformed percent-encoding", "/%E0%A4%A"],
    ["lone percent", "/100%"],
    ["too long", `/${"a".repeat(3000)}`],
  ])("rejects %s", (_name, input) => {
    expect(safeNextPath(input)).toBe(FALLBACK);
  });
});

describe("safeNextPath: adversarial corpus never yields a cross-origin value", () => {
  const atoms = [
    "/", "\\", "%5c", "%5C", "%2f", "%2F", "%09", "%0a", "%0d", "%00", "%25", "%255c", "%252f",
    " ", "\t", "\n", "\r", " ", " ", "​", "\u0085", ".", "..", "@", ":", "a", "evil.com", "?", "#", "http:", "javascript:",
  ];

  it("every accepted output is a same-origin, single-slash path (brute force over parser edge characters)", () => {
    let accepted = 0;
    let total = 0;
    const check = (candidate: string) => {
      total += 1;
      const out = safeNextPath(`/${candidate}`);
      if (out !== FALLBACK) accepted += 1;
      // Whatever came back must be safe to navigate to as a bare string...
      expect(out.startsWith("/")).toBe(true);
      expect(out.startsWith("//")).toBe(false);
      expect(out).not.toMatch(/[\\\u0000-\u001f\u007f-\u009f]/);
      // ...and must resolve to our own origin in a real URL parser.
      expect(resolvesToSameOrigin(out)).toBe(true);
    };
    for (const a of atoms) check(a);
    for (const a of atoms) for (const b of atoms) check(a + b);
    for (const a of atoms) for (const b of atoms) for (const c of atoms) check(a + b + c);
    expect(total).toBeGreaterThan(20000);
    expect(accepted).toBeGreaterThan(0); // the corpus includes harmless values, so the check is not vacuous
  });

  it("the fallback itself is safe", () => {
    expect(resolvesToSameOrigin(safeNextPath("https://evil.com"))).toBe(true);
  });
});
