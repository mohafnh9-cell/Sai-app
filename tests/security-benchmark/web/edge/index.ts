import type { BenchmarkCase } from "../../types";

/**
 * DISCOVERED FALSE POSITIVE (benchmark section 11 workflow): the
 * web.next-xss pattern for dangerouslySetInnerHTML is
 *   /dangerouslySetInnerHTML\s*=\s*\{\s*\{\s*__html\s*:\s*(?!DOMPurify|sanitize)/
 * The intent is "don't flag __html when the value is DOMPurify-sanitized",
 * but the negative lookahead sits after a greedy `\s*`, which backtracks:
 * with any whitespace between the colon and `DOMPurify`/`sanitize` (e.g.
 * the idiomatic `__html: DOMPurify.sanitize(x)`, one space after the
 * colon), the regex engine finds a zero-whitespace position for `\s*`
 * where the lookahead trivially succeeds (the next literal character is a
 * space, not "D"/"s"), so the rule fires anyway. Verified directly:
 *   /dangerouslySetInnerHTML\s*=\s*\{\s*\{\s*__html\s*:\s*(?!DOMPurify|sanitize)/
 *     .test('dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(x) }}')
 *   // => true (should be false)
 * Recorded as a permanent negative fixture per the false-positive
 * workflow; `excludedReason` keeps it out of the hard regression gate
 * until the pattern itself is fixed in a follow-up rule change (out of
 * scope for this benchmark-construction pass -- see BLIND_SPOTS.md).
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
    excludedReason:
      "Known false positive: the rule's DOMPurify/sanitize exclusion lookahead is defeated by whitespace backtracking (see file docblock). Currently DOES flag this safe code.",
    description: "dangerouslySetInnerHTML content is passed through DOMPurify.sanitize() with the idiomatic single space after the colon.",
    files: [{ path: "components/Preview.tsx", content: "return <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(userHtml) }} />" }],
  },
];
