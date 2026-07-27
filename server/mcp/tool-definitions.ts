import {
  CANCEL_REVIEW_DESCRIPTION,
  CAN_I_DEPLOY_DESCRIPTION,
  PRODUCTION_HISTORY_DESCRIPTION,
  REVIEW_NOW_DESCRIPTION,
  SAFE_FIX_DESCRIPTION,
  WHAT_CHANGED_DESCRIPTION,
  DISCOVER_APPLICATION_DESCRIPTION,
} from "./tool-descriptions";

export type McpToolDefinition = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<
      string,
      {
        type: string;
        description: string;
        enum?: string[];
      }
    >;
    required: string[];
  };
};

const PROJECT_SELECTOR_PROPERTIES: McpToolDefinition["inputSchema"]["properties"] = {
  projectId: {
    type: "string",
    description: "SequrAI project ID. Optional if your organization has a single project.",
  },
  repositoryId: {
    type: "string",
    description: "Alias for projectId.",
  },
  repositoryFullName: {
    type: "string",
    description: "GitHub repository full name, e.g. \"owner/repo\". Alternative to projectId.",
  },
  locale: {
    type: "string",
    description: "Response locale. One of \"en\" or \"es\". Defaults to your account locale.",
    enum: ["en", "es"],
  },
};

/**
 * ADR-001 / MCP V1 + RT2: six public tools (five production engine tools + discover_application).
 * Enforced by server/mcp/__tests__/tool-surface.test.ts.
 */
export const MCP_TOOL_DEFINITIONS: McpToolDefinition[] = [
  {
    name: "review_now",
    description: REVIEW_NOW_DESCRIPTION,
    inputSchema: {
      type: "object",
      properties: {
        ...PROJECT_SELECTOR_PROPERTIES,
        commitSha: {
          type: "string",
          description: "Explicit commit SHA to review. Defaults to the latest commit on the branch.",
        },
        branch: {
          type: "string",
          description: "Branch to review. Defaults to the repository's default branch.",
        },
        reason: {
          type: "string",
          description: "Why this review was requested. Analytics metadata only; never affects the result.",
          enum: ["before_deploy", "after_fix", "manual_check"],
        },
      },
      required: [],
    },
  },
  {
    name: "cancel_review",
    description: CANCEL_REVIEW_DESCRIPTION,
    inputSchema: {
      type: "object",
      properties: {
        ...PROJECT_SELECTOR_PROPERTIES,
        reviewId: {
          type: "string",
          description: "Optional scan/review UUID. Defaults to the newest active review for the project.",
        },
      },
      required: [],
    },
  },
  {
    name: "can_i_deploy",
    description: CAN_I_DEPLOY_DESCRIPTION,
    inputSchema: {
      type: "object",
      properties: { ...PROJECT_SELECTOR_PROPERTIES },
      required: [],
    },
  },
  {
    name: "safe_fix",
    description: SAFE_FIX_DESCRIPTION,
    inputSchema: {
      type: "object",
      properties: {
        ...PROJECT_SELECTOR_PROPERTIES,
        blockerId: { type: "string", description: "Blocker/priority/finding ID to fix." },
        priorityId: { type: "string", description: "Alias for blockerId." },
        findingId: { type: "string", description: "Alias for blockerId." },
      },
      required: [],
    },
  },
  {
    name: "what_changed",
    description: WHAT_CHANGED_DESCRIPTION,
    inputSchema: {
      type: "object",
      properties: { ...PROJECT_SELECTOR_PROPERTIES },
      required: [],
    },
  },
  {
    name: "production_history",
    description: PRODUCTION_HISTORY_DESCRIPTION,
    inputSchema: {
      type: "object",
      properties: {
        ...PROJECT_SELECTOR_PROPERTIES,
        range: {
          type: "string",
          description: "Time window for the recent-score timeline.",
          enum: ["7d", "30d", "all"],
        },
        limit: { type: "number", description: "Max recent verdicts to return (default 7, max 20)." },
      },
      required: [],
    },
  },
  {
    name: "discover_application",
    description: DISCOVER_APPLICATION_DESCRIPTION,
    inputSchema: {
      type: "object",
      properties: {
        ...PROJECT_SELECTOR_PROPERTIES,
        branch: {
          type: "string",
          description: "Optional branch to analyze. Defaults to the repository default branch.",
        },
      },
      required: [],
    },
  },
];

export const MCP_PUBLIC_TOOL_NAMES = MCP_TOOL_DEFINITIONS.map((tool) => tool.name);

export const MCP_SERVER_INFO = {
  name: "sequrai",
  version: "2.2.0",
  description:
    "SequrAI Production Engine — independent Production Engineer for AI-built software. Speak naturally; select tools by intent (review, cancel review, deploy readiness, safe fix, changes, history, architecture discovery). Seven public tools; canonical verdict truth is never computed in the client.",
};
