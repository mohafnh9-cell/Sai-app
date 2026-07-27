import { BaseAiSecuritySpecialist } from "./base-ai-specialist";

export class PromptSecuritySpecialist extends BaseAiSecuritySpecialist {
  readonly id = "ai.prompt_security";
  readonly name = "Prompt Security Specialist";
  readonly version = "1.0.0";
  readonly priority = 10;
  readonly supportedComponents = ["llm_provider", "ai_sdk"] as const;
  readonly supportedInvariantCategories = [
    "prompt_integrity",
    "instruction_integrity",
    "instruction_priority",
    "conversation_isolation",
    "context_integrity",
    "trust_boundary_preservation",
  ] as const;
  readonly supportedAttackCategories = [
    "prompt_injection",
    "indirect_prompt_injection",
    "instruction_override",
    "instruction_shadowing",
    "cross_conversation_injection",
    "conversation_hijacking",
    "context_manipulation",
    "context_overflow",
    "context_truncation",
    "multi_step_ai_attack_chains",
  ] as const;
  readonly supportedProviders = ["provider_agnostic"] as const;
  readonly supportedArchitectures = ["chat", "agents"] as const;
  protected intentPrefix = "Prompt security validation";
  protected riskScope = "prompt_and_instruction_trust";
  protected requireGraphNodes = ["user_prompt", "llm"];
  protected defaultAssumptions = [
    "Attacker can submit user-visible chat content.",
    "Prompt hierarchy is enforced only at application/runtime layer (not verified live in Slice 5).",
  ];
}

export class SystemPromptSpecialist extends BaseAiSecuritySpecialist {
  readonly id = "ai.system_prompt";
  readonly name = "System Prompt Specialist";
  readonly version = "1.0.0";
  readonly priority = 20;
  readonly supportedComponents = ["llm_provider", "ai_sdk"] as const;
  readonly supportedInvariantCategories = [
    "system_prompt_integrity",
    "developer_prompt_integrity",
    "instruction_priority",
    "instruction_integrity",
  ] as const;
  readonly supportedAttackCategories = [
    "system_prompt_extraction",
    "developer_prompt_extraction",
    "instruction_override",
    "instruction_shadowing",
  ] as const;
  readonly supportedProviders = ["provider_agnostic"] as const;
  readonly supportedArchitectures = ["chat"] as const;
  protected intentPrefix = "System prompt validation";
  protected riskScope = "privileged_instruction_exposure";
  protected requireGraphNodes = ["system_prompt"];
  protected defaultAssumptions = [
    "System and developer prompts contain sensitive policy text.",
    "Role hierarchy is modeled in the execution graph.",
  ];
}

export class ToolSecuritySpecialist extends BaseAiSecuritySpecialist {
  readonly id = "ai.tool_security";
  readonly name = "Tool Security Specialist";
  readonly version = "1.0.0";
  readonly priority = 30;
  readonly supportedComponents = ["tool_registry", "ai_sdk", "llm_provider"] as const;
  readonly supportedInvariantCategories = [
    "tool_authorization",
    "tool_isolation",
    "tool_parameter_integrity",
    "tool_result_validation",
    "function_call_integrity",
    "external_api_trust",
    "privilege_separation",
  ] as const;
  readonly supportedAttackCategories = [
    "tool_abuse",
    "unauthorized_tool_invocation",
    "parameter_injection",
    "tool_result_injection",
    "function_call_manipulation",
    "external_api_trust_abuse",
    "privilege_escalation",
  ] as const;
  readonly supportedProviders = ["provider_agnostic"] as const;
  readonly supportedArchitectures = ["tools", "chat"] as const;
  protected intentPrefix = "Tool security validation";
  protected riskScope = "tool_and_function_trust";
  protected requireGraphNodes = ["tool", "llm"];
  protected defaultAssumptions = [
    "Tool permissions are declared in application code.",
    "Tool results are consumed by the model without live validation in Slice 5.",
  ];
}

export class MemorySecuritySpecialist extends BaseAiSecuritySpecialist {
  readonly id = "ai.memory_security";
  readonly name = "Memory Security Specialist";
  readonly version = "1.0.0";
  readonly priority = 40;
  readonly supportedComponents = ["memory_store", "ai_sdk"] as const;
  readonly supportedInvariantCategories = [
    "memory_isolation",
    "memory_ownership",
    "memory_freshness",
    "conversation_continuity",
    "conversation_isolation",
  ] as const;
  readonly supportedAttackCategories = [
    "memory_poisoning",
    "memory_leakage",
    "memory_cross_tenant_access",
    "memory_replay",
    "conversation_hijacking",
  ] as const;
  readonly supportedProviders = ["provider_agnostic"] as const;
  readonly supportedArchitectures = ["memory_persistence", "chat"] as const;
  protected intentPrefix = "Memory security validation";
  protected riskScope = "conversation_memory_trust";
  protected requireGraphNodes = ["memory"];
  protected defaultAssumptions = [
    "Memory persistence is modeled on the canonical response path.",
    "Tenant/session scoping is application-defined.",
  ];
}

