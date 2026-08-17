import type { PromptContentRule } from "./types";

function p(source: string, flags = "i"): RegExp {
  return new RegExp(source, flags);
}

export const PROMPT_CONTENT_RULES: PromptContentRule[] = [
  {
    id: "generic.prompt.security.ignore-previous-instructions",
    severity: "ERROR",
    category: "prompt-injection-jailbreak",
    message: "Prompt injection detected: instruction override attempt trying to bypass system instructions.",
    patterns: [
      p("ignore\\s+(all\\s+)?(previous|prior|above|earlier)\\s+(instructions?|prompts?|rules?|guidelines?)"),
      p("disregard\\s+(all\\s+)?(previous|prior|above)\\s+(instructions?|prompts?)"),
      p("forget\\s+(all\\s+)?(previous|prior|earlier)\\s+(instructions?|prompts?)"),
    ],
    confidence: "HIGH",
    action: "BLOCK",
  },
  {
    id: "generic.prompt.security.new-instructions-injection",
    severity: "ERROR",
    category: "malicious-injection",
    message: "Prompt injection detected: attempt to inject new instructions replacing system behavior.",
    patterns: [
      p("your\\s+new\\s+(instructions?|task|role|purpose)\\s+(is|are)\\s*:"),
      p("from\\s+now\\s+on\\s*,?\\s+(you|your)\\s+(will|must|should|are)"),
      p("new\\s+system\\s+prompt\\s*:"),
    ],
    confidence: "HIGH",
    action: "BLOCK",
  },
  {
    id: "generic.prompt.security.jailbreak-dan",
    severity: "ERROR",
    category: "prompt-injection-jailbreak",
    message: "Jailbreak attempt detected: DAN-style attack attempting to bypass safety measures.",
    patterns: [p("you\\s+are\\s+(now\\s+)?DAN"), p("do\\s+anything\\s+now")],
    confidence: "HIGH",
    action: "BLOCK",
  },
  {
    id: "generic.prompt.security.system-prompt-extraction",
    severity: "ERROR",
    category: "prompt-injection-content",
    message: "System prompt extraction attempt detected.",
    patterns: [
      p("(reveal|show|display|print|output|repeat|tell\\s+me)\\s+(your|the)\\s+(system\\s+)?prompt"),
      p("what\\s+(is|are)\\s+your\\s+(system\\s+)?instructions?"),
    ],
    confidence: "MEDIUM",
    action: "WARN",
  },
  {
    id: "generic.prompt.security.delimiter-injection",
    severity: "ERROR",
    category: "prompt-injection-delimiter",
    message: "Delimiter injection attack: attempting to escape context boundaries.",
    patterns: [p("---+\\s*(system|assistant|user)\\s*---+"), p("<\\|.*\\|>")],
    confidence: "HIGH",
    action: "BLOCK",
  },
  {
    id: "generic.prompt.security.jailbreak-developer-mode",
    severity: "ERROR",
    category: "prompt-injection-jailbreak",
    message: "Developer/debug mode jailbreak: fake mode activation attempt.",
    patterns: [
      p("(enable|activate|enter|switch\\s+to)\\s+(developer|debug|admin|unrestricted)\\s+mode"),
      p("you\\s+(now\\s+)?have\\s+(no|zero)\\s+(restrictions|limitations|filters|guardrails)"),
    ],
    confidence: "HIGH",
    action: "BLOCK",
  },
  {
    id: "generic.prompt.security.natural-language-exfiltration",
    severity: "ERROR",
    category: "exfiltration",
    message: "Data exfiltration attempt in prompt-like text.",
    patterns: [
      p("send\\s+.{0,40}(secret|password|key|token|credential|env).{0,40}to\\s+\\S+"),
      p("(show|print|display|read|cat|output)\\s+(me\\s+)?(the\\s+)?(\\.env|env\\s+file|environment\\s+variable)"),
    ],
    confidence: "HIGH",
    action: "BLOCK",
  },
  {
    id: "generic.prompt.security.output-manipulation",
    severity: "ERROR",
    category: "prompt-injection-output",
    message: "Output manipulation attempt in prompt-like text.",
    patterns: [
      p("(start|begin)\\s+(your|every|all)\\s+(response|reply|output|answer)\\s+with"),
      p("(always|must|shall)\\s+(include|prepend|append|add).{0,30}(response|reply|output)"),
    ],
    confidence: "MEDIUM",
    action: "WARN",
  },
  {
    id: "agent.exfil.security.env-file-access",
    severity: "ERROR",
    category: "exfiltration",
    message: "Explicit request for .env or environment secrets in prompt-like text.",
    patterns: [
      p("(show|print|display|read|cat|output|echo)\\s+(me\\s+)?(the\\s+)?(\\.env|env\\s+file|environment\\s+variable)"),
      p("what\\s+(are|is)\\s+(in\\s+)?(the|my)\\s+\\.?env\\s+(file)?"),
    ],
    confidence: "HIGH",
    action: "BLOCK",
  },
];
