import type { AIInvariant, AIInvariantCategory } from "../invariants/invariant.types";
import type {
  AIAttackAssumption,
  AIAttackCase,
  AIAttackCategory,
  AIAttackEvidence,
  AIAttackStrategy,
  AIAttackStrategyContext,
} from "./attack.types";
import { attackConfidenceFromInvariant, maxAttackEvidenceConfidence } from "./attack-confidence";
import {
  buildAttackSequence,
  sequenceRequiresNodes,
  type SequenceBlueprintStep,
} from "./attack-sequence";
import { stableAiId } from "../model/stable-id";
import { canonicalPathId } from "../invariants/invariant-graph-helpers";

type AttackTemplate = {
  suffix: string;
  category: AIAttackCategory;
  title: string;
  description: string;
  capability: AIAttackAssumption["capability"];
  blueprint: SequenceBlueprintStep[];
  expectedImpact: string;
  runtimeStrategy: string;
  mitigation: string;
  assumptions: Omit<AIAttackAssumption, "id">[];
  requiredNodeKinds?: import("../model/execution-graph.types").AIExecutionNodeKind[];
  manipulatedKind: AIAttackCase["manipulatedComponentKind"];
};

function assumption(
  statement: string,
  capability: AIAttackAssumption["capability"],
  required = true
): Omit<AIAttackAssumption, "id"> {
  return { statement, required, capability };
}

function invariantEvidenceToAttack(invariant: AIInvariant): AIAttackEvidence[] {
  return invariant.evidence.map((e) => ({
    id: stableAiId(`attack-ev:inv:${invariant.invariantKey}:${e.id}`),
    source: "invariant" as const,
    detail: e.detail,
    confidence: e.confidence,
    refId: invariant.id,
  }));
}

function baseAttack(
  ctx: AIAttackStrategyContext,
  template: AttackTemplate
): AIAttackCase | null {
  const { graph, invariant } = ctx;
  if (template.requiredNodeKinds && !sequenceRequiresNodes(graph, template.requiredNodeKinds)) {
    return null;
  }

  const evidence: AIAttackEvidence[] = [
    ...invariantEvidenceToAttack(invariant),
    {
      id: stableAiId(`attack-ev:boundary:${invariant.invariantKey}`),
      source: "trust_boundary",
      detail: `Targets trust boundary ${invariant.protectedTrustBoundaryId}`,
      confidence: 0.82,
      refId: invariant.protectedTrustBoundaryId,
    },
  ];

  const evidenceMax = maxAttackEvidenceConfidence(evidence);
  const confidence = attackConfidenceFromInvariant(invariant.confidence, evidenceMax);
  if (confidence === "unsupported") return null;

  const pathId =
    invariant.relationships.executionPathId ?? canonicalPathId(graph);

  const sequence = buildAttackSequence({
    graph,
    invariant,
    pathId,
    blueprint: template.blueprint,
    violationSummary: invariant.title,
    expectedConsequence: template.expectedImpact,
  });

  if (sequence.graphNodeIds.length === 0 && template.requiredNodeKinds?.length) {
    return null;
  }

  const assumptions: AIAttackAssumption[] = template.assumptions.map((a, i) => ({
    ...a,
    id: stableAiId(`attack-asm:${invariant.invariantKey}:${template.suffix}:${i}`),
  }));

  return {
    id: stableAiId(`attack:${invariant.invariantKey}:${template.suffix}`),
    attackKey: `${invariant.invariantKey}:attack:${template.suffix}`,
    title: template.title,
    description: template.description,
    category: template.category,
    targetInvariantId: invariant.id,
    targetInvariantKey: invariant.invariantKey,
    targetTrustBoundaryId: invariant.protectedTrustBoundaryId,
    targetComponentNodeIds: invariant.relationships.protectedComponentNodeIds,
    manipulatedComponentKind: template.manipulatedKind,
    executionGraphId: graph.id,
    sequence,
    attackerCapability: template.capability,
    expectedImpact: template.expectedImpact,
    confidence,
    evidence,
    assumptions,
    suggestedRuntimeStrategy: template.runtimeStrategy,
    potentialMitigationCategory: template.mitigation,
    metadata: {
      providerFamily: null,
      strategyId: `core:${invariant.category}`,
      specialistPackId: null,
      tags: [template.category, invariant.category],
      generationPass: "rt10_slice4",
    },
  };
}

