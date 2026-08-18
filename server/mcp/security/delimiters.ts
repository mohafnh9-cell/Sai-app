export const UNTRUSTED_DATA_START = "<<<SEQURAI_UNTRUSTED_REPOSITORY_DATA";
export const UNTRUSTED_DATA_END = "<<<END_SEQURAI_UNTRUSTED_REPOSITORY_DATA>>>";

export type UntrustedContentSource =
  | "repository_file"
  | "dependency_metadata"
  | "commit_history"
  | "finding_field";

export function wrapUntrustedRepositoryData(
  content: string,
  options: { source: UntrustedContentSource; path?: string | null }
): string {
  const pathAttr = options.path
    ? ` path="${options.path.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
    : "";
  return `${UNTRUSTED_DATA_START} source="${options.source}"${pathAttr}>>>\n${content}\n${UNTRUSTED_DATA_END}`;
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
