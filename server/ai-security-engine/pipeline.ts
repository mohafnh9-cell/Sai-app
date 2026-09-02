import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProjectSecurityContext, ScanAnalysisResult } from "@/features/ai-security-engine/types";
import { analyzeScanWithClaude, PROMPT_VERSION } from "./claude-analyzer";
import { buildProjectSecurityContext } from "./context-builder";
import { assertAiBudgetAvailable, AiBudgetExceededError } from "./budget";

export class AISecurityEngineError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400
  ) {
    super(message);
    this.name = "AISecurityEngineError";
  }
}

export async function runAISecurityAnalysis(
  admin: SupabaseClient,
  scanId: string,
  locale: "en" | "es" = "en"
): Promise<{ reportId: string; result: ScanAnalysisResult }> {
  const context = await buildProjectSecurityContext(admin, scanId, locale);
  if (!context) {
    throw new AISecurityEngineError("SCAN_NOT_FOUND", "Scan context could not be built");
  }

  const { data: existing } = await admin
    .from("ai_reports")
    .select("id, status")
    .eq("scan_id", scanId)
    .maybeSingle();
  if (existing?.status === "completed") {
    throw new AISecurityEngineError("ANALYSIS_EXISTS", "AI analysis already completed for this scan");
  }

  let reportId = existing?.id;

  if (reportId) {
    await admin
      .from("ai_reports")
      .update({
        status: "processing",
        error_message: null,
        security_score: context.securityScore,
        prompt_version: PROMPT_VERSION,
      })
      .eq("id", reportId);
  } else {
    const { data: created, error: insertError } = await admin
      .from("ai_reports")
      .insert({
        organization_id: context.organizationId,
        project_id: context.projectId,
        scan_id: scanId,
        status: "processing",
        security_score: context.securityScore,
        prompt_version: PROMPT_VERSION,
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("ai_report_insert_failed", {
        code: insertError.code,
        message: insertError.message,
        scanId,
      });
      if (
        insertError.code === "42P01" ||
        insertError.code === "PGRST205" ||
        insertError.code === "PGRST204"
      ) {
        throw new AISecurityEngineError(
          "AI_SCHEMA_MISSING",
          "AI tables are missing. Run migration 005_ai_security_engine.sql in Supabase SQL Editor.",
          503
        );
      }
      throw new AISecurityEngineError(
        "REPORT_CREATE_FAILED",
        insertError.message || "Could not create AI report",
        500
      );
    }
    reportId = created.id;
  }

  if (!reportId) {
    throw new AISecurityEngineError("REPORT_CREATE_FAILED", "Could not create AI report", 500);
  }

  try {
    // M2 (audit): reject before spending a call, not after -- checked here
    // so every caller of runAISecurityAnalysis gets the ceiling for free,
    // regardless of which scan path invoked it.
    await assertAiBudgetAvailable(admin, context.organizationId);
    const { result, model, tokensUsed } = await analyzeScanWithClaude(context);
    await persistAnalysis(admin, context, reportId, result, model, tokensUsed);
    return { reportId, result };
  } catch (error) {
    if (error instanceof AiBudgetExceededError) {
      console.warn({
        component: "ai-security-pipeline",
        event: "ai_budget_exceeded",
        organizationId: context.organizationId,
        scanId,
        reason: error.reason,
        limit: error.limit,
        used: error.used,
      });
    }
    await admin
      .from("ai_reports")
      .update({
        status: "failed",
        error_message: error instanceof Error ? error.message : "Analysis failed",
      })
      .eq("id", reportId);
    throw error;
  }
}

async function persistAnalysis(
  admin: SupabaseClient,
  context: ProjectSecurityContext,
  reportId: string,
  result: ScanAnalysisResult,
  model: string,
  tokensUsed: number
) {
  await admin
    .from("ai_reports")
    .update({
      status: "completed",
      security_score: context.securityScore,
      risk_score: result.riskScore,
      priority_level: result.priorityLevel,
      executive_summary: result.executiveSummary,
      coach_tip: result.coachTip,
      model,
      tokens_used: tokensUsed,
      metadata: { riskFactors: result.riskFactors },
    })
    .eq("id", reportId);

  await admin.from("ai_priorities").delete().eq("report_id", reportId);
  if (result.priorities.length) {
    await admin.from("ai_priorities").insert(
      result.priorities.map((priority) => ({
        organization_id: context.organizationId,
        project_id: context.projectId,
        scan_id: context.scanId,
        report_id: reportId,
        rank: priority.rank,
        title: priority.title,
        description: priority.description,
        finding_ids: priority.findingIds,
        pattern_group: priority.patternGroup ?? null,
        estimated_minutes: priority.estimatedMinutes,
        difficulty: priority.difficulty,
        security_impact: priority.securityImpact,
      }))
    );
  }

  await admin.from("ai_recommendations").delete().eq("report_id", reportId);
  if (result.recommendations.length) {
    await admin.from("ai_recommendations").insert(
      result.recommendations.map((item) => ({
        organization_id: context.organizationId,
        project_id: context.projectId,
        scan_id: context.scanId,
        report_id: reportId,
        category: item.category,
        title: item.title,
        description: item.description,
        rationale: item.rationale,
        stack_tags: item.stackTags,
        priority: item.priority,
        estimated_minutes: item.estimatedMinutes,
      }))
    );
  }

  await admin.from("security_insights").delete().eq("report_id", reportId);
  if (result.insights.length) {
    await admin.from("security_insights").insert(
      result.insights.map((insight) => ({
        organization_id: context.organizationId,
        project_id: context.projectId,
        scan_id: context.scanId,
        report_id: reportId,
        insight_type: insight.insightType,
        title: insight.title,
        body: insight.body,
        metric_value: insight.metricValue ?? null,
        metric_delta: insight.metricDelta ?? null,
      }))
    );
  }

  for (const item of result.learning) {
    await admin.from("security_learning").insert({
      organization_id: context.organizationId,
      project_id: context.projectId,
      learning_type: item.learningType,
      content: item.content,
    });
  }

  for (const [category, count] of Object.entries(context.categoryCounts)) {
    await admin.from("security_patterns").upsert(
      {
        organization_id: context.organizationId,
        project_id: context.projectId,
        pattern_key: category,
        pattern_label: category.replace(/_/g, " "),
        occurrence_count: count,
        severity: count > 10 ? "high" : count > 4 ? "medium" : "low",
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,project_id,pattern_key" }
    );
  }

  await admin.from("project_risk_scores").upsert(
    {
      organization_id: context.organizationId,
      project_id: context.projectId,
      scan_id: context.scanId,
      security_score: context.securityScore,
      risk_score: result.riskScore,
      priority_level: result.priorityLevel,
      factors: result.riskFactors,
      calculated_at: new Date().toISOString(),
    },
    { onConflict: "scan_id" }
  );

  await admin.from("security_timeline").insert({
    organization_id: context.organizationId,
    project_id: context.projectId,
    scan_id: context.scanId,
    event_type: "ai_analysis_completed",
    security_score: context.securityScore,
    risk_score: result.riskScore,
    title: "AI Security analysis completed",
    description: result.executiveSummary,
    metadata: { priorityLevel: result.priorityLevel },
    occurred_at: new Date().toISOString(),
  });

  for (const fix of result.findingFixes) {
    await admin.from("ai_fixes").upsert(
      {
        organization_id: context.organizationId,
        project_id: context.projectId,
        scan_id: context.scanId,
        finding_id: fix.findingId,
        status: "completed",
        explanation_simple: fix.explanationSimple,
        explanation_technical: fix.explanationTechnical,
        risk: fix.risk,
        impact: fix.impact,
        exploitation_probability: fix.exploitationProbability,
        fix_explanation: fix.fixExplanation,
        code_suggestion: fix.codeSuggestion ?? null,
        diff_patch: fix.diffPatch ?? null,
        cursor_prompt: fix.cursorPrompt,
        claude_prompt: fix.claudePrompt,
        implementation_steps: fix.implementationSteps,
        validation_checklist: fix.validationChecklist,
        estimated_minutes: fix.estimatedMinutes,
        difficulty: fix.difficulty,
        security_improvement: fix.securityImprovement,
        model,
        prompt_version: PROMPT_VERSION,
      },
      { onConflict: "finding_id,prompt_version" }
    );
  }
}

export async function loadScanIntelligence(admin: SupabaseClient, scanId: string) {
  const { data: report } = await admin
    .from("ai_reports")
    .select("*")
    .eq("scan_id", scanId)
    .maybeSingle();
  if (!report) return null;

  const [priorities, recommendations, insights, fixes, risk] = await Promise.all([
    admin.from("ai_priorities").select("*").eq("report_id", report.id).order("rank"),
    admin
      .from("ai_recommendations")
      .select("*")
      .eq("report_id", report.id)
      .order("created_at", { ascending: false }),
    admin
      .from("security_insights")
      .select("*")
      .eq("report_id", report.id)
      .order("created_at", { ascending: false }),
    admin.from("ai_fixes").select("*").eq("scan_id", scanId),
    admin.from("project_risk_scores").select("*").eq("scan_id", scanId).maybeSingle(),
  ]);

  return {
    report,
    priorities: priorities.data ?? [],
    recommendations: recommendations.data ?? [],
    insights: insights.data ?? [],
    fixes: fixes.data ?? [],
    risk: risk.data ?? null,
  };
}
