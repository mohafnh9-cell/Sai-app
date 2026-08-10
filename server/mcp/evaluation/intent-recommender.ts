import type { McpCanonicalIntent } from "../intent-model";
import { INTENT_SIGNAL_DICTIONARY } from "../intent-model";

export type IntentRecommendation =
  | { action: "tool"; tools: string[] }
  | { action: "clarify"; reason: string }
  | { action: "none"; reason: string };

export type EvalPhrase = {
  id: string;
  phrase: string;
  locale: "en" | "es";
  expected: IntentRecommendation;
  tags?: string[];
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function containsAny(haystack: string, needles: readonly string[]): number {
  let score = 0;
  for (const needle of needles) {
    if (haystack.includes(needle.toLowerCase())) score += 1;
  }
  return score;
}

const INTENT_TO_TOOL: Record<McpCanonicalIntent, string> = {
  FULL_PRODUCT_AUDIT: "full_product_audit",
  REVIEW_NOW: "review_now",
  CAN_I_DEPLOY: "can_i_deploy",
  SAFE_FIX: "safe_fix",
  WHAT_CHANGED: "what_changed",
  PRODUCTION_HISTORY: "production_history",
};

const NO_TOOL_PATTERNS: RegExp[] = [
  /^(thank you|thanks!?|hello|hi cursor|gracias|hola)\.?$/,
  /^what is sequrai\??$/,
  /^qu[eé] es sequrai\??$/,
  /^who are you\??$/,
  /\b(write|escr[ií]beme).*(poem|poema)\b/,
  /\b(explain|expl[ií]came).*(react hooks|hooks de react)\b/,
  /\b(format|formatea).*(json)\b/,
  /\brefactor(iza| my component|iza mi componente)\b/,
  /\b(open the settings|create a new workspace|crea un workspace)\b/,
];

const WEAK_SIGNAL_PATTERNS: RegExp[] = [
  /\bi('m| am) done\b/,
  /\bi think it'?s ready\b/,
  /\bi('m| am) going to publish\b/,
  /\bi just finished\.?$/,
  /\bya termin[eé]\.?$/,
  /\bcreo que est[aá] listo\b/,
  /\bvoy a publicar\b/,
  /\bacabo de terminar\.?$/,
  /\bmaybe ship today\b/,
  /\btal vez hago deploy hoy\b/,
  /\balmost there\b/,
  /\bcasi listo\b/,
  /\bwhat do you think\b/,
  /\bqu[eé] opinas\b/,
  /\bready when you are\b/,
  /\blisto cuando quieras\b/,
  /\bi might deploy later\b/,
  /\bquiz[aá] despliegue luego\b/,
  /\bfinished the feature\b/,
  /\btermin[eé] la feature\b/,
  /\bgood to go\??$/,
  /\btodo bien\??$/,
  /\bship it maybe\b/,
  /\blo subo\??$/,
  /\bdone for today\b/,
];

const COMPOUND_PATTERNS: Array<{ pattern: RegExp; tools: string[] }> = [
  {
    pattern:
      /\b(review|scan|analy|revis|escane|analiz|run a review|haz una review).*(can i deploy|whether i can deploy|si puedo desplegar|puedo desplegar|can i ship|production ready|listo para producci[oó]n|can i deploy\?)\b/,
    tools: ["review_now", "can_i_deploy"],
  },
  {
    pattern:
      /\b(can i deploy|should i deploy|puedo desplegar|deber[ií]a desplegar).*(if not|si no|y si no|c[oó]mo lo arreglo|how.*fix|safe fix|arregl)\b/,
    tools: ["can_i_deploy", "safe_fix"],
  },
  {
    pattern:
      /\b(scan|escanea).*(latest commit|[uú]ltimo commit).*(then|y luego|and then|luego).*(ship|deploy|desplegar|puedo hacer ship)\b/,
    tools: ["review_now", "can_i_deploy"],
  },
  {
    pattern:
      /\b(what changed|qu[eé] cambi[oó]|what did i break|qu[eé] romp[ií]).*(fix|arregl|main problem|problema principal|top issue|top blocker|bloqueador)\b/,
    tools: ["what_changed", "safe_fix"],
  },
  {
    pattern:
      /\b(check latest work|review and fix|revisa y arregla).*(blocker|bloqueador|fix|arregl)\b/,
    tools: ["review_now", "safe_fix"],
  },
  {
    pattern: /\bdeploy readiness.*safe fix\b/,
    tools: ["can_i_deploy", "safe_fix"],
  },
];

const STRONG_SINGLE_RULES: Array<{ pattern: RegExp; tool: string }> = [
  {
    pattern:
      /\b(audit my product|full audit|complete audit|security audit|find vulnerabilities|busca vulnerabilidades|audita mi producto|auditor[ií]a completa|revisa mi saas|analiza mi saas|analiza mi aplicaci[oó]n|revisa mi aplicaci[oó]n|haz una auditor[ií]a|run a full product audit|attack my application|ataca mi aplicaci[oó]n|prueba de seguridad|security test my app)\b/i,
    tool: "full_product_audit",
  },
  {
    pattern: /\b(verify the fix|review the fix|verifica el fix|revisa el fix)\b/i,
    tool: "review_now",
  },
  {
    pattern:
      /\b(fix this|prepare the safest fix|can you solve this|would you apply this|should i trust this fix|arregla esto|prepara el fix m[aá]s seguro|conf[ií]o en este fix)\b/i,
    tool: "safe_fix",
  },
  {
    pattern:
      /\b(show my monthly report|what improved this month|am i safer than before|how was my month|mu[eé]strame el reporte mensual|qu[eé] mejor[oó] este mes|c[oó]mo estuvo mi mes)\b/i,
    tool: "production_history",
  },
  // Compound-adjacent phrases that mention deploy but primary intent is diff/history/fix/review
  {
    pattern: /\b(primero|first|but first|pero primero).*(qu[eé] ha cambiado|what changed)\b/,
    tool: "what_changed",
  },
  {
    pattern:
      /\b(score baj[oó]|score dropped).*(no s[eé]|don't know|fui yo|was me|sequrai encontr[oó])\b/,
    tool: "what_changed",
  },
  {
    pattern:
      /\b(protect my application|protect my app|protege mi aplicaci[oó]n|protege mi app|start protecting|empezar a proteger)\b/,
    tool: "review_now",
  },
  {
    pattern:
      /\b(am i protected|are you protecting|am i safe in production|estoy protegido|me est[aá]s protegiendo|sigues protegiendo)\b/,
    tool: "can_i_deploy",
  },
  {
    pattern:
      /\b(what worries you|what worry you most|qu[eé] te preocupa|qu[eé] es lo que m[aá]s te preocupa)\b/,
    tool: "can_i_deploy",
  },
  {
    pattern:
      /\b(would you deploy if it was your company|would you ship if this was your company|if this were your company|si fuera tu empresa|desplegar[ií]as si fuera tu empresa|publicar[ií]as si fuera tu empresa)\b/,
    tool: "can_i_deploy",
  },
  {
    pattern:
      /\b(how healthy is my application|how healthy is my app|qu[eé] tan sana est[aá] mi app|salud de mi aplicaci[oó]n)\b/,
    tool: "production_history",
  },
  {
    pattern:
      /\b(review again|check again|revisa otra vez|revisa de nuevo|vuelve a revisar)\b/,
    tool: "review_now",
  },
  {
    pattern:
      /\b(fix this problem|fix the problem|arregla este problema|arreglar este problema)\b/,
    tool: "safe_fix",
  },
  {
    pattern:
      /\b(check whether it is safe to launch|safe to launch now|puedo lanzar ya|is it safe to go live)\b/,
    tool: "can_i_deploy",
  },
  {
    pattern:
      /\b(analyze everything before i deploy|check everything before i deploy|analiza todo antes de desplegar|comprueba todo antes de desplegar|escanea.*antes de desplegar)\b/,
    tool: "review_now",
  },
  {
    pattern:
      /\b(see whether i broke|mira si romp[ií]|antes de seguir.*revisa el [uú]ltimo commit)\b/,
    tool: "review_now",
  },
  {
    pattern:
      /\b(what changed\??|qu[eé] cambi[oó]\??|what did i break|qu[eé] romp[ií]|compare the last two reviews|compara las dos [uú]ltimas reviews|why did my score drop|por qu[eé] baj[oó] mi score|what regressed|what got resolved|qu[eé] se resolvi[oó]|what new blockers|qu[eé] empeor[oó]|what appeared in the latest review|qu[eé] apareci[oó] en la [uú]ltima review|what was fixed|qu[eé] se arregl[oó]|did i improve|mejor[eé]\??|diff between the last two)\b/,
    tool: "what_changed",
  },
  {
    pattern:
      /\b(how was my month|how was my week|show my monthly report|monthly report|my monthly report|what improved this month|am i safer than before|am i becoming more protected|summarize last month|informe mensual|reporte mensual|c[oó]mo estuvo mi mes|estoy m[aá]s seguro)\b/,
    tool: "production_history",
  },
  {
    pattern:
      /\b(how has this project evolved|show me the history|mu[eé]strame el historial|what was my best score|cu[aá]l fue mi mejor score|how many blockers have i resolved|cu[aá]ntos blockers he resuelto|how was the project last week|c[oó]mo estuvo el proyecto la semana pasada|show the last 30 days|muestra los [uú]ltimos 30 d[ií]as|production history|historial de producci[oó]n|score trend|tendencia del score|how many valid reviews|cu[aá]ntas reviews v[aá]lidas|project evolution|evoluci[oó]n del proyecto|my progress over|mi progreso en la [uú]ltima semana|historical production scores|am i improving|estoy mejorando)\b/,
    tool: "production_history",
  },
  {
    pattern:
      /\b(how do i fix|give me the cursor prompt|fix the main blocker|how can i solve this safely|generate the safest fix|help me fix|safe fix for|give me a fix prompt|how should i patch|show me how to resolve|i need the safe fix prompt|generate a cursor prompt for|tell me what to change to fix|c[oó]mo arreglo|dame el prompt de cursor|arregla el bloqueador|qu[eé] deber[ií]a cambiar|c[oó]mo lo soluciono|genera el fix|ay[uú]dame a arreglar|dame un prompt de fix|c[oó]mo parcheo|mu[eé]strame c[oó]mo resolver|necesito el safe fix prompt|dime qu[eé] cambiar para arreglar)\b/,
    tool: "safe_fix",
  },
  {
    pattern:
      /\b(should i worry|do i need to worry|should i be worried|is my application still protected|still protected|why did you email|why did sequrai email|did you alert me|that email from sequrai|deber[ií]a preocuparme|tengo que preocuparme|sigo protegido|por qu[eé] me escribiste|me alertaste)\b/,
    tool: "can_i_deploy",
  },
  {
    pattern: /\b(what happened|what happened\??|qu[eé] pas[oó]|qu[eé] pas[oó]\??)\b/,
    tool: "what_changed",
  },
  {
    pattern:
      /\b(what should i do next|qu[eé] hago ahora|what do i do now|next step|siguiente paso)\b/,
    tool: "can_i_deploy",
  },
  {
    pattern:
      /\b(review my project|check the latest commit|just finished coding.*scan|run sequrai|inspect my recent|verify the latest commit before launch|scan the repo|analyze my app|review my latest|production review on main|run a scan|analyze the project before|revisa mi proyecto|revisa el [uú]ltimo commit|acabo de terminar de codear|escan[eé]alo|inspecciona mis cambios|verifica el [uú]ltimo commit|escanea el repo|analiza la app|revisa mis [uú]ltimos|haz un scan|ejecuta sequrai)\b/,
    tool: "review_now",
  },
];

function detectCompoundSequence(text: string): string[] | null {
  for (const rule of COMPOUND_PATTERNS) {
    if (rule.pattern.test(text)) return rule.tools;
  }
  return null;
}

function detectStrongSingleTool(text: string): string | null {
  for (const rule of STRONG_SINGLE_RULES) {
    if (rule.pattern.test(text)) return rule.tool;
  }
  return null;
}

function intentScores(phrase: string): Record<McpCanonicalIntent, number> {
  const text = normalize(phrase);
  const deployQ =
    /\b(can i|should i|is this|would you|puedo|deber[ií]a|est[aá]|pueden)\b/.test(text) ? 2 : 0;
  const reviewCompute =
    /\b(review|scan|analy[sz]e|inspect|revis|escane|analiz|run sequrai|check.*(latest|recent|commit|before)|verify.*commit)\b/.test(
      text
    )
      ? 2
      : 0;
  const fixQ =
    /\b(how (do i|can i)|give me.*prompt|fix the|arregl|solucion|safe fix|blocker)\b/.test(text) ? 2 : 0;
  const changeQ =
    /\b(what changed|what did i break|why did.*score|compare.*review|qu[eé] cambi|qu[eé] romp|por qu[eé].*score|regressed|resolved)\b/.test(
      text
    )
      ? 2
      : 0;
  const historyQ =
    /\b(history|evolution|trend|last (week|month)|best score|progress|historial|evoluci|tendencia|[uú]ltima semana|mejor score|progreso|how healthy|app health|salud de mi)\b/.test(
      text
    )
      ? 2
      : 0;
  const protectQ =
    /\b(am i protected|what worries you|protegido|preocupa|protect my app|would you deploy if)\b/.test(
      text
    )
      ? 3
      : 0;

  const fullAuditQ =
    /\b(audit|auditor[ií]a|vulnerabilit|full audit|complete audit|security audit|pentest|pen test|audita|auditar)\b/.test(
      text
    )
      ? 3
      : 0;

  return {
    FULL_PRODUCT_AUDIT:
      fullAuditQ +
      containsAny(text, INTENT_SIGNAL_DICTIONARY.fullAudit) +
      (/\b(find vulnerabilities|busca vulnerabilidades|analiza mi saas|revisa mi aplicaci[oó]n)\b/.test(text)
        ? 3
        : 0),
    REVIEW_NOW:
      reviewCompute +
      containsAny(text, INTENT_SIGNAL_DICTIONARY.review) +
      (/\b(before i deploy|antes de desplegar|check everything|review again|revisa otra vez)\b/.test(text) ? 2 : 0) +
      (/\b(protect my application|protege mi aplicaci[oó]n)\b/.test(text) ? 2 : 0),
    CAN_I_DEPLOY:
      deployQ +
      protectQ +
      containsAny(text, INTENT_SIGNAL_DICTIONARY.deployment) +
      containsAny(text, INTENT_SIGNAL_DICTIONARY.protection) +
      containsAny(text, INTENT_SIGNAL_DICTIONARY.worries) +
      containsAny(text, INTENT_SIGNAL_DICTIONARY.company) +
      (/\b(ready|listo|production ready|usuarios reales|safe to launch)\b/.test(text) ? 1 : 0),
    SAFE_FIX: fixQ + containsAny(text, INTENT_SIGNAL_DICTIONARY.fix),
    WHAT_CHANGED: changeQ + containsAny(text, INTENT_SIGNAL_DICTIONARY.changes),
    PRODUCTION_HISTORY:
      historyQ +
      containsAny(text, INTENT_SIGNAL_DICTIONARY.history) +
      containsAny(text, INTENT_SIGNAL_DICTIONARY.health),
  };
}

/**
 * Evaluation-only recommender for intent dataset tests.
 * NOT used in executeMcpTool or production routing.
 */
export function recommendMcpToolsForPhrase(phrase: string): IntentRecommendation {
  const text = normalize(phrase);
  if (!text) return { action: "none", reason: "empty" };

  for (const pattern of NO_TOOL_PATTERNS) {
    if (pattern.test(text)) {
      return { action: "none", reason: "non_sequrai" };
    }
  }

  for (const pattern of WEAK_SIGNAL_PATTERNS) {
    if (pattern.test(text)) {
      return { action: "clarify", reason: "weak_intent" };
    }
  }

  const compound = detectCompoundSequence(text);
  if (compound) return { action: "tool", tools: compound };

  const strong = detectStrongSingleTool(text);
  if (strong) return { action: "tool", tools: [strong] };

  const scores = intentScores(text);
  const ranked = (Object.entries(scores) as [McpCanonicalIntent, number][])
    .sort((a, b) => b[1] - a[1])
    .filter(([, score]) => score > 0);

  if (!ranked.length) {
    return { action: "clarify", reason: "unknown_intent" };
  }

  const [topIntent, topScore] = ranked[0];
  const [, secondScore] = ranked[1] ?? [null, 0];

  if (topScore >= 2 && topScore > secondScore + 1) {
    return { action: "tool", tools: [INTENT_TO_TOOL[topIntent]] };
  }

  if (topScore >= 3) {
    return { action: "tool", tools: [INTENT_TO_TOOL[topIntent]] };
  }

  if (topScore === secondScore) {
    return { action: "clarify", reason: "ambiguous_intent" };
  }

  return { action: "tool", tools: [INTENT_TO_TOOL[topIntent]] };
}

export function recommendationsMatch(
  actual: IntentRecommendation,
  expected: IntentRecommendation
): boolean {
  if (actual.action !== expected.action) return false;
  if (actual.action === "tool" && expected.action === "tool") {
    return actual.tools.join(",") === expected.tools.join(",");
  }
  return true;
}

export function evaluateIntentDataset(phrases: EvalPhrase[]) {
  let correct = 0;
  const failures: Array<{ id: string; phrase: string; actual: IntentRecommendation }> = [];

  for (const item of phrases) {
    const actual = recommendMcpToolsForPhrase(item.phrase);
    if (recommendationsMatch(actual, item.expected)) {
      correct += 1;
    } else {
      failures.push({ id: item.id, phrase: item.phrase, actual });
    }
  }

  return {
    total: phrases.length,
    correct,
    accuracy: phrases.length ? correct / phrases.length : 0,
    failures,
  };
}

function firstToolAccuracy(phrases: EvalPhrase[]) {
  let correct = 0;
  for (const item of phrases) {
    if (item.expected.action !== "tool" || item.expected.tools.length !== 1) continue;
    const actual = recommendMcpToolsForPhrase(item.phrase);
    if (actual.action === "tool" && actual.tools[0] === item.expected.tools[0]) {
      correct += 1;
    }
  }
  const total = phrases.filter(
    (item) => item.expected.action === "tool" && item.expected.tools.length === 1
  ).length;
  return { total, correct, accuracy: total ? correct / total : 0 };
}

/** Evaluation metrics for docs and CI reporting — not production routing. */
export function summarizeIntentEvaluation(phrases: EvalPhrase[]) {
  const overall = evaluateIntentDataset(phrases);
  const clear = firstToolAccuracy(phrases);
  const compound = evaluateIntentDataset(phrases.filter((item) => item.id.startsWith("cmp-")));
  const ambiguous = evaluateIntentDataset(phrases.filter((item) => item.id.startsWith("amb-")));
  const negative = evaluateIntentDataset(phrases.filter((item) => item.id.startsWith("neg-")));
  const en = evaluateIntentDataset(phrases.filter((item) => item.locale === "en"));
  const es = evaluateIntentDataset(phrases.filter((item) => item.locale === "es"));

  return { overall, clear, compound, ambiguous, negative, en, es };
}
