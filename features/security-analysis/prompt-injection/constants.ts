export const PROMPT_INJECTION_RULE_ID = "prompt-injection.security";
export const PROMPT_INJECTION_SOURCE_TOOL = "scan_agent_prompt" as const;

export const PROMPT_SKIP_DIR_SEGMENTS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "__pycache__",
  "venv",
  ".venv",
  "coverage",
  ".next",
  ".nuxt",
]);

export const PROMPT_SCANNABLE_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".py",
  ".md",
  ".mdx",
]);

export const LLM_INTEGRATION_INDICATORS = [
  /generateText\s*\(/,
  /streamText\s*\(/,
  /embed(?:Many)?\s*\(/,
  /openai\.chat\.completions\.create/,
  /client\.chat\.completions\.create/,
  /anthropic\.messages\.create/,
  /client\.messages\.create/,
  /new\s+Anthropic\s*\(/,
  /PromptTemplate/,
  /ChatPromptTemplate/,
  /from\s+['"]ai['"]/,
  /from\s+['"]@ai-sdk/,
  /from\s+['"]openai['"]/,
  /from\s+['"]@anthropic-ai\/sdk['"]/,
  /systemPrompt|system_prompt|userPrompt|userMessage/,
  /messages\s*:\s*\[/,
  /role\s*:\s*['"](?:system|user|assistant)['"]/,
] as const;

export const UNTRUSTED_INPUT_INDICATORS =
  /\$\{(?:request|req|body|input|user|message|prompt|query|params|data)|\b(?:req|request)\.(?:body|query|params)|\buser(?:Input|Message|Prompt|Text)\b|\bbody\.|\binput\b|\bmessage\b|\bprompt\b/i;

export const REGEX_SCAN_WINDOW = 2048;
export const REGEX_SCAN_OVERLAP = 256;

export const PROMPT_CATEGORY_REMEDIATION: Record<string, string> = {
  "prompt-injection":
    "Validate and sanitize all user-controlled content before inserting it into LLM prompts. Prefer structured message arrays with fixed system instructions.",
  "prompt-injection-output":
    "Never execute or deserialize raw LLM output. Parse structured data safely and treat model output as untrusted.",
  exfiltration:
    "Block instructions that request secrets or code be sent externally. Keep sensitive data out of prompt construction paths.",
  "prompt-injection-jailbreak":
    "Review prompt templates for override language and keep system instructions immutable.",
  "prompt-injection-content":
    "Treat matched text as suspicious until verified in runtime context. Do not assume a string match is exploitable without data-flow verification.",
  "malicious-injection":
    "Remove override or bypass language from prompts exposed to untrusted input.",
  "system-manipulation":
    "Keep system instructions separate from user-controlled content and validate all dynamic prompt segments.",
  obfuscation:
    "Inspect encoded or obfuscated prompt segments before passing them to an LLM.",
};
