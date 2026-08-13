import { describe, expect, it } from "vitest";
import { normalizeHttpUrlInput } from "@/lib/url/normalize-http-url";
import { appendQueryParam, sanitizeReturnPath } from "@/lib/url/sanitize-return-path";

describe("normalizeHttpUrlInput", () => {
  it("prepends https when protocol is missing", () => {
    expect(normalizeHttpUrlInput("miapp.vercel.app")).toBe("https://miapp.vercel.app");
  });

  it("preserves explicit http(s) URLs", () => {
    expect(normalizeHttpUrlInput("https://miapp.vercel.app/path")).toBe(
      "https://miapp.vercel.app/path"
    );
  });
});

describe("sanitizeReturnPath", () => {
  it("rejects external URLs", () => {
    expect(sanitizeReturnPath("https://evil.com")).toBe("/dashboard");
    expect(sanitizeReturnPath("//evil.com")).toBe("/dashboard");
  });

  it("keeps in-app paths", () => {
    expect(sanitizeReturnPath("/projects/abc/mission-control")).toBe(
      "/projects/abc/mission-control"
    );
  });
});

describe("appendQueryParam", () => {
  it("appends to paths with or without existing query", () => {
    expect(appendQueryParam("/billing", "checkout", "success")).toBe(
      "/billing?checkout=success"
    );
    expect(appendQueryParam("/billing?reason=x", "checkout", "success")).toBe(
      "/billing?reason=x&checkout=success"
    );
  });
});
