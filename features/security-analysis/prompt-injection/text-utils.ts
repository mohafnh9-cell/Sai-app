import { REGEX_SCAN_OVERLAP, REGEX_SCAN_WINDOW } from "./constants";

export function safeRegexMatch(text: string, regex: RegExp): RegExpMatchArray | null {
  if (text.length <= REGEX_SCAN_WINDOW) {
    return text.match(regex);
  }
  for (let offset = 0; offset < text.length; offset += REGEX_SCAN_WINDOW - REGEX_SCAN_OVERLAP) {
    const chunk = text.slice(offset, offset + REGEX_SCAN_WINDOW);
    const match = chunk.match(regex);
    if (match) return match;
  }
  return null;
}

export function lineNumberAt(content: string, index: number): number {
  return content.slice(0, index).split("\n").length;
}

export function extractStringLiterals(content: string): Array<{ text: string; line: number }> {
  const literals: Array<{ text: string; line: number }> = [];
  const patterns = [
    /`((?:[^`\\]|\\.)*)`/g,
    /"((?:[^"\\]|\\.)*)"/g,
    /'((?:[^'\\]|\\.)*)'/g,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const raw = match[0];
      const unquoted = raw.slice(1, -1);
      if (unquoted.trim().length < 8) continue;
      literals.push({
        text: unquoted,
        line: lineNumberAt(content, match.index),
      });
    }
  }

  return literals;
}

export function stripComments(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/#.*$/gm, " ");
}
