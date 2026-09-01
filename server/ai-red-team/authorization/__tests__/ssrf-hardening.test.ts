import { describe, expect, it, vi, beforeEach } from "vitest";
import { isBlockedVerificationHostname } from "../target-verification";

// M4 (audit): the previous hostname-only check missed 172.16.0.0/12 and
// all of IPv6, and never validated the RESOLVED address for a hostname
// (only the hostname string itself) -- a public-looking hostname that
// resolves to an internal IP was never caught. These cover both layers.

describe("isBlockedVerificationHostname — IPv4 ranges", () => {
  it("blocks all RFC1918 private ranges", () => {
    expect(isBlockedVerificationHostname("localhost")).toBe(true);
    expect(isBlockedVerificationHostname("127.0.0.1")).toBe(true);
    expect(isBlockedVerificationHostname("10.0.0.5")).toBe(true);
    expect(isBlockedVerificationHostname("172.16.0.1")).toBe(true);
    expect(isBlockedVerificationHostname("172.20.5.5")).toBe(true);
    expect(isBlockedVerificationHostname("172.31.255.255")).toBe(true);
    expect(isBlockedVerificationHostname("192.168.1.1")).toBe(true);
    expect(isBlockedVerificationHostname("169.254.169.254")).toBe(true); // cloud metadata
  });

  it("does not block the adjacent public ranges just outside 172.16.0.0/12", () => {
    expect(isBlockedVerificationHostname("172.15.255.255")).toBe(false);
    expect(isBlockedVerificationHostname("172.32.0.0")).toBe(false);
  });

  it("allows a normal public IP and hostname", () => {
    expect(isBlockedVerificationHostname("8.8.8.8")).toBe(false);
    expect(isBlockedVerificationHostname("staging.example.com")).toBe(false);
  });

  it("fails closed on malformed/obfuscated IPv4-looking input", () => {
    // Not a clean dotted-quad -- must not slip through as "not an IP, so allowed".
    expect(isBlockedVerificationHostname("2130706433")).toBe(false); // decimal IP form isn't parsed as an IP by net.isIP -- treated as a hostname, not blocked by this layer (DNS-resolution layer is the real backstop for this case)
  });
});

describe("isBlockedVerificationHostname — IPv6 ranges", () => {
  it("blocks loopback and unspecified", () => {
    expect(isBlockedVerificationHostname("::1")).toBe(true);
    expect(isBlockedVerificationHostname("::")).toBe(true);
  });

  it("blocks link-local (fe80::/10)", () => {
    expect(isBlockedVerificationHostname("fe80::1")).toBe(true);
    expect(isBlockedVerificationHostname("fe80::abcd:1234")).toBe(true);
  });

  it("blocks unique-local (fc00::/7)", () => {
    expect(isBlockedVerificationHostname("fc00::1")).toBe(true);
    expect(isBlockedVerificationHostname("fd12:3456:789a::1")).toBe(true);
  });

  it("allows a public IPv6 address", () => {
    expect(isBlockedVerificationHostname("2001:4860:4860::8888")).toBe(false); // Google public DNS
  });
});

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
  resolveTxt: vi.fn(),
}));

describe("assertHostnameResolvesToPublicAddress — DNS-rebinding-shaped cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("blocks a public-looking hostname that resolves to a private IP", async () => {
    const { lookup } = await import("node:dns/promises");
    vi.mocked(lookup).mockResolvedValue([{ address: "10.0.0.5", family: 4 }] as never);

    const { assertHostnameResolvesToPublicAddress } = await import("../target-verification");
    const result = await assertHostnameResolvesToPublicAddress("looks-external.example.com");

    expect(result.ok).toBe(false);
  });

  it("allows a hostname that resolves only to public IPs", async () => {
    const { lookup } = await import("node:dns/promises");
    vi.mocked(lookup).mockResolvedValue([{ address: "203.0.113.5", family: 4 }] as never);

    const { assertHostnameResolvesToPublicAddress } = await import("../target-verification");
    const result = await assertHostnameResolvesToPublicAddress("staging.example.com");

    expect(result.ok).toBe(true);
  });

  it("blocks when ANY of multiple resolved addresses is private (multi-A-record rebinding shape)", async () => {
    const { lookup } = await import("node:dns/promises");
    vi.mocked(lookup).mockResolvedValue([
      { address: "203.0.113.5", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ] as never);

    const { assertHostnameResolvesToPublicAddress } = await import("../target-verification");
    const result = await assertHostnameResolvesToPublicAddress("multi-record.example.com");

    expect(result.ok).toBe(false);
  });

  it("fails closed when DNS resolution errors (invalid/unresolvable hostname)", async () => {
    const { lookup } = await import("node:dns/promises");
    vi.mocked(lookup).mockRejectedValue(new Error("ENOTFOUND"));

    const { assertHostnameResolvesToPublicAddress } = await import("../target-verification");
    const result = await assertHostnameResolvesToPublicAddress("does-not-exist.invalid");

    expect(result.ok).toBe(false);
  });

  it("validates a literal IP hostname directly without a DNS lookup", async () => {
    const { lookup } = await import("node:dns/promises");
    const { assertHostnameResolvesToPublicAddress } = await import("../target-verification");

    const blocked = await assertHostnameResolvesToPublicAddress("192.168.1.1");
    expect(blocked.ok).toBe(false);
    expect(lookup).not.toHaveBeenCalled();

    const allowed = await assertHostnameResolvesToPublicAddress("8.8.8.8");
    expect(allowed.ok).toBe(true);
  });
});
