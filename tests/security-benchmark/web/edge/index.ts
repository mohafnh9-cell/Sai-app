import type { BenchmarkCase } from "../../types";

/**
 * FIXED in the Detection Accuracy Hardening V1 pass (was a confirmed
 * false positive in V1/V2 of this benchmark): the web.next-xss pattern
 * for dangerouslySetInnerHTML was
 *   /dangerouslySetInnerHTML\s*=\s*\{\s*\{\s*__html\s*:\s*(?!DOMPurify|sanitize)/
 * The intent is "don't flag __html when the value is DOMPurify-sanitized",
 * but the negative lookahead sat after a greedy `\s*`, which backtracks:
 * with any whitespace between the colon and `DOMPurify`/`sanitize` (e.g.
 * the idiomatic `__html: DOMPurify.sanitize(x)`, one space after the
 * colon), the regex engine could find a zero-whitespace position for
 * `\s*` where the lookahead trivially succeeded (the next literal
 * character was a space, not "D"/"s"), so the rule fired anyway.
 * Fixed (features/security-scanner/rules/builtin.ts) by moving the
 * whitespace-absorption inside the lookahead itself:
 * `(?!\s*(?:DOMPurify|sanitize))`, so it always sees the real next token
 * regardless of how the outer `\s*` backtracks. This fixture -- and its
 * sibling below for the parallel `.innerHTML = ` pattern, which had the
 * identical bug -- now pass as genuine TN and are kept in the hard
 * regression gate to protect the fix permanently.
 */
export const WEB_EDGE_CASES: BenchmarkCase[] = [
  {
    id: "web.next-xss-edge-dompurify-sanitized-01",
    ruleId: "web.next-xss",
    expected: "no_detect",
    category: "web",
    language: "typescript",
    framework: "react",
    kind: "edge",
    source: "benchmark-new",
    description: "dangerouslySetInnerHTML content is passed through DOMPurify.sanitize() with the idiomatic single space after the colon.",
    files: [{ path: "components/Preview.tsx", content: "return <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(userHtml) }} />" }],
  },
  {
    id: "web.next-xss-edge-innerhtml-sanitized-01",
    ruleId: "web.next-xss",
    expected: "no_detect",
    category: "web",
    language: "typescript",
    kind: "edge",
    source: "benchmark-new",
    description: "el.innerHTML assignment is passed through DOMPurify.sanitize() with a space after '=' -- the sibling pattern to the dangerouslySetInnerHTML case above, same bug class, same fix.",
    files: [{ path: "server/render.ts", content: "el.innerHTML = DOMPurify.sanitize(userHtml);" }],
  },
  {
    id: "web.next-xss-edge-incomplete-sanitizer-name-01",
    ruleId: "web.next-xss",
    expected: "detect",
    category: "web",
    language: "typescript",
    framework: "react",
    kind: "edge",
    source: "benchmark-new",
    description: "Edge case for the fix: a function that merely LOOKS like a sanitizer ('maybeSanitize') but is not the recognized DOMPurify/sanitize call must still be flagged -- the fix must not overreach into excluding arbitrary function names.",
    files: [{ path: "components/Preview.tsx", content: "return <div dangerouslySetInnerHTML={{ __html: maybeSanitize(userHtml) }} />" }],
  },
];