function templatesForCategory(category: AIInvariantCategory): AttackTemplate[] {
  const userPrompt = ["user_prompt"] as const;
  const llm = ["llm"] as const;
  const tool = ["tool", "llm"] as const;
  const rag = ["retrieved_context", "llm"] as const;
  const memory = ["memory"] as const;
  const mcp = ["mcp_client", "mcp_server"] as const;
  const agent = ["agent", "llm"] as const;

  const promptChain: SequenceBlueprintStep[] = [
    {
      nodeKind: "user_prompt",
      actionKind: "inject_prompt",
      actionLabel: "Submit adversarial user content",
      capability: "anonymous_user",
    },
    {
      nodeKind: "attack",
      actionKind: "inject_prompt",
      actionLabel: "Prompt injection payload merged into model context",
      capability: "anonymous_user",
    },
    {
      nodeKind: "llm",
      actionKind: "cross_boundary",
      actionLabel: "LLM executes with violated instruction priority",
      capability: "anonymous_user",
    },
    {
      nodeKind: "invariant_violation",
      actionKind: "chain_step",
      actionLabel: "Trust invariant violated",
      capability: "anonymous_user",
      marksViolation: true,
    },
  ];

  const map: Partial<Record<AIInvariantCategory, AttackTemplate[]>> = {
    prompt_integrity: [
      {
        suffix: "prompt_injection",
        category: "prompt_injection",
        title: "Direct prompt injection against user prompt boundary",
        description:
          "Adversarial user content attempts to override trusted instructions at the user-to-model trust boundary.",
        capability: "anonymous_user",
        blueprint: promptChain,
        expectedImpact: "Model follows attacker instructions instead of policy-bound behavior.",
        runtimeStrategy: "mock_user_turn_with_injection_payload",
        mitigation: "input_sanitization_and_instruction_firewall",
        assumptions: [assumption("Attacker can send arbitrary chat messages.", "anonymous_user")],
        requiredNodeKinds: [...userPrompt, ...llm],
        manipulatedKind: "user_prompt",
      },
    ],
    instruction_priority: [
      {
        suffix: "instruction_override",
        category: "instruction_override",
        title: "Instruction override via user priority escalation",
        description: "User-supplied text attempts to outrank system instructions before LLM execution.",
        capability: "authenticated_user",
        blueprint: promptChain,
        expectedImpact: "System instruction priority invariant broken.",
        runtimeStrategy: "mock_priority_conflict_turn",
        mitigation: "hierarchical_prompt_enforcement",
        assumptions: [assumption("Attacker can influence user message content.", "authenticated_user")],
        requiredNodeKinds: ["system_prompt", "user_prompt", "llm"],
        manipulatedKind: "user_prompt",
      },
    ],
    instruction_integrity: [
      {
        suffix: "instruction_shadowing",
        category: "instruction_shadowing",
        title: "Instruction shadowing across prompt layers",
        description: "Hidden instructions duplicate or shadow developer/system layers in composed context.",
        capability: "authenticated_user",
        blueprint: [
          {
            nodeKind: "developer_prompt",
            actionKind: "manipulate_context",
            actionLabel: "Shadow developer layer with attacker text",
            capability: "authenticated_user",
          },
          {
            nodeKind: "user_prompt",
            actionKind: "inject_prompt",
            actionLabel: "Reinforce shadow instructions from user channel",
            capability: "authenticated_user",
          },
          { nodeKind: "llm", actionKind: "cross_boundary", actionLabel: "Model honors shadow layer", capability: "authenticated_user" },
          { nodeKind: "invariant_violation", actionKind: "chain_step", actionLabel: "Instruction integrity violated", capability: "authenticated_user", marksViolation: true },
        ],
        expectedImpact: "Composed instructions no longer match intended policy trace.",
        runtimeStrategy: "mock_layered_prompt_shadow",
        mitigation: "prompt_layer_signing",
        assumptions: [assumption("Attacker can supply multi-part prompt content.", "authenticated_user")],
        requiredNodeKinds: ["system_prompt", "user_prompt", "llm"],
        manipulatedKind: "multi",
      },
      {
        suffix: "indirect_via_trust",
        category: "indirect_prompt_injection",
        title: "Indirect injection via trusted context channel",
        description: "Untrusted data enters context through a trusted path before LLM execution.",
        capability: "malicious_document_author",
        blueprint: [
          {
            nodeKind: "retrieved_context",
            actionKind: "poison_source",
            actionLabel: "Poisoned document embedded in retrieval",
            capability: "malicious_document_author",
          },
          {
            nodeKind: "user_prompt",
            actionKind: "inject_prompt",
            actionLabel: "Benign user query triggers retrieval",
            capability: "anonymous_user",
          },
          { nodeKind: "llm", actionKind: "manipulate_context", actionLabel: "Model executes poisoned context", capability: "malicious_document_author" },
          { nodeKind: "invariant_violation", actionKind: "chain_step", actionLabel: "Instruction integrity violated", capability: "malicious_document_author", marksViolation: true },
        ],
        expectedImpact: "Indirect instructions executed without direct user injection.",
        runtimeStrategy: "mock_rag_indirect_injection",
        mitigation: "retrieval_provenance_and_sandbox",
        assumptions: [assumption("Attacker can place content in a retrievable source.", "malicious_document_author")],
        requiredNodeKinds: [...rag],
        manipulatedKind: "retrieved_context",
      },
    ],
    system_prompt_integrity: [
      {
        suffix: "system_prompt_extraction",
        category: "system_prompt_extraction",
        title: "System prompt extraction attempt",
        description: "Attacker probes model to leak system prompt content across trust boundary.",
        capability: "anonymous_user",
        blueprint: [
          { nodeKind: "user_prompt", actionKind: "inject_prompt", actionLabel: "Exfiltration-oriented user turn", capability: "anonymous_user" },
          { nodeKind: "llm", actionKind: "extract_prompt", actionLabel: "Model coerced toward system prompt disclosure", capability: "anonymous_user" },
          { nodeKind: "response", actionKind: "cross_boundary", actionLabel: "Response may contain system instructions", capability: "anonymous_user" },
          { nodeKind: "invariant_violation", actionKind: "chain_step", actionLabel: "System prompt integrity violated", capability: "anonymous_user", marksViolation: true },
        ],
        expectedImpact: "Confidential system instructions exposed to user.",
        runtimeStrategy: "mock_exfiltration_turns",
        mitigation: "output_redaction_and_refusal",
        assumptions: [assumption("Attacker can iteratively query the assistant.", "anonymous_user")],
        requiredNodeKinds: ["system_prompt", "user_prompt", "llm"],
        manipulatedKind: "system_prompt",
      },
    ],
    developer_prompt_integrity: [
      {
        suffix: "developer_prompt_extraction",
        category: "developer_prompt_extraction",
        title: "Developer prompt extraction attempt",
        description: "Attacker attempts to recover developer-only instructions from model behavior or output.",
        capability: "workspace_member",
        blueprint: [
          { nodeKind: "user_prompt", actionKind: "inject_prompt", actionLabel: "Probe for developer instruction leakage", capability: "workspace_member" },
          { nodeKind: "developer_prompt", actionKind: "extract_prompt", actionLabel: "Developer layer targeted for disclosure", capability: "workspace_member" },
          { nodeKind: "invariant_violation", actionKind: "chain_step", actionLabel: "Developer prompt integrity violated", capability: "workspace_member", marksViolation: true },
        ],
        expectedImpact: "Internal developer instructions revealed.",
        runtimeStrategy: "mock_developer_layer_probe",
        mitigation: "scope_separation_and_refusal",
        assumptions: [assumption("Attacker has workspace chat access.", "workspace_member")],
        requiredNodeKinds: ["developer_prompt", "user_prompt"],
        manipulatedKind: "developer_prompt",
      },
    ],
    trust_boundary_preservation: [
      {
        suffix: "multi_step_chain",
        category: "multi_step_ai_attack_chains",
        title: "Multi-step trust boundary crossing chain",
        description: "Chained manipulations move untrusted input across the modeled trust boundary into inference.",
        capability: "authenticated_user",
        blueprint: [
          { nodeKind: "user", actionKind: "cross_boundary", actionLabel: "Untrusted user entry", capability: "authenticated_user" },
          { nodeKind: "user_prompt", actionKind: "inject_prompt", actionLabel: "Payload at boundary crossing", capability: "authenticated_user" },
          { nodeKind: "llm", actionKind: "cross_boundary", actionLabel: "Inference accepts untrusted control", capability: "authenticated_user" },
          { nodeKind: "invariant_violation", actionKind: "chain_step", actionLabel: "Trust boundary preservation violated", capability: "authenticated_user", marksViolation: true },
        ],
        expectedImpact: "User-controlled content treated as trusted inside model zone.",
        runtimeStrategy: "mock_boundary_crossing_chain",
        mitigation: "strict_trust_zone_enforcement",
        assumptions: [assumption("Attacker can submit boundary-crossing input.", "authenticated_user")],
        requiredNodeKinds: ["user_prompt", "llm"],
        manipulatedKind: "user_prompt",
      },
      {
        suffix: "indirect_boundary",
        category: "indirect_prompt_injection",
        title: "Indirect injection crossing trust boundary",
        description: "Third-party content carries instructions that cross the user-to-model trust boundary.",
        capability: "malicious_rag_source",
        blueprint: [
          { nodeKind: "knowledge_base", actionKind: "poison_source", actionLabel: "Malicious knowledge indexed", capability: "malicious_rag_source" },
          { nodeKind: "retrieved_context", actionKind: "manipulate_context", actionLabel: "Poisoned chunk retrieved", capability: "malicious_rag_source" },
          { nodeKind: "llm", actionKind: "cross_boundary", actionLabel: "Inference trusts poisoned context", capability: "malicious_rag_source" },
          { nodeKind: "invariant_violation", actionKind: "chain_step", actionLabel: "Trust boundary violated", capability: "malicious_rag_source", marksViolation: true },
        ],
        expectedImpact: "Indirect control of model without direct prompt injection.",
        runtimeStrategy: "mock_indirect_boundary_cross",
        mitigation: "retrieval_isolation",
        assumptions: [assumption("Attacker can influence indexed knowledge.", "malicious_rag_source")],
        requiredNodeKinds: ["retrieved_context", "llm"],
        manipulatedKind: "retrieved_context",
      },
    ],
    conversation_isolation: [
      {
        suffix: "cross_conversation",
        category: "cross_conversation_injection",
        title: "Cross-conversation injection",
        description: "Content from one conversation influences another session's privileged context.",
        capability: "authenticated_user",
        blueprint: [
          { nodeKind: "conversation", actionKind: "inject_prompt", actionLabel: "Foreign conversation artifact introduced", capability: "authenticated_user" },
          { nodeKind: "user_prompt", actionKind: "manipulate_context", actionLabel: "Isolated thread receives foreign input", capability: "authenticated_user" },
          { nodeKind: "invariant_violation", actionKind: "chain_step", actionLabel: "Conversation isolation violated", capability: "authenticated_user", marksViolation: true },
        ],
        expectedImpact: "Session boundary leak or instruction bleed.",
        runtimeStrategy: "mock_cross_session_turn",
        mitigation: "session_scoped_context",
        assumptions: [assumption("Attacker controls multiple sessions or shared store.", "authenticated_user")],
        requiredNodeKinds: ["user_prompt"],
        manipulatedKind: "conversation",
      },
      {
        suffix: "conversation_hijack",
        category: "conversation_hijacking",
        title: "Conversation hijacking",
        description: "Attacker steers conversation flow away from isolated user/system separation.",
        capability: "authenticated_user",
        blueprint: [
          { nodeKind: "user_prompt", actionKind: "inject_prompt", actionLabel: "Hijack turn sequence", capability: "authenticated_user" },
          { nodeKind: "memory", actionKind: "replay_memory", actionLabel: "Prior turns replayed into active thread", capability: "authenticated_user" },
          { nodeKind: "invariant_violation", actionKind: "chain_step", actionLabel: "Conversation isolation violated", capability: "authenticated_user", marksViolation: true },
        ],
        expectedImpact: "Attacker controls dialog state across turns.",
        runtimeStrategy: "mock_conversation_state_hijack",
        mitigation: "conversation_state_binding",
        assumptions: [assumption("Attacker can influence turn ordering or IDs.", "authenticated_user")],
        requiredNodeKinds: ["user_prompt"],
        manipulatedKind: "conversation",
      },
    ],
    conversation_continuity: [
      {
        suffix: "memory_replay",
        category: "memory_replay",
        title: "Memory replay breaking continuity",
        description: "Stale or foreign memory replayed into active conversation path.",
        capability: "authenticated_user",
        blueprint: [
          { nodeKind: "memory", actionKind: "replay_memory", actionLabel: "Replay stored turns", capability: "authenticated_user" },
          { nodeKind: "llm", actionKind: "manipulate_context", actionLabel: "Model conditions on replayed memory", capability: "authenticated_user" },
          { nodeKind: "invariant_violation", actionKind: "chain_step", actionLabel: "Conversation continuity violated", capability: "authenticated_user", marksViolation: true },
        ],
        expectedImpact: "Wrong historical context drives responses.",
        runtimeStrategy: "mock_memory_replay",
        mitigation: "memory_versioning",
        assumptions: [assumption("Attacker can trigger memory read on session.", "authenticated_user")],
        requiredNodeKinds: [...memory, ...llm],
        manipulatedKind: "memory",
      },
    ],
    tool_authorization: [
      {
        suffix: "unauthorized_tool",
        category: "unauthorized_tool_invocation",
        title: "Unauthorized tool invocation",
        description: "Tool called without passing through authorized LLM/tool boundary.",
        capability: "authenticated_user",
        blueprint: [
          { nodeKind: "user_prompt", actionKind: "inject_prompt", actionLabel: "Coerce tool use via prompt", capability: "authenticated_user" },
          { nodeKind: "llm", actionKind: "invoke_tool", actionLabel: "Model selects restricted tool", capability: "authenticated_user" },
          { nodeKind: "tool", actionKind: "cross_boundary", actionLabel: "Tool executes outside authorization", capability: "authenticated_user" },
          { nodeKind: "invariant_violation", actionKind: "chain_step", actionLabel: "Tool authorization violated", capability: "authenticated_user", marksViolation: true },
        ],
        expectedImpact: "Sensitive tool action executed without proper authorization.",
        runtimeStrategy: "mock_unauthorized_tool_call",
        mitigation: "server_side_tool_allowlist",
        assumptions: [assumption("Attacker can influence model tool selection.", "authenticated_user")],
        requiredNodeKinds: [...tool],
        manipulatedKind: "tool",
      },
    ],
    tool_isolation: [
      {
        suffix: "tool_abuse",
        category: "tool_abuse",
        title: "Tool abuse via isolated boundary break",
        description: "Tool privileges combined with untrusted prompt or retrieval context.",
        capability: "authenticated_user",
        blueprint: [
          { nodeKind: "user_prompt", actionKind: "inject_prompt", actionLabel: "Malicious tool-use intent", capability: "authenticated_user" },
          { nodeKind: "tool", actionKind: "invoke_tool", actionLabel: "Tool invoked with attacker-driven args", capability: "authenticated_user" },
          { nodeKind: "external_api", actionKind: "cross_boundary", actionLabel: "Backend reached via tool", capability: "authenticated_user" },
          { nodeKind: "invariant_violation", actionKind: "chain_step", actionLabel: "Tool isolation violated", capability: "authenticated_user", marksViolation: true },
        ],
        expectedImpact: "Tool used as privilege bridge.",
        runtimeStrategy: "mock_tool_abuse_path",
        mitigation: "tool_sandboxing",
        assumptions: [assumption("Attacker can steer tool arguments.", "authenticated_user")],
        requiredNodeKinds: ["tool", "llm"],
        manipulatedKind: "tool",
      },
    ],
    tool_parameter_integrity: [
      {
        suffix: "parameter_injection",
        category: "parameter_injection",
        title: "Tool parameter injection",
        description: "Attacker supplies malicious parameters that violate tool contract validation.",
        capability: "authenticated_user",
        blueprint: [
          { nodeKind: "llm", actionKind: "manipulate_parameters", actionLabel: "Model emits attacker-controlled parameters", capability: "authenticated_user" },
          { nodeKind: "tool", actionKind: "manipulate_parameters", actionLabel: "Parameters accepted without validation", capability: "authenticated_user" },
          { nodeKind: "invariant_violation", actionKind: "chain_step", actionLabel: "Tool parameter integrity violated", capability: "authenticated_user", marksViolation: true },
        ],
        expectedImpact: "Tool executes with unsafe or escalated parameters.",
        runtimeStrategy: "mock_parameter_injection",
        mitigation: "schema_validation_and_allowlists",
        assumptions: [assumption("Attacker influences structured tool args.", "authenticated_user")],
        requiredNodeKinds: ["tool", "llm"],
        manipulatedKind: "tool",
      },
    ],
    tool_result_validation: [
      {
        suffix: "tool_result_injection",
        category: "tool_result_injection",
        title: "Tool result injection",
        description: "Forged or manipulated tool output fed back into LLM context.",
        capability: "compromised_tool",
        blueprint: [
          { nodeKind: "tool", actionKind: "inject_tool_result", actionLabel: "Compromised tool returns adversarial payload", capability: "compromised_tool" },
          { nodeKind: "llm", actionKind: "manipulate_context", actionLabel: "Model trusts unvalidated tool output", capability: "compromised_tool" },
          { nodeKind: "invariant_violation", actionKind: "chain_step", actionLabel: "Tool result validation violated", capability: "compromised_tool", marksViolation: true },
        ],
        expectedImpact: "Downstream inference follows attacker-controlled tool data.",
        runtimeStrategy: "mock_forged_tool_result",
        mitigation: "tool_output_signing_and_validation",
        assumptions: [assumption("Tool backend or result channel is compromised.", "compromised_tool")],
        requiredNodeKinds: ["tool", "llm"],
        manipulatedKind: "tool",
      },
    ],
    function_call_integrity: [
      {
        suffix: "function_call_manipulation",
        category: "function_call_manipulation",
        title: "Function call manipulation",
        description: "Function/tool call surface invoked outside declared contract.",
        capability: "authenticated_user",
        blueprint: [
          { nodeKind: "llm", actionKind: "invoke_tool", actionLabel: "Unexpected function selected", capability: "authenticated_user" },
          { nodeKind: "function_call", actionKind: "manipulate_parameters", actionLabel: "Call shape does not match declaration", capability: "authenticated_user" },
          { nodeKind: "invariant_violation", actionKind: "chain_step", actionLabel: "Function call integrity violated", capability: "authenticated_user", marksViolation: true },
        ],
        expectedImpact: "Arbitrary or mis-scoped function execution.",
        runtimeStrategy: "mock_function_call_mismatch",
        mitigation: "strict_function_registry",
        assumptions: [assumption("Attacker can influence function call JSON.", "authenticated_user")],
        requiredNodeKinds: ["tool", "llm"],
        manipulatedKind: "function_call",
      },
    ],
    retrieval_integrity: [
      {
        suffix: "retrieved_context_manipulation",
        category: "retrieved_context_manipulation",
        title: "Retrieved context manipulation",
        description: "Attacker alters chunks injected into LLM input.",
        capability: "malicious_rag_source",
        blueprint: [
          { nodeKind: "vector_store", actionKind: "poison_source", actionLabel: "Corrupt indexed vectors", capability: "malicious_rag_source" },
          { nodeKind: "retrieved_context", actionKind: "manipulate_context", actionLabel: "Malicious chunk selected", capability: "malicious_rag_source" },
          { nodeKind: "llm", actionKind: "manipulate_context", actionLabel: "Model acts on tampered context", capability: "malicious_rag_source" },
          { nodeKind: "invariant_violation", actionKind: "chain_step", actionLabel: "Retrieval integrity violated", capability: "malicious_rag_source", marksViolation: true },
        ],
        expectedImpact: "Model decisions based on attacker-controlled retrieval.",
        runtimeStrategy: "mock_retrieval_tamper",
        mitigation: "retrieval_signatures",
        assumptions: [assumption("Attacker can write to retrieval corpus.", "malicious_rag_source")],
        requiredNodeKinds: [...rag],
        manipulatedKind: "retrieved_context",
      },
    ],
    retrieval_authenticity: [
      {
        suffix: "rag_poisoning",
        category: "rag_poisoning",
        title: "RAG poisoning",
        description: "Knowledge corpus poisoned so retrieval returns attacker instructions.",
        capability: "malicious_rag_source",
        blueprint: [
          { nodeKind: "knowledge_base", actionKind: "poison_source", actionLabel: "Poison documents ingested", capability: "malicious_rag_source" },
          { nodeKind: "retrieved_context", actionKind: "poison_source", actionLabel: "Poisoned chunk retrieved", capability: "malicious_rag_source" },
          { nodeKind: "llm", actionKind: "inject_prompt", actionLabel: "Instructions in context treated as trusted", capability: "malicious_rag_source" },
          { nodeKind: "invariant_violation", actionKind: "chain_step", actionLabel: "Retrieval authenticity violated", capability: "malicious_rag_source", marksViolation: true },
        ],
        expectedImpact: "Persistent instruction injection via knowledge base.",
        runtimeStrategy: "mock_rag_poison_ingest",
        mitigation: "corpus_provenance_controls",
        assumptions: [assumption("Attacker can add or modify indexed documents.", "malicious_rag_source")],
        requiredNodeKinds: ["retrieved_context", "llm"],
        manipulatedKind: "retrieved_context",
      },
    ],
    knowledge_trust: [
      {
        suffix: "vector_store_poisoning",
        category: "vector_store_poisoning",
        title: "Vector store poisoning",
        description: "Embeddings/index entries manipulated to surface malicious content.",
        capability: "malicious_rag_source",
        blueprint: [
          { nodeKind: "vector_store", actionKind: "poison_source", actionLabel: "Vectors or metadata poisoned", capability: "malicious_rag_source" },
          { nodeKind: "retrieved_context", actionKind: "manipulate_context", actionLabel: "Poisoned neighbors retrieved", capability: "malicious_rag_source" },
          { nodeKind: "invariant_violation", actionKind: "chain_step", actionLabel: "Knowledge trust violated", capability: "malicious_rag_source", marksViolation: true },
        ],
        expectedImpact: "Tenant-inappropriate or malicious knowledge trusted.",
        runtimeStrategy: "mock_vector_poison",
        mitigation: "index_integrity_monitoring",
        assumptions: [assumption("Attacker can modify vector index entries.", "malicious_rag_source")],
        requiredNodeKinds: ["vector_store", "retrieved_context"],
        manipulatedKind: "vector_store",
      },
    ],
    embedding_integrity: [
      {
        suffix: "embedding_poisoning",
        category: "embedding_poisoning",
        title: "Embedding poisoning",
        description: "Embedding pipeline maps attacker content to trusted retrieval slots.",
        capability: "malicious_rag_source",
        blueprint: [
          { nodeKind: "embedding", actionKind: "poison_source", actionLabel: "Adversarial embedding inserted", capability: "malicious_rag_source" },
          { nodeKind: "retrieved_context", actionKind: "manipulate_context", actionLabel: "Wrong neighbors retrieved", capability: "malicious_rag_source" },
          { nodeKind: "invariant_violation", actionKind: "chain_step", actionLabel: "Embedding integrity violated", capability: "malicious_rag_source", marksViolation: true },
        ],
        expectedImpact: "Retrieval ranking manipulated via embeddings.",
        runtimeStrategy: "mock_embedding_poison",
        mitigation: "embedding_pipeline_validation",
        assumptions: [assumption("Attacker influences embedding inputs.", "malicious_rag_source")],
        requiredNodeKinds: ["vector_store", "retrieved_context"],
        manipulatedKind: "embedding",
      },
    ],
    memory_isolation: [
      {
        suffix: "memory_leakage",
        category: "memory_leakage",
        title: "Memory leakage across scope",
        description: "Memory from another scope readable in current inference path.",
        capability: "authenticated_user",
        blueprint: [
          { nodeKind: "memory", actionKind: "replay_memory", actionLabel: "Foreign memory read into context", capability: "authenticated_user" },
          { nodeKind: "llm", actionKind: "manipulate_context", actionLabel: "Model uses leaked memory", capability: "authenticated_user" },
          { nodeKind: "invariant_violation", actionKind: "chain_step", actionLabel: "Memory isolation violated", capability: "authenticated_user", marksViolation: true },
        ],
        expectedImpact: "Cross-session or cross-user data exposure.",
        runtimeStrategy: "mock_memory_leak_read",
        mitigation: "memory_tenant_isolation",
        assumptions: [assumption("Memory store lacks strict tenant keys.", "authenticated_user")],
        requiredNodeKinds: [...memory, ...llm],
        manipulatedKind: "memory",
      },
      {
        suffix: "memory_cross_tenant",
        category: "memory_cross_tenant_access",
        title: "Memory cross-tenant access",
        description: "Attacker retrieves another tenant's conversation memory.",
        capability: "workspace_member",
        blueprint: [
          { nodeKind: "memory", actionKind: "cross_boundary", actionLabel: "Cross-tenant memory key referenced", capability: "workspace_member" },
          { nodeKind: "invariant_violation", actionKind: "chain_step", actionLabel: "Memory isolation violated", capability: "workspace_member", marksViolation: true },
        ],
        expectedImpact: "Confidential memory from another tenant disclosed.",
        runtimeStrategy: "mock_cross_tenant_memory_id",
        mitigation: "tenant_scoped_memory_ids",
        assumptions: [assumption("Attacker can guess or swap memory identifiers.", "workspace_member")],
        requiredNodeKinds: [...memory],
        manipulatedKind: "memory",
      },
    ],
    memory_ownership: [
      {
        suffix: "memory_poisoning",
        category: "memory_poisoning",
        title: "Memory poisoning",
        description: "Attacker writes durable memory that influences future turns.",
        capability: "authenticated_user",
        blueprint: [
          { nodeKind: "user_prompt", actionKind: "inject_prompt", actionLabel: "Turn crafted to poison memory write", capability: "authenticated_user" },
          { nodeKind: "response", actionKind: "cross_boundary", actionLabel: "Assistant path persists attacker text", capability: "authenticated_user" },
          { nodeKind: "memory", actionKind: "poison_source", actionLabel: "Poisoned memory stored", capability: "authenticated_user" },
          { nodeKind: "invariant_violation", actionKind: "chain_step", actionLabel: "Memory ownership violated", capability: "authenticated_user", marksViolation: true },
        ],
        expectedImpact: "Future sessions inherit attacker-controlled memory.",
        runtimeStrategy: "mock_memory_write_poison",
        mitigation: "memory_write_validation",
        assumptions: [assumption("Attacker can influence assistant output stored to memory.", "authenticated_user")],
        requiredNodeKinds: [...memory],
        manipulatedKind: "memory",
      },
    ],
    memory_freshness: [
      {
        suffix: "stale_memory_replay",
        category: "memory_replay",
        title: "Stale memory replay",
        description: "Outdated memory used despite freshness invariant.",
        capability: "insider",
        blueprint: [
          { nodeKind: "memory", actionKind: "replay_memory", actionLabel: "Archived memory injected", capability: "insider" },
          { nodeKind: "llm", actionKind: "manipulate_context", actionLabel: "Stale context drives answer", capability: "insider" },
          { nodeKind: "invariant_violation", actionKind: "chain_step", actionLabel: "Memory freshness violated", capability: "insider", marksViolation: true },
        ],
        expectedImpact: "Decisions based on obsolete session state.",
        runtimeStrategy: "mock_stale_memory",
        mitigation: "memory_ttl_enforcement",
        assumptions: [assumption("Insider or bug exposes archived memory.", "insider")],
        requiredNodeKinds: [...memory, ...llm],
        manipulatedKind: "memory",
      },
    ],
    context_integrity: [
      {
        suffix: "context_manipulation",
        category: "context_manipulation",
        title: "Context manipulation",
        description: "LLM input context composed from untrusted sources without integrity checks.",
        capability: "authenticated_user",
        blueprint: [
          { nodeKind: "user_prompt", actionKind: "manipulate_context", actionLabel: "Alter visible context slots", capability: "authenticated_user" },
          { nodeKind: "retrieved_context", actionKind: "manipulate_context", actionLabel: "Swap retrieval segment", capability: "authenticated_user" },
          { nodeKind: "llm", actionKind: "manipulate_context", actionLabel: "Model runs on tampered bundle", capability: "authenticated_user" },
          { nodeKind: "invariant_violation", actionKind: "chain_step", actionLabel: "Context integrity violated", capability: "authenticated_user", marksViolation: true },
        ],
        expectedImpact: "Integrity of composed LLM input lost.",
        runtimeStrategy: "mock_context_bundle_tamper",
        mitigation: "context_provenance",
        assumptions: [assumption("Attacker can influence multiple context slots.", "authenticated_user")],
        requiredNodeKinds: ["llm"],
        manipulatedKind: "multi",
      },
      {
        suffix: "context_overflow",
        category: "context_overflow",
        title: "Context overflow",
        description: "Oversized input displaces trusted instructions from context window.",
        capability: "anonymous_user",
        blueprint: [
          { nodeKind: "user_prompt", actionKind: "manipulate_context", actionLabel: "Oversized user payload", capability: "anonymous_user" },
          { nodeKind: "system_prompt", actionKind: "manipulate_context", actionLabel: "System instructions truncated", capability: "anonymous_user" },
          { nodeKind: "invariant_violation", actionKind: "chain_step", actionLabel: "Context integrity violated", capability: "anonymous_user", marksViolation: true },
        ],
        expectedImpact: "Policy instructions dropped from active context.",
        runtimeStrategy: "mock_context_window_overflow",
        mitigation: "context_budget_and_priority",
        assumptions: [assumption("Attacker can send very large messages.", "anonymous_user")],
        requiredNodeKinds: ["user_prompt", "system_prompt", "llm"],
        manipulatedKind: "user_prompt",
      },
      {
        suffix: "context_truncation",
        category: "context_truncation",
        title: "Context truncation abuse",
        description: "Attacker forces truncation that removes safety-critical segments.",
        capability: "anonymous_user",
        blueprint: [
          { nodeKind: "user_prompt", actionKind: "manipulate_context", actionLabel: "Payload engineered for truncation", capability: "anonymous_user" },
          { nodeKind: "guardrail", actionKind: "bypass_filter", actionLabel: "Guardrail segment truncated away", capability: "anonymous_user" },
          { nodeKind: "invariant_violation", actionKind: "chain_step", actionLabel: "Context integrity violated", capability: "anonymous_user", marksViolation: true },
        ],
        expectedImpact: "Safety context removed before inference.",
        runtimeStrategy: "mock_truncation_edge",
        mitigation: "protected_context_slots",
        assumptions: [assumption("Attacker can fill context to force truncation.", "anonymous_user")],
        requiredNodeKinds: ["user_prompt", "llm"],
        manipulatedKind: "user_prompt",
      },
    ],
    output_validation: [
      {
        suffix: "output_manipulation",
        category: "output_manipulation",
        title: "Output manipulation before validation",
        description: "Model output altered or routed before validation pipeline completes.",
        capability: "authenticated_user",
        blueprint: [
          { nodeKind: "llm", actionKind: "manipulate_context", actionLabel: "Unsafe completion generated", capability: "authenticated_user" },
          { nodeKind: "response", actionKind: "bypass_filter", actionLabel: "Output skips validation gate", capability: "authenticated_user" },
          { nodeKind: "invariant_violation", actionKind: "chain_step", actionLabel: "Output validation violated", capability: "authenticated_user", marksViolation: true },
        ],
        expectedImpact: "Unsafe content reaches user.",
        runtimeStrategy: "mock_skip_output_validation",
        mitigation: "mandatory_output_pipeline",
        assumptions: [assumption("Attacker can trigger path without validators.", "authenticated_user")],
        requiredNodeKinds: ["llm", "response"],
        manipulatedKind: "response",
      },
    ],
    output_filtering: [
      {
        suffix: "filter_bypass",
        category: "guardrail_bypass",
        title: "Output filtering bypass",
        description: "Response released without passing output filters.",
        capability: "anonymous_user",
        blueprint: [
          { nodeKind: "llm", actionKind: "bypass_filter", actionLabel: "Completion bypasses filter stage", capability: "anonymous_user" },
          { nodeKind: "guardrail", actionKind: "bypass_filter", actionLabel: "Guardrail not applied", capability: "anonymous_user" },
          { nodeKind: "invariant_violation", actionKind: "chain_step", actionLabel: "Output filtering violated", capability: "anonymous_user", marksViolation: true },
        ],
        expectedImpact: "Policy-violating output delivered.",
        runtimeStrategy: "mock_filter_bypass_path",
        mitigation: "non_skippable_filter_chain",
        assumptions: [assumption("Streaming or error path skips filters.", "anonymous_user")],
        requiredNodeKinds: ["guardrail", "response"],
        manipulatedKind: "response",
      },
    ],
    guardrail_integrity: [
      {
        suffix: "guardrail_bypass",
        category: "guardrail_bypass",
        title: "Guardrail bypass",
        description: "Guardrail node circumvented on modeled response path.",
        capability: "anonymous_user",
        blueprint: [
          { nodeKind: "llm", actionKind: "bypass_filter", actionLabel: "Unsafe generation", capability: "anonymous_user" },
          { nodeKind: "guardrail", actionKind: "bypass_filter", actionLabel: "Guardrail skipped or disabled", capability: "anonymous_user" },
          { nodeKind: "invariant_violation", actionKind: "chain_step", actionLabel: "Guardrail integrity violated", capability: "anonymous_user", marksViolation: true },
        ],
        expectedImpact: "Guardrails fail to enforce policy.",
        runtimeStrategy: "mock_guardrail_short_circuit",
        mitigation: "guardrail_enforcement_hooks",
        assumptions: [assumption("Alternate response path exists.", "anonymous_user")],
        requiredNodeKinds: ["guardrail", "llm"],
        manipulatedKind: "guardrail",
      },
    ],
    moderation_integrity: [
      {
        suffix: "moderation_bypass",
        category: "moderation_bypass",
        title: "Moderation bypass",
        description: "Moderation stage skipped on assistant output path.",
        capability: "anonymous_user",
        blueprint: [
          { nodeKind: "llm", actionKind: "bypass_filter", actionLabel: "Policy-violating completion", capability: "anonymous_user" },
          { nodeKind: "moderation", actionKind: "bypass_filter", actionLabel: "Moderation not invoked", capability: "anonymous_user" },
          { nodeKind: "invariant_violation", actionKind: "chain_step", actionLabel: "Moderation integrity violated", capability: "anonymous_user", marksViolation: true },
        ],
        expectedImpact: "Harmful content passes moderation.",
        runtimeStrategy: "mock_moderation_skip",
        mitigation: "moderation_required_gate",
        assumptions: [assumption("Attacker can use code path without moderation.", "anonymous_user")],
        requiredNodeKinds: ["moderation", "llm"],
        manipulatedKind: "moderation",
      },
    ],
    streaming_integrity: [
      {
        suffix: "streaming_manipulation",
        category: "streaming_manipulation",
        title: "Streaming manipulation",
        description: "Streamed tokens bypass moderation/guardrail ordering.",
        capability: "anonymous_user",
        blueprint: [
          { nodeKind: "llm", actionKind: "bypass_filter", actionLabel: "Stream begins before filters armed", capability: "anonymous_user" },
          { nodeKind: "response", actionKind: "manipulate_context", actionLabel: "Partial stream reaches client", capability: "anonymous_user" },
          { nodeKind: "invariant_violation", actionKind: "chain_step", actionLabel: "Streaming integrity violated", capability: "anonymous_user", marksViolation: true },
        ],
        expectedImpact: "Unsafe partial output exposed via streaming.",
        runtimeStrategy: "mock_stream_before_filter",
        mitigation: "stream_buffer_and_filter",
        assumptions: [assumption("Client consumes stream before validation completes.", "anonymous_user")],
        requiredNodeKinds: ["response", "llm"],
        manipulatedKind: "response",
      },
    ],
    privilege_separation: [
      {
        suffix: "privilege_escalation",
        category: "privilege_escalation",
        title: "AI privilege escalation",
        description: "LLM inference privileges used to reach tool or external API privileges.",
        capability: "organization_admin",
        blueprint: [
          { nodeKind: "user_prompt", actionKind: "inject_prompt", actionLabel: "Escalation-oriented prompt", capability: "organization_admin" },
          { nodeKind: "llm", actionKind: "invoke_tool", actionLabel: "Model bridges to elevated tool", capability: "organization_admin" },
          { nodeKind: "external_api", actionKind: "cross_boundary", actionLabel: "External API reached with elevated scope", capability: "organization_admin" },
          { nodeKind: "invariant_violation", actionKind: "chain_step", actionLabel: "Privilege separation violated", capability: "organization_admin", marksViolation: true },
        ],
        expectedImpact: "Tool/API executed with higher privilege than user.",
        runtimeStrategy: "mock_privilege_bridge",
        mitigation: "capability_based_tool_auth",
        assumptions: [assumption("Tool auth incorrectly inherits model session.", "organization_admin")],
        requiredNodeKinds: ["llm", "tool"],
        manipulatedKind: "multi",
      },
    ],
    external_api_trust: [
      {
        suffix: "external_api_abuse",
        category: "external_api_trust_abuse",
        title: "External API trust abuse",
        description: "Untrusted external API response trusted inside model zone.",
        capability: "external_api_manipulator",
        blueprint: [
          { nodeKind: "external_api", actionKind: "inject_tool_result", actionLabel: "Malicious API response", capability: "external_api_manipulator" },
          { nodeKind: "tool", actionKind: "inject_tool_result", actionLabel: "Tool forwards untrusted payload", capability: "external_api_manipulator" },
          { nodeKind: "llm", actionKind: "manipulate_context", actionLabel: "Model trusts external data", capability: "external_api_manipulator" },
          { nodeKind: "invariant_violation", actionKind: "chain_step", actionLabel: "External API trust violated", capability: "external_api_manipulator", marksViolation: true },
        ],
        expectedImpact: "Downstream actions based on forged external data.",
        runtimeStrategy: "mock_malicious_api_response",
        mitigation: "external_response_validation",
        assumptions: [assumption("Attacker controls external API behavior.", "external_api_manipulator")],
        requiredNodeKinds: ["external_api", "tool", "llm"],
        manipulatedKind: "external_api",
      },
    ],
    mcp_isolation: [
      {
        suffix: "mcp_prompt_injection",
        category: "mcp_prompt_injection",
        title: "MCP prompt injection",
        description: "User-influenced content reaches MCP server prompt surface.",
        capability: "compromised_mcp_server",
        blueprint: [
          { nodeKind: "user_prompt", actionKind: "inject_prompt", actionLabel: "User payload routed toward MCP", capability: "anonymous_user" },
          { nodeKind: "mcp_client", actionKind: "cross_boundary", actionLabel: "Client forwards prompt to server", capability: "compromised_mcp_server" },
          { nodeKind: "mcp_server", actionKind: "inject_prompt", actionLabel: "Server executes injected instructions", capability: "compromised_mcp_server" },
          { nodeKind: "invariant_violation", actionKind: "chain_step", actionLabel: "MCP isolation violated", capability: "compromised_mcp_server", marksViolation: true },
        ],
        expectedImpact: "MCP server actions hijacked via prompt channel.",
        runtimeStrategy: "mock_mcp_prompt_forward",
        mitigation: "mcp_prompt_isolation",
        assumptions: [assumption("MCP bridges user content to server context.", "compromised_mcp_server")],
        requiredNodeKinds: [...mcp],
        manipulatedKind: "mcp_server",
      },
      {
        suffix: "mcp_tool_abuse",
        category: "mcp_tool_abuse",
        title: "MCP tool abuse",
        description: "MCP tool invoked with excessive scope from model path.",
        capability: "compromised_mcp_server",
        blueprint: [
          { nodeKind: "llm", actionKind: "invoke_tool", actionLabel: "Model selects MCP tool", capability: "authenticated_user" },
          { nodeKind: "mcp_client", actionKind: "invoke_tool", actionLabel: "Client calls server tool", capability: "compromised_mcp_server" },
          { nodeKind: "mcp_server", actionKind: "invoke_tool", actionLabel: "Server executes sensitive tool", capability: "compromised_mcp_server" },
          { nodeKind: "invariant_violation", actionKind: "chain_step", actionLabel: "MCP isolation violated", capability: "compromised_mcp_server", marksViolation: true },
        ],
        expectedImpact: "MCP tool used outside intended trust zone.",
        runtimeStrategy: "mock_mcp_tool_scope_abuse",
        mitigation: "mcp_tool_allowlist",
        assumptions: [assumption("MCP server exposes powerful tools.", "compromised_mcp_server")],
        requiredNodeKinds: [...mcp, "llm"],
        manipulatedKind: "mcp_server",
      },
      {
        suffix: "mcp_boundary_violation",
        category: "mcp_trust_boundary_violation",
        title: "MCP trust boundary violation",
        description: "Direct user influence crosses MCP trust isolation boundary.",
        capability: "compromised_mcp_server",
        blueprint: [
          { nodeKind: "user_prompt", actionKind: "cross_boundary", actionLabel: "User content enters MCP zone", capability: "anonymous_user" },
          { nodeKind: "mcp_server", actionKind: "cross_boundary", actionLabel: "Server trusts user-origin input", capability: "compromised_mcp_server" },
          { nodeKind: "invariant_violation", actionKind: "chain_step", actionLabel: "MCP isolation violated", capability: "compromised_mcp_server", marksViolation: true },
        ],
        expectedImpact: "MCP trust zone collapses with user prompt zone.",
        runtimeStrategy: "mock_mcp_boundary_cross",
        mitigation: "mcp_trust_zone_separation",
        assumptions: [assumption("MCP server lacks input isolation.", "compromised_mcp_server")],
        requiredNodeKinds: [...mcp],
        manipulatedKind: "mcp_client",
      },
    ],
    agent_isolation: [
      {
        suffix: "agent_impersonation",
        category: "agent_impersonation",
        title: "Agent impersonation",
        description: "Attacker masquerades as privileged agent in orchestration graph.",
        capability: "compromised_agent",
        blueprint: [
          { nodeKind: "user_prompt", actionKind: "inject_prompt", actionLabel: "Prompt claims agent identity", capability: "compromised_agent" },
          { nodeKind: "agent", actionKind: "delegate_agent", actionLabel: "Orchestrator accepts forged agent", capability: "compromised_agent" },
          { nodeKind: "invariant_violation", actionKind: "chain_step", actionLabel: "Agent isolation violated", capability: "compromised_agent", marksViolation: true },
        ],
        expectedImpact: "Untrusted party gains agent-level privileges.",
        runtimeStrategy: "mock_agent_identity_spoof",
        mitigation: "agent_authentication",
        assumptions: [assumption("Agent roles not cryptographically bound.", "compromised_agent")],
        requiredNodeKinds: [...agent],
        manipulatedKind: "agent",
      },
    ],
    sub_agent_isolation: [
      {
        suffix: "sub_agent_manipulation",
        category: "sub_agent_manipulation",
        title: "Sub-agent manipulation",
        description: "Worker/sub-agent receives attacker-controlled delegation payload.",
        capability: "compromised_agent",
        blueprint: [
          { nodeKind: "agent", actionKind: "delegate_agent", actionLabel: "Orchestrator delegates malicious task", capability: "compromised_agent" },
          { nodeKind: "agent", actionKind: "manipulate_context", actionLabel: "Worker agent executes untrusted work", capability: "compromised_agent" },
          { nodeKind: "invariant_violation", actionKind: "chain_step", actionLabel: "Sub-agent isolation violated", capability: "compromised_agent", marksViolation: true },
        ],
        expectedImpact: "Isolated worker performs out-of-scope actions.",
        runtimeStrategy: "mock_subagent_task_injection",
        mitigation: "delegation_scope_limits",
        assumptions: [assumption("Attacker controls delegation message.", "compromised_agent")],
        requiredNodeKinds: ["agent", "llm"],
        manipulatedKind: "agent",
      },
    ],
    agent_delegation: [
      {
        suffix: "delegation_abuse",
        category: "agent_delegation_abuse",
        title: "Agent delegation abuse",
        description: "Delegation chain used to reach tools or models outside approved scope.",
        capability: "compromised_agent",
        blueprint: [
          { nodeKind: "agent", actionKind: "delegate_agent", actionLabel: "Over-broad delegation issued", capability: "compromised_agent" },
          { nodeKind: "tool", actionKind: "invoke_tool", actionLabel: "Delegated agent invokes restricted tool", capability: "compromised_agent" },
          { nodeKind: "invariant_violation", actionKind: "chain_step", actionLabel: "Agent delegation invariant violated", capability: "compromised_agent", marksViolation: true },
        ],
        expectedImpact: "Delegation used as privilege amplification.",
        runtimeStrategy: "mock_delegation_tool_reach",
        mitigation: "delegation_capability_tokens",
        assumptions: [assumption("Delegation lacks tool scope limits.", "compromised_agent")],
        requiredNodeKinds: ["agent", "tool"],
        manipulatedKind: "agent",
      },
    ],
    multi_agent_coordination: [
      {
        suffix: "coordination_manipulation",
        category: "agent_coordination_manipulation",
        title: "Agent coordination manipulation",
        description: "Attacker reorders or confuses multi-agent coordination graph.",
        capability: "compromised_agent",
        blueprint: [
          { nodeKind: "agent", actionKind: "delegate_agent", actionLabel: "Coordination order manipulated", capability: "compromised_agent" },
          { nodeKind: "llm", actionKind: "chain_step", actionLabel: "Wrong agent model invoked", capability: "compromised_agent" },
          { nodeKind: "invariant_violation", actionKind: "chain_step", actionLabel: "Multi-agent coordination violated", capability: "compromised_agent", marksViolation: true },
        ],
        expectedImpact: "Orchestration integrity lost across agents.",
        runtimeStrategy: "mock_coordination_reorder",
        mitigation: "coordination_graph_validation",
        assumptions: [assumption("Attacker influences agent routing.", "compromised_agent")],
        requiredNodeKinds: ["agent", "llm"],
        manipulatedKind: "agent",
      },
      {
        suffix: "agent_loop",
        category: "agent_loop_creation",
        title: "Agent loop creation",
        description: "Delegation cycle causes unbounded agent loop.",
        capability: "compromised_agent",
        blueprint: [
          { nodeKind: "agent", actionKind: "delegate_agent", actionLabel: "Agent A delegates to B", capability: "compromised_agent" },
          { nodeKind: "agent", actionKind: "delegate_agent", actionLabel: "Agent B delegates back to A", capability: "compromised_agent" },
          { nodeKind: "invariant_violation", actionKind: "chain_step", actionLabel: "Multi-agent coordination violated", capability: "compromised_agent", marksViolation: true },
        ],
        expectedImpact: "Resource exhaustion or unbounded autonomous loop.",
        runtimeStrategy: "mock_agent_delegation_cycle",
        mitigation: "delegation_depth_limits",
        assumptions: [assumption("No cycle detection on agent graph.", "compromised_agent")],
        requiredNodeKinds: ["agent"],
        manipulatedKind: "agent",
      },
    ],
  };

  return map[category] ?? [];
}

