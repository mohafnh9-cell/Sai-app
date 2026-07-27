export type NormalizedAiProviderFamily =
  | "openai"
  | "anthropic"
  | "google_gemini"
  | "groq"
  | "mistral"
  | "meta_llama"
  | "llama_cpp"
  | "vercel_ai_sdk"
  | "langchain"
  | "llamaindex"
  | "crewai"
  | "autogen"
  | "openrouter"
  | "mcp"
  | "generic"
  | "unknown";

const PROVIDER_PATTERNS: Array<{ family: NormalizedAiProviderFamily; pattern: RegExp }> = [
  { family: "openai", pattern: /openai|gpt-4|gpt-3|chatgpt|o1-|o3-/i },
  { family: "anthropic", pattern: /anthropic|claude/i },
  { family: "google_gemini", pattern: /gemini|google ai|generativeai|vertex ai/i },
  { family: "groq", pattern: /\bgroq\b/i },
  { family: "mistral", pattern: /mistral/i },
  { family: "meta_llama", pattern: /\bllama\b|meta ai/i },
  { family: "llama_cpp", pattern: /llama\.cpp|llamacpp/i },
  { family: "vercel_ai_sdk", pattern: /vercel ai sdk|@ai-sdk|ai sdk/i },
  { family: "langchain", pattern: /langchain|langgraph/i },
  { family: "llamaindex", pattern: /llamaindex|llama-index/i },
  { family: "crewai", pattern: /crewai|crew ai/i },
  { family: "autogen", pattern: /autogen|ag2/i },
  { family: "openrouter", pattern: /openrouter/i },
  { family: "mcp", pattern: /\bmcp\b|model context protocol/i },
];

export function inferProviderFamily(raw: string): NormalizedAiProviderFamily {
  for (const { family, pattern } of PROVIDER_PATTERNS) {
    if (pattern.test(raw)) return family;
  }
  return raw.trim() ? "generic" : "unknown";
}

export function normalizeProviderLabel(family: NormalizedAiProviderFamily): string {
  switch (family) {
    case "google_gemini":
      return "Google Gemini";
    case "meta_llama":
      return "Meta Llama";
    case "llama_cpp":
      return "Llama.cpp";
    case "vercel_ai_sdk":
      return "Vercel AI SDK";
    default:
      return family.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

export function isKnownProviderFamily(family: string): family is NormalizedAiProviderFamily {
  return (
    family === "openai" ||
    family === "anthropic" ||
    family === "google_gemini" ||
    family === "groq" ||
    family === "mistral" ||
    family === "meta_llama" ||
    family === "llama_cpp" ||
    family === "vercel_ai_sdk" ||
    family === "langchain" ||
    family === "llamaindex" ||
    family === "crewai" ||
    family === "autogen" ||
    family === "openrouter" ||
    family === "mcp" ||
    family === "generic" ||
    family === "unknown"
  );
}
