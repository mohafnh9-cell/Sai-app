import { describe, expect, it } from "vitest";
import {
  MCP_INTENT_DATASET_COUNTS,
  MCP_INTENT_EVALUATION_DATASET,
} from "../evaluation/intent-dataset";
import {
  evaluateIntentDataset,
  recommendMcpToolsForPhrase,
  summarizeIntentEvaluation,
} from "../evaluation/intent-recommender";
import { MCP_TOOL_DEFINITIONS } from "../tool-definitions";
import {
  CAN_I_DEPLOY_DESCRIPTION,
  PRODUCTION_HISTORY_DESCRIPTION,
  REVIEW_NOW_DESCRIPTION,
  SAFE_FIX_DESCRIPTION,
  WHAT_CHANGED_DESCRIPTION,
} from "../tool-descriptions";
import { MCP_SERVER_INSTRUCTIONS } from "../client-instructions";
import { MCP_PROMPT_DEFINITIONS } from "../prompt-definitions";
import fs from "node:fs";
import path from "node:path";

const DESCRIPTIONS = [
  REVIEW_NOW_DESCRIPTION,
  CAN_I_DEPLOY_DESCRIPTION,
  SAFE_FIX_DESCRIPTION,
  WHAT_CHANGED_DESCRIPTION,
  PRODUCTION_HISTORY_DESCRIPTION,
];

function subset(ids: string[]) {
  return MCP_INTENT_EVALUATION_DATASET.filter((item) => ids.includes(item.id));
}

function byPrefix(prefix: string) {
  return MCP_INTENT_EVALUATION_DATASET.filter((item) => item.id.startsWith(prefix));
}

describe("MCP natural language intent evaluation", () => {
  it("meets minimum dataset counts", () => {
    expect(MCP_INTENT_DATASET_COUNTS.review_now).toBeGreaterThanOrEqual(30);
    expect(MCP_INTENT_DATASET_COUNTS.can_i_deploy).toBeGreaterThanOrEqual(30);
    expect(MCP_INTENT_DATASET_COUNTS.safe_fix).toBeGreaterThanOrEqual(30);
    expect(MCP_INTENT_DATASET_COUNTS.what_changed).toBeGreaterThanOrEqual(25);
    expect(MCP_INTENT_DATASET_COUNTS.production_history).toBeGreaterThanOrEqual(25);
    expect(MCP_INTENT_DATASET_COUNTS.ambiguous).toBeGreaterThanOrEqual(25);
    expect(MCP_INTENT_DATASET_COUNTS.compound).toBeGreaterThanOrEqual(20);
    expect(MCP_INTENT_DATASET_COUNTS.negative).toBeGreaterThanOrEqual(20);
  });

  it("includes EN and ES phrases across single-intent sets", () => {
    for (const prefix of ["rn-", "cd-", "sf-", "wc-", "ph-"]) {
      const items = byPrefix(prefix);
      expect(items.some((item) => item.locale === "en")).toBe(true);
      expect(items.some((item) => item.locale === "es")).toBe(true);
    }
  });

  it("tool descriptions include purpose, examples, and compute guidance", () => {
    for (const description of DESCRIPTIONS) {
      expect(description).toMatch(/Purpose:/i);
      expect(description).toMatch(/Use when/i);
      expect(description).toMatch(/Do NOT use/i);
      expect(description).toMatch(/Compute:/i);
      expect(description).toMatch(/Result:/i);
    }
  });

  it("keeps exactly six public MCP tools (ADR-001 + RT2)", () => {
    expect(MCP_TOOL_DEFINITIONS).toHaveLength(6);
  });

  it("does not wire evaluation recommender into executeMcpTool", () => {
    const executeToolSource = fs.readFileSync(
      path.resolve(__dirname, "../execute-tool.ts"),
      "utf8"
    );
    expect(executeToolSource).not.toContain("recommendMcpToolsForPhrase");
    expect(executeToolSource).not.toContain("intent-recommender");
  });

  it("exposes server instructions and optional prompts", () => {
    expect(MCP_SERVER_INSTRUCTIONS).toContain("can_i_deploy");
    expect(MCP_SERVER_INSTRUCTIONS).toContain("review_now");
    expect(MCP_PROMPT_DEFINITIONS).toHaveLength(3);
    for (const prompt of MCP_PROMPT_DEFINITIONS) {
      expect(prompt.suggestedToolSequence.every((tool) =>
        MCP_TOOL_DEFINITIONS.some((def) => def.name === tool)
      )).toBe(true);
    }
  });

  it("achieves ≥95% first-tool accuracy on clear single-intent phrases", () => {
    const clear = MCP_INTENT_EVALUATION_DATASET.filter(
      (item) =>
        item.expected.action === "tool" &&
        item.expected.tools.length === 1 &&
        !item.tags?.includes("edge")
    );
    let correct = 0;
    for (const item of clear) {
      const actual = recommendMcpToolsForPhrase(item.phrase);
      if (
        actual.action === "tool" &&
        item.expected.action === "tool" &&
        actual.tools[0] === item.expected.tools[0]
      ) {
        correct += 1;
      }
    }
    const accuracy = correct / clear.length;
    expect(accuracy).toBeGreaterThanOrEqual(0.95);
  });

  it("achieves ≥90% sequence accuracy on compound phrases", () => {
    const compound = byPrefix("cmp-");
    const result = evaluateIntentDataset(compound);
    expect(result.accuracy).toBeGreaterThanOrEqual(0.9);
  });

  it("classifies ambiguous phrases as clarify", () => {
    const ambiguous = byPrefix("amb-");
    const result = evaluateIntentDataset(ambiguous);
    expect(result.accuracy).toBeGreaterThanOrEqual(0.9);
  });

  it("does not recommend tools for negative examples", () => {
    const negative = byPrefix("neg-");
    const result = evaluateIntentDataset(negative);
    expect(result.accuracy).toBeGreaterThanOrEqual(0.95);
  });

  it("handles mid-sentence keywords contextually", () => {
    const contextual = subset([
      "rn-es-14",
      "cd-en-11",
      "wc-en-13",
      "wc-es-12",
    ]);
    const result = evaluateIntentDataset(contextual);
    expect(result.accuracy).toBe(1);
  });

  it("distinguishes review_now from can_i_deploy for deploy-adjacent phrases", () => {
    expect(recommendMcpToolsForPhrase("Analyze everything before I deploy.")).toEqual({
      action: "tool",
      tools: ["review_now"],
    });
    expect(recommendMcpToolsForPhrase("Can I deploy?")).toEqual({
      action: "tool",
      tools: ["can_i_deploy"],
    });
  });

  it("summarizeIntentEvaluation meets Private Beta targets", () => {
    const metrics = summarizeIntentEvaluation(MCP_INTENT_EVALUATION_DATASET);
    expect(metrics.clear.accuracy).toBeGreaterThanOrEqual(0.95);
    expect(metrics.compound.accuracy).toBeGreaterThanOrEqual(0.9);
    expect(metrics.overall.accuracy).toBeGreaterThanOrEqual(0.9);
    expect(metrics.en.accuracy).toBeGreaterThanOrEqual(0.9);
    expect(metrics.es.accuracy).toBeGreaterThanOrEqual(0.9);
  });
});