export class RagSecuritySpecialist extends BaseAiSecuritySpecialist {
  readonly id = "ai.rag_security";
  readonly name = "RAG Security Specialist";
  readonly version = "1.0.0";
  readonly priority = 50;
  readonly supportedComponents = ["vector_store", "knowledge_base", "embedding_model"] as const;
  readonly supportedInvariantCategories = [
    "retrieval_integrity",
    "retrieval_authenticity",
    "knowledge_trust",
    "embedding_integrity",
    "context_integrity",
  ] as const;
  readonly supportedAttackCategories = [
    "rag_poisoning",
    "retrieved_context_manipulation",
    "embedding_poisoning",
    "vector_store_poisoning",
    "indirect_prompt_injection",
    "context_manipulation",
  ] as const;
  readonly supportedProviders = ["provider_agnostic"] as const;
  readonly supportedArchitectures = ["rag"] as const;
  protected intentPrefix = "RAG security validation";
  protected riskScope = "retrieval_and_knowledge_trust";
  protected requireGraphNodes = ["retrieved_context"];
  protected defaultAssumptions = [
    "Knowledge sources are writable by some tenant-controlled actors.",
    "Retrieval path is represented in the execution graph.",
  ];
}

export class McpSecuritySpecialist extends BaseAiSecuritySpecialist {
  readonly id = "ai.mcp_security";
  readonly name = "MCP Security Specialist";
  readonly version = "1.0.0";
  readonly priority = 60;
  readonly supportedComponents = ["mcp_server", "mcp_client"] as const;
  readonly supportedInvariantCategories = ["mcp_isolation", "tool_authorization", "tool_isolation"] as const;
  readonly supportedAttackCategories = [
    "mcp_prompt_injection",
    "mcp_tool_abuse",
    "mcp_trust_boundary_violation",
  ] as const;
  readonly supportedProviders = ["provider_agnostic"] as const;
  readonly supportedArchitectures = ["mcp", "tools"] as const;
  protected intentPrefix = "MCP security validation";
  protected riskScope = "mcp_protocol_trust";
  protected requireGraphNodes = ["mcp_server"];
  protected defaultAssumptions = [
    "MCP client bridges model tool selection to server tools.",
    "MCP servers are reachable from the modeled application path.",
  ];
}

export class AgentSecuritySpecialist extends BaseAiSecuritySpecialist {
  readonly id = "ai.agent_security";
  readonly name = "Agent Security Specialist";
  readonly version = "1.0.0";
  readonly priority = 70;
  readonly supportedComponents = ["agent_framework", "ai_sdk", "orchestration"] as const;
  readonly supportedInvariantCategories = [
    "agent_isolation",
    "sub_agent_isolation",
    "agent_delegation",
    "multi_agent_coordination",
    "privilege_separation",
  ] as const;
  readonly supportedAttackCategories = [
    "agent_impersonation",
    "sub_agent_manipulation",
    "agent_delegation_abuse",
    "agent_loop_creation",
    "agent_coordination_manipulation",
  ] as const;
  readonly supportedProviders = ["provider_agnostic"] as const;
  readonly supportedArchitectures = ["agents"] as const;
  protected intentPrefix = "Agent security validation";
  protected riskScope = "multi_agent_orchestration";
  protected requireGraphNodes = ["agent"];
  protected defaultAssumptions = [
    "Agent delegation is modeled in the execution graph.",
    "Agent identity is not cryptographically verified in Slice 5 planning.",
  ];
}

export class GuardrailSpecialist extends BaseAiSecuritySpecialist {
  readonly id = "ai.guardrail";
  readonly name = "Guardrail Specialist";
  readonly version = "1.0.0";
  readonly priority = 80;
  readonly supportedComponents = ["llm_provider", "ai_sdk"] as const;
  readonly supportedInvariantCategories = [
    "output_validation",
    "output_filtering",
    "guardrail_integrity",
    "moderation_integrity",
    "streaming_integrity",
  ] as const;
  readonly supportedAttackCategories = [
    "guardrail_bypass",
    "moderation_bypass",
    "output_manipulation",
    "streaming_manipulation",
  ] as const;
  readonly supportedProviders = ["provider_agnostic"] as const;
  readonly supportedArchitectures = ["chat", "streaming"] as const;
  protected intentPrefix = "Guardrail validation";
  protected riskScope = "output_safety_pipeline";
  protected requireGraphNodes = ["moderation", "guardrail"];
  protected defaultAssumptions = [
    "Moderation and guardrail nodes reflect production output path.",
    "Streaming path shares the same policy chain as buffered responses.",
  ];
}

export function createDefaultAiSecuritySpecialists() {
  return [
    new PromptSecuritySpecialist(),
    new SystemPromptSpecialist(),
    new ToolSecuritySpecialist(),
    new MemorySecuritySpecialist(),
    new RagSecuritySpecialist(),
    new McpSecuritySpecialist(),
    new AgentSecuritySpecialist(),
    new GuardrailSpecialist(),
  ];
}
