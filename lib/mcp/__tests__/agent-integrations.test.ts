import { describe, expect, it } from "vitest";
import { AGENT_INTEGRATIONS, getAgentIntegration } from "@/lib/mcp/agent-integrations";

describe("agent integrations registry", () => {
  it("marks unverified agents as unsupported", () => {
    expect(getAgentIntegration("codex")?.status).toBe("unsupported");
    expect(getAgentIntegration("gemini")?.status).toBe("unsupported");
  });

  it("marks verified local agents as supported", () => {
    expect(getAgentIntegration("cursor")?.status).toBe("supported");
    expect(getAgentIntegration("cursor")?.supportsLocal).toBe(true);
  });

  it("does not claim Gemini remote support", () => {
    const gemini = getAgentIntegration("gemini");
    expect(gemini?.supportsRemote).toBe(false);
  });

  it("has unique agent ids", () => {
    const ids = AGENT_INTEGRATIONS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
