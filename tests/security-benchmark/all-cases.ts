import { AGENT_NEGATIVE_CASES } from "./agent/negative/index";
import { AGENT_POSITIVE_CASES } from "./agent/positive/index";
import { API_NEGATIVE_CASES } from "./api/negative/index";
import { API_POSITIVE_CASES } from "./api/positive/index";
import { AUTH_NEGATIVE_CASES } from "./auth/negative/index";
import { AUTH_POSITIVE_CASES } from "./auth/positive/index";
import { AUTHZ_NEGATIVE_CASES } from "./authz/negative/index";
import { AUTHZ_POSITIVE_CASES } from "./authz/positive/index";
import { CICD_NEGATIVE_CASES } from "./cicd/negative/index";
import { CICD_POSITIVE_CASES } from "./cicd/positive/index";
import { DATABASE_NEGATIVE_CASES } from "./database/negative/index";
import { DATABASE_POSITIVE_CASES } from "./database/positive/index";
import { DEPENDENCIES_NEGATIVE_CASES } from "./dependencies/negative/index";
import { DEPENDENCIES_POSITIVE_CASES } from "./dependencies/positive/index";
import { INJECTION_NEGATIVE_CASES } from "./injection/negative/index";
import { INJECTION_POSITIVE_CASES } from "./injection/positive/index";
import { MCP_EDGE_CASES } from "./mcp/edge/index";
import { MCP_NEGATIVE_CASES } from "./mcp/negative/index";
import { MCP_POSITIVE_CASES } from "./mcp/positive/index";
import { PROMPT_INJECTION_NEGATIVE_CASES } from "./prompt-injection/negative/index";
import { PROMPT_INJECTION_POSITIVE_CASES } from "./prompt-injection/positive/index";
import { READINESS_POSITIVE_CASES } from "./readiness/positive/index";
import { SECRETS_EDGE_CASES } from "./secrets/edge/index";
import { SECRETS_NEGATIVE_CASES } from "./secrets/negative/index";
import { SECRETS_POSITIVE_CASES } from "./secrets/positive/index";
import type { BenchmarkCase } from "./types";
import { WEB_EDGE_CASES } from "./web/edge/index";
import { WEB_NEGATIVE_CASES } from "./web/negative/index";
import { WEB_POSITIVE_CASES } from "./web/positive/index";

export const ALL_BENCHMARK_CASES: BenchmarkCase[] = [
  ...AUTH_POSITIVE_CASES,
  ...AUTH_NEGATIVE_CASES,
  ...AUTHZ_POSITIVE_CASES,
  ...AUTHZ_NEGATIVE_CASES,
  ...INJECTION_POSITIVE_CASES,
  ...INJECTION_NEGATIVE_CASES,
  ...SECRETS_POSITIVE_CASES,
  ...SECRETS_NEGATIVE_CASES,
  ...SECRETS_EDGE_CASES,
  ...WEB_POSITIVE_CASES,
  ...WEB_NEGATIVE_CASES,
  ...WEB_EDGE_CASES,
  ...DATABASE_POSITIVE_CASES,
  ...DATABASE_NEGATIVE_CASES,
  ...API_POSITIVE_CASES,
  ...API_NEGATIVE_CASES,
  ...CICD_POSITIVE_CASES,
  ...CICD_NEGATIVE_CASES,
  ...DEPENDENCIES_POSITIVE_CASES,
  ...DEPENDENCIES_NEGATIVE_CASES,
  ...MCP_POSITIVE_CASES,
  ...MCP_NEGATIVE_CASES,
  ...MCP_EDGE_CASES,
  ...PROMPT_INJECTION_POSITIVE_CASES,
  ...PROMPT_INJECTION_NEGATIVE_CASES,
  ...AGENT_POSITIVE_CASES,
  ...AGENT_NEGATIVE_CASES,
  ...READINESS_POSITIVE_CASES,
];
