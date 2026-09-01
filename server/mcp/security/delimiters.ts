export const UNTRUSTED_DATA_START = "<<<SEQURAI_UNTRUSTED_REPOSITORY_DATA";
export const UNTRUSTED_DATA_END = "<<<END_SEQURAI_UNTRUSTED_REPOSITORY_DATA>>>";

export type UntrustedContentSource =
  | "repository_file"
  | "dependency_metadata"
  | "commit_history"
  | "finding_field";

// M5 (audit): the delimiter strings are static and, before this fix, were
// never escaped out of attacker-controlled content -- a scanned file could
// contain a literal "<<<END_SEQURAI_UNTRUSTED_REPOSITORY_DATA>>>" and
// prematurely close the trusted boundary, letting whatever text follows it
// in the same file be read as if it were outside the untrusted block.
// Break up any occurrence of either marker inside the content itself with
// a zero-width space before wrapping, so the real markers we add below
// remain the only literal matches in the final prompt.
const ZERO_WIDTH_SPACE = "​";

/** Breaks up a marker's exact literal text (a zero-width space spliced
 * after the first character) so it no longer matches as a substring, while
 * remaining visually identical to a human or a model reading the text. */
function breakMarker(marker: string): string {
  return `${marker.slice(0, 1)}${ZERO_WIDTH_SPACE}${marker.slice(1)}`;
}

function neutralizeDelimiterLookalikes(content: string): string {
  return content
    .split(UNTRUSTED_DATA_START)
    .join(breakMarker(UNTRUSTED_DATA_START))
    .split(UNTRUSTED_DATA_END)
    .join(breakMarker(UNTRUSTED_DATA_END));
}

export function wrapUntrustedRepositoryData(
  content: string,
  options: { source: UntrustedContentSource; path?: string | null }
): string {
  const pathAttr = options.path
    ? ` path="${options.path.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
    : "";
  const safeContent = neutralizeDelimiterLookalikes(content);
  return `${UNTRUSTED_DATA_START} source="${options.source}"${pathAttr}>>>\n${safeContent}\n${UNTRUSTED_DATA_END}`;
}

export function containsUntrustedDelimiter(content: string): boolean {
  return content.includes(UNTRUSTED_DATA_START) || content.includes(UNTRUSTED_DATA_END);
}

/** Split prompt text into regions outside delimited repository-data blocks. */
export function extractBarePromptRegions(prompt: string): string[] {
  if (!containsUntrustedDelimiter(prompt)) {
    return [prompt];
  }

  const regions: string[] = [];
  let cursor = 0;
  while (cursor < prompt.length) {
    const start = prompt.indexOf(UNTRUSTED_DATA_START, cursor);
    if (start === -1) {
      regions.push(prompt.slice(cursor));
      break;
    }
    if (start > cursor) {
      regions.push(prompt.slice(cursor, start));
    }
    const end = prompt.indexOf(UNTRUSTED_DATA_END, start);
    if (end === -1) {
      regions.push(prompt.slice(start));
      break;
    }
    cursor = end + UNTRUSTED_DATA_END.length;
  }
  return regions.filter((region) => region.trim().length > 0);
}
