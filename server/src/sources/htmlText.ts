const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  rsquo: "'",
  lsquo: "'",
  rdquo: '"',
  ldquo: '"',
  ndash: "-",
  mdash: "-",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const codePoint = code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

const BLOCK_TAG_PATTERN = /<\/?(p|div|li|ul|ol|h[1-6]|br)[^>]*>/gi;

// Greenhouse's content field is HTML whose tags are themselves entity-escaped
// (a stored description literally contains the four characters "&lt;div..."
// rather than "<div..." -- confirmed against real fetched data, not assumed).
// One decode pass reveals the real markup; block tags become newlines so
// paragraph/list-item boundaries survive into the plain text (the
// classifier depends on this to tell a "required" section from a
// "preferred" one); a second decode pass cleans up entities that were part
// of the actual readable text, not the markup.
export function htmlToText(html: string | null): string {
  if (!html) return "";
  const revealed = decodeEntities(html);
  const withBreaks = revealed.replace(BLOCK_TAG_PATTERN, "\n");
  const stripped = withBreaks.replace(/<[^>]+>/g, " ");
  return decodeEntities(stripped)
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}
