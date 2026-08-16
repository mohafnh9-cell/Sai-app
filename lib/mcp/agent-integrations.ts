/**
 * Data-driven registry of MCP agent integrations.
 * Does NOT duplicate OAuth logic, tools, or authentication.
 */

export type AgentIntegrationStatus = "supported" | "beta" | "unsupported";
export type AgentIntegrationType = "ide" | "cli" | "desktop" | "chat";
export type AgentTransport = "stdio" | "http" | "sse";
export type AgentAuthMode = "local-env" | "oauth" | "api-key";

export type AgentIntegration = {
  id: string;
  displayName: string;
  type: AgentIntegrationType;
  transport: AgentTransport;
  authMode: AgentAuthMode;
  supportsLocal: boolean;
  supportsRemote: boolean;
  status: AgentIntegrationStatus;
  setupSteps: string[];
  documentationPath?: string;
};

export const AGENT_INTEGRATIONS: AgentIntegration[] = [
  {
    id: "cursor",
    displayName: "Cursor",
    type: "ide",
    transport: "stdio",
    authMode: "local-env",
    supportsLocal: true,
    supportsRemote: true,
    status: "supported",
    setupSteps: [
      "Export SEQURAI_API_KEY or run the installer env export step",
      "Run the SequrAI MCP installer in your project folder",
      "Restart Cursor fully",
      'Ask: "Analyze my current workspace" (local) or "Can I deploy?" (remote/GitHub)',
    ],
    documentationPath: "docs/MCP_LOCAL_ANALYSIS.md",
  },
  {
    id: "claude-code",
    displayName: "Claude Code",
    type: "cli",
    transport: "http",
    authMode: "api-key",
    supportsLocal: false,
    supportsRemote: true,
    status: "supported",
    setupSteps: [
      "source .sequrai/mcp.env",
      "claude mcp add --transport http sequrai <endpoint> --header \"Authorization: Bearer ${SEQURAI_API_KEY}\"",
      'Ask: "Can I deploy?" against connected GitHub repositories',
    ],
    documentationPath: "docs/MCP_AGENT_INTEGRATIONS.md",
  },
  {
    id: "vscode",
    displayName: "VS Code",
    type: "ide",
    transport: "http",
    authMode: "api-key",
    supportsLocal: false,
    supportsRemote: true,
    status: "supported",
    setupSteps: [
      "Configure HTTP MCP with Authorization from .sequrai/mcp.env",
      "Point to POST /api/mcp on your SequrAI instance",
    ],
    documentationPath: "docs/MCP_AGENT_INTEGRATIONS.md",
  },
  {
    id: "claude-desktop",
    displayName: "Claude Desktop",
    type: "desktop",
    transport: "http",
    authMode: "oauth",
    supportsLocal: false,
    supportsRemote: true,
    status: "beta",
    setupSteps: [
      "Connect via OAuth using /.well-known/oauth-authorization-server discovery",
      "Authorize SequrAI when prompted",
      "Remote MCP analyzes GitHub repositories connected to your organization",
    ],
    documentationPath: "docs/MCP_OAUTH.md",
  },
  {
    id: "chatgpt",
    displayName: "ChatGPT",
    type: "chat",
    transport: "http",
    authMode: "oauth",
    supportsLocal: false,
    supportsRemote: true,
    status: "beta",
    setupSteps: [
      "Connect via OAuth using MCP protected resource metadata",
      "Authorize SequrAI when prompted",
      "Remote MCP analyzes GitHub repositories connected to your organization",
    ],
    documentationPath: "docs/MCP_OAUTH.md",
  },
  {
    id: "codex",
    displayName: "Codex",
    type: "cli",
    transport: "http",
    authMode: "api-key",
    supportsLocal: false,
    supportsRemote: false,
    status: "unsupported",
    setupSteps: ["Not verified — check SequrAI docs before attempting integration"],
    documentationPath: "docs/MCP_AGENT_INTEGRATIONS.md",
  },
  {
    id: "gemini",
    displayName: "Gemini",
    type: "chat",
    transport: "http",
    authMode: "oauth",
    supportsLocal: false,
    supportsRemote: false,
    status: "unsupported",
    setupSteps: ["Not verified — MCP OAuth compatibility not confirmed for this client"],
    documentationPath: "docs/MCP_AGENT_INTEGRATIONS.md",
  },
];

export function getAgentIntegration(id: string): AgentIntegration | undefined {
  return AGENT_INTEGRATIONS.find((agent) => agent.id === id);
}

export function getSupportedAgents(): AgentIntegration[] {
  return AGENT_INTEGRATIONS.filter((agent) => agent.status !== "unsupported");
}
