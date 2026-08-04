import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type { ProjectSecurityContext, ScanAnalysisResult } from "@/features/ai-security-engine/types";
import { calculateRiskScore } from "@/features/ai-security-engine/risk-engine";
import {
  ANALYSIS_ENGINE_V2_VERSION,
  getAnalysisEngineV2NarrativeSupplement,
} from "@/brain/prompts/analysis-engine-v2";

const PROMPT_VERSION = `2.0.0-ae-narrative+${ANALYSIS_ENGINE_V2_VERSION}`;
const MODEL = "claude-sonnet-4-20250514";

let client: Anthropic | null = null;

function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  client ??= new Anthropic({ apiKey });
  return client;
}

function systemPrompt(locale: "en" | "es" = "en") {
  const languageRule =
    locale === "es"
      ? "Write executive_summary, coach_tip, priorities, recommendations, insights, and learning content in Spanish. Keep product names (SequrAI, Production Verdict, Production Ready Score) in English."
      : "Write executive_summary, coach_tip, priorities, recommendations, insights, and learning content in English.";

  return `You are SequrAI, a Senior Production Engineer specialized in AI-built applications (Next.js, Supabase, Firebase, Vercel, Cursor, Claude Code).

Your job is NOT to find vulnerabilities. The Scan Engine already did that.
Transform findings into actionable production intelligence for a developer who wants clear next steps.

Rules:
- Never analyze the full repository. Use only the provided context.
- Write like a senior engineer mentoring a developer, not like a generic chatbot.
- Avoid endless vulnerability lists and heavy jargon.
- Focus on what to fix today, estimated time, and highest risk reduction.
- ${languageRule}
- Respond ONLY with valid JSON matching the requested schema.

${getAnalysisEngineV2NarrativeSupplement(locale)}`;
}

function buildUserPrompt(context: ProjectSecurityContext, topFindingIds: string[]) {
  return JSON.stringify(
    {
      project: {
        name: context.projectName,
        securityScore: context.securityScore,
        findingsCount: context.findingsCount,
        severityCounts: context.severityCounts,
        categoryCounts: context.categoryCounts,
        stack: context.stack,
        previousScores: context.previousScores,
        recurringPatterns: context.recurringPatterns,
      },
      findings: context.findings.map((finding) => ({
        id: finding.id,
        ruleId: finding.ruleId,
        title: finding.title,
        severity: finding.severity,
        confidence: finding.confidence,
        category: finding.category,
        filePath: finding.filePath,
        startLine: finding.startLine,
        description: finding.description,
        recommendation: finding.recommendation,
        evidence: finding.evidence,
        codeSnippet: finding.codeSnippet,
      })),
      topFindingIdsForFixes: topFindingIds,
      requiredOutput: {
        executiveSummary: "string",
        coachTip: "string",
        priorities: "max 5 grouped actionable priorities",
        recommendations: "proactive hardening suggestions, not vulnerabilities",
        insights: "personalized insights",
        learning: "patterns detected for future memory",
        findingFixes: "detailed fixes for topFindingIdsForFixes only",
      },
    },
    null,
    2
  );
}