function strategyForCategory(category: AIInvariantCategory): AIAttackStrategy {
  return {
    id: `core-invariant-${category}`,
    invariantCategories: [category],
    generate(ctx) {
      const templates = templatesForCategory(category);
      const cases: AIAttackCase[] = [];
      for (const template of templates) {
        const c = baseAttack(ctx, template);
        if (c) cases.push(c);
      }
      return cases;
    },
  };
}

const ALL_CATEGORIES: AIInvariantCategory[] = [
  "prompt_integrity",
  "instruction_integrity",
  "instruction_priority",
  "system_prompt_integrity",
  "developer_prompt_integrity",
  "conversation_isolation",
  "conversation_continuity",
  "tool_authorization",
  "tool_isolation",
  "tool_parameter_integrity",
  "tool_result_validation",
  "retrieval_integrity",
  "retrieval_authenticity",
  "knowledge_trust",
  "memory_isolation",
  "memory_freshness",
  "memory_ownership",
  "embedding_integrity",
  "context_integrity",
  "output_validation",
  "output_filtering",
  "guardrail_integrity",
  "moderation_integrity",
  "privilege_separation",
  "trust_boundary_preservation",
  "agent_isolation",
  "sub_agent_isolation",
  "agent_delegation",
  "mcp_isolation",
  "function_call_integrity",
  "external_api_trust",
  "streaming_integrity",
  "multi_agent_coordination",
];

export const defaultAiAttackStrategies: AIAttackStrategy[] = ALL_CATEGORIES.map(strategyForCategory);

export const AIAttackStrategyRegistry = {
  defaultStrategies: defaultAiAttackStrategies,
};
