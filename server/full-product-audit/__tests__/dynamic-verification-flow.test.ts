import { describe, expect, it } from "vitest";
import {
  resolveDynamicVerificationExecution,
  shouldOfferDynamicVerification,
} from "../dynamic-verification-flow";

describe("dynamic verification flow", () => {
  it("offers dynamic verification only after static findings and without authorization", () => {
    expect(
      shouldOfferDynamicVerification({
        staticFindingsCount: 3,
        selectedAdapterCount: 2,
        hasAuthorizedTarget: false,
      })
    ).toBe(true);

    expect(
      shouldOfferDynamicVerification({
        staticFindingsCount: 0,
        selectedAdapterCount: 2,
        hasAuthorizedTarget: false,
      })
    ).toBe(false);

    expect(
      shouldOfferDynamicVerification({
        staticFindingsCount: 3,
        selectedAdapterCount: 2,
        hasAuthorizedTarget: true,
      })
    ).toBe(false);
  });

  it("respects static_only decision without treating it as an error", () => {
    const result = resolveDynamicVerificationExecution({
      decision: "static_only",
      hasAuthorizedTarget: false,
      staticFindingsCount: 4,
      selectedAdapterCount: 2,
    });
    expect(result.runDynamic).toBe(false);
    expect(result.skippedReason).toBe("user_declined_dynamic");
  });

  it("skips URL re-request when authorization already exists", () => {
    const result = resolveDynamicVerificationExecution({
      hasAuthorizedTarget: true,
      staticFindingsCount: 4,
      selectedAdapterCount: 2,
      authorizedTarget: "https://myapp.vercel.app",
    });
    expect(result.runDynamic).toBe(true);
    expect(result.state.awaitingUrl).toBe(false);
    expect(result.state.authorizedTarget).toBe("https://myapp.vercel.app");
  });

  it("waits for URL when user chooses authorize without existing target", () => {
    const result = resolveDynamicVerificationExecution({
      decision: "authorize",
      hasAuthorizedTarget: false,
      staticFindingsCount: 2,
      selectedAdapterCount: 1,
    });
    expect(result.runDynamic).toBe(false);
    expect(result.skippedReason).toBe("awaiting_authorization");
    expect(result.state.awaitingUrl).toBe(true);
  });

  it("shows offer when findings exist but no decision yet", () => {
    const result = resolveDynamicVerificationExecution({
      hasAuthorizedTarget: false,
      staticFindingsCount: 2,
      selectedAdapterCount: 1,
    });
    expect(result.state.offered).toBe(true);
    expect(result.skippedReason).toBe("dynamic_not_authorized");
  });
});