function fallbackAnalysis(context: ProjectSecurityContext): ScanAnalysisResult {
  const { riskScore, priorityLevel, factors } = calculateRiskScore(context);
  const topFindings = [...context.findings]
    .sort((a, b) => {
      const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
      return (
        (order[a.severity.toLowerCase() as keyof typeof order] ?? 5) -
        (order[b.severity.toLowerCase() as keyof typeof order] ?? 5)
      );
    })
    .slice(0, 5);

  return {
    executiveSummary: `Your project has a security score of ${context.securityScore}/100 with ${context.findingsCount} findings. Focus on the highest-severity items first to reduce real-world risk quickly.`,
    coachTip: context.stack.services.includes("Supabase")
      ? "For Supabase projects, start with RLS policies, service-role key isolation, and input validation with Zod."
      : "Enable security headers, validate all external input, and keep secrets out of client-side code.",
    riskScore,
    priorityLevel,
    riskFactors: factors,
    priorities: topFindings.map((finding, index) => ({
      rank: index + 1,
      title: finding.title,
      description: finding.recommendation,
      findingIds: [finding.id],
      patternGroup: finding.category,
      estimatedMinutes: finding.severity === "critical" ? 5 : 10,
      difficulty: "medium" as const,
      securityImpact:
        finding.severity === "critical" || finding.severity === "high"
          ? ("high" as const)
          : ("medium" as const),
    })),
    recommendations: [
      {
        category: "headers",
        title: "Add security headers",
        description: "Configure CSP, X-Frame-Options, and HSTS for your deployment.",
        rationale: "Most AI-built apps ship without baseline HTTP hardening.",
        stackTags: context.stack.frameworks,
        priority: "high" as const,
        estimatedMinutes: 10,
      },
    ],
    insights: [
      {
        insightType: "risk_gap",
        title: "Security score vs real risk",
        body: `Security score is ${context.securityScore}, but contextual risk is ${riskScore} because of severity mix and stack exposure.`,
        metricValue: riskScore,
      },
    ],
    learning: [
      {
        learningType: "patterns",
        content: {
          recurring: context.recurringPatterns,
          categories: context.categoryCounts,
        },
      },
    ],
    findingFixes: topFindings.slice(0, 3).map((finding) => ({
      findingId: finding.id,
      explanationSimple: finding.description,
      explanationTechnical: `${finding.title} in ${finding.filePath}:${finding.startLine}`,
      risk: "If left unresolved, this weakness could be abused depending on deployment context.",
      impact: finding.recommendation,
      exploitationProbability:
        finding.severity === "critical" ? "high" : finding.severity === "high" ? "medium" : "low",
      fixExplanation: finding.recommendation,
      cursorPrompt: `Fix this security issue in ${finding.filePath} around line ${finding.startLine}: ${finding.title}. ${finding.recommendation}`,
      claudePrompt: `Review and fix ${finding.title} at ${finding.filePath}:${finding.startLine}. ${finding.recommendation}`,
      implementationSteps: [finding.recommendation],
      validationChecklist: ["Re-run the security scan", "Verify no secret values remain in code"],
      estimatedMinutes: 5,
      difficulty: "easy" as const,
      securityImprovement:
        finding.severity === "critical" ? ("critical" as const) : ("high" as const),
    })),
  };
}

export async function analyzeScanWithClaude(
  context: ProjectSecurityContext
): Promise<{ result: ScanAnalysisResult; model: string; tokensUsed: number }> {
  const deterministic = calculateRiskScore(context);
  const topFindingIds = [...context.findings]
    .sort((a, b) => a.severity.localeCompare(b.severity))
    .slice(0, 8)
    .map((finding) => finding.id);

  const anthropic = getClient();
  if (!anthropic) {
    const fallback = fallbackAnalysis(context);
    fallback.riskScore = deterministic.riskScore;
    fallback.priorityLevel = deterministic.priorityLevel;
    fallback.riskFactors = deterministic.factors;
    return { result: fallback, model: "deterministic-fallback", tokensUsed: 0 };
  }

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 6000,
    system: systemPrompt(context.locale ?? "en"),
    messages: [
      {
        role: "user",
        content: `Analyze this scan context and return JSON only:\n${buildUserPrompt(context, topFindingIds)}`,
      },
    ],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  const raw = textBlock?.type === "text" ? textBlock.text : "";
  const jsonStart = raw.indexOf("{");
  const jsonEnd = raw.lastIndexOf("}");

  let parsed: Partial<ScanAnalysisResult> = {};
  try {
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as Partial<ScanAnalysisResult>;
    }
  } catch {
    parsed = {};
  }

  const fallback = fallbackAnalysis(context);
  return {
    result: {
      executiveSummary: parsed.executiveSummary ?? fallback.executiveSummary,
      coachTip: parsed.coachTip ?? fallback.coachTip,
      riskScore: deterministic.riskScore,
      priorityLevel: deterministic.priorityLevel,
      riskFactors: deterministic.factors,
      priorities: parsed.priorities ?? fallback.priorities,
      recommendations: parsed.recommendations ?? fallback.recommendations,
      insights: parsed.insights ?? fallback.insights,
      learning: parsed.learning ?? fallback.learning,
      findingFixes: parsed.findingFixes ?? fallback.findingFixes,
    },
    model: MODEL,
    tokensUsed: (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0),
  };
}

export { PROMPT_VERSION };
