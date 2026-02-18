/**
 * Markdown → Unicode text formatting
 *
 * Converts markdown bold/italic/bold-italic to Unicode Mathematical
 * Alphanumeric Symbols. Only converts ASCII letters (a-z, A-Z) and
 * digits (0-9) — other characters pass through unchanged.
 *
 * This is meant for plain-text surfaces like WeChat KF where
 * rich text / HTML isn't supported.
 */

// Unicode Mathematical Alphanumeric offsets for A-Z, a-z
// Bold: U+1D400 (A) / U+1D41A (a)
// Italic: U+1D434 (A) / U+1D44E (a)
// Bold Italic: U+1D468 (A) / U+1D482 (a)
// Bold digits: U+1D7CE (0)

const BOLD_UPPER_START = 0x1d400;
const BOLD_LOWER_START = 0x1d41a;
const BOLD_DIGIT_START = 0x1d7ce;

const ITALIC_UPPER_START = 0x1d434;
const ITALIC_LOWER_START = 0x1d44e;
// Italic has no digit variant — use normal digits

const BOLD_ITALIC_UPPER_START = 0x1d468;
const BOLD_ITALIC_LOWER_START = 0x1d482;

function mapChar(
  ch: string,
  upperStart: number,
  lowerStart: number,
  digitStart?: number,
): string {
  const code = ch.charCodeAt(0);
  if (code >= 65 && code <= 90) {
    // A-Z
    return String.fromCodePoint(upperStart + (code - 65));
  }
  if (code >= 97 && code <= 122) {
    // a-z
    return String.fromCodePoint(lowerStart + (code - 97));
  }
  if (digitStart !== undefined && code >= 48 && code <= 57) {
    // 0-9
    return String.fromCodePoint(digitStart + (code - 48));
  }
  return ch;
}

function toBold(text: string): string {
  return [...text]
    .map((ch) => mapChar(ch, BOLD_UPPER_START, BOLD_LOWER_START, BOLD_DIGIT_START))
    .join("");
}

function toItalic(text: string): string {
  return [...text]
    .map((ch) => {
      // Special case: italic lowercase 'h' is U+210E (ℎ) not in the block
      if (ch === "h") return "\u210E";
      return mapChar(ch, ITALIC_UPPER_START, ITALIC_LOWER_START);
    })
    .join("");
}

function toBoldItalic(text: string): string {
  return [...text]
    .map((ch) => mapChar(ch, BOLD_ITALIC_UPPER_START, BOLD_ITALIC_LOWER_START))
    .join("");
}

/**
 * Convert markdown formatting to Unicode styled text.
 *
 * Handles:
 * - `***text***` or `___text___` → bold italic
 * - `**text**` or `__text__` → bold
 * - `*text*` or `_text_` → italic
 * - `` `code` `` → left as-is (backtick preserved)
 * - ``` code blocks ``` → left as-is
 * - `# headings` → 𝗛𝗲𝗮𝗱𝗶𝗻𝗴 (bold, # stripped)
 * - `- list items` / `* list items` → • item
 * - `1. numbered` → 1. (kept)
 * - `[text](url)` → text (url)
 * - `~~strikethrough~~` → stripped markers (no unicode strikethrough that's reliable)
 */
export function markdownToUnicode(text: string): string {
  if (!text) return text;

  // 1. Preserve code blocks
  const codeBlocks: string[] = [];
  let result = text.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match.replace(/^```\w*\n?/, "").replace(/\n?```$/, ""));
    return `\x00CB${codeBlocks.length - 1}\x00`;
  });

  // 2. Preserve inline code
  const inlineCodes: string[] = [];
  result = result.replace(/`([^`\n]+)`/g, (_match, code) => {
    inlineCodes.push(code);
    return `\x00IC${inlineCodes.length - 1}\x00`;
  });

  // 3. Images: ![alt](url) → [alt](url)  (must come before link handling)
  result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "[$1]($2)");

  // 4. Escape characters: protect \* \_ \~ \` \# \[ \] \( \) \\ \- \!
  const escapes: string[] = [];
  result = result.replace(/\\([*_~`#\[\]()\\!-])/g, (_m, ch) => {
    escapes.push(ch);
    return `\x00ES${escapes.length - 1}\x00`;
  });

  // 5. Links: [text](url) → text (url)
  result = result.replace(/\[([^\]]*)\]\(([^)]+)\)/g, "$1 ($2)");

  // 6. Headings: # text → bold text (before bold/italic so inner markers are also bolded)
  result = result.replace(/^(#{1,6})\s+(.+)$/gm, (_m, _hashes, content) => {
    // Strip any inline bold/italic markers before applying bold
    const stripped = content
      .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1")
      .replace(/_{1,3}([^_]+)_{1,3}/g, "$1");
    return toBold(stripped);
  });

  // 7. Bold italic: ***text*** or ___text___ (multiline with [\s\S])
  result = result.replace(/\*{3}([\s\S]+?)\*{3}/g, (_m, inner) => toBoldItalic(inner));
  result = result.replace(/_{3}([\s\S]+?)_{3}/g, (_m, inner) => toBoldItalic(inner));

  // 8. Bold: **text** or __text__ (multiline with [\s\S])
  result = result.replace(/\*{2}([\s\S]+?)\*{2}/g, (_m, inner) => toBold(inner));
  result = result.replace(/_{2}([\s\S]+?)_{2}/g, (_m, inner) => toBold(inner));

  // 9. Italic: *text* or _text_ (but not inside words for _)
  // Use [^*\n] to avoid matching list markers like "* item *"
  result = result.replace(/(?<!\w)\*([^*\n]+?)\*(?!\w)/g, (_m, inner) => toItalic(inner));
  result = result.replace(/(?<!\w)_([^_\n]+?)_(?!\w)/g, (_m, inner) => toItalic(inner));

  // 10. Strikethrough: ~~text~~ → just remove markers
  result = result.replace(/~~([\s\S]+?)~~/g, "$1");

  // 11. Task lists (must come before unordered list handling)
  result = result.replace(/^([ \t]*)-\s+\[x\]\s+/gm, "$1\u2611 ");
  result = result.replace(/^([ \t]*)-\s+\[ \]\s+/gm, "$1\u2610 ");

  // 12. Unordered list: - item or * item → • item
  result = result.replace(/^[ \t]*[-*]\s+/gm, "• ");

  // 13. Blockquotes: > text → ┃ text
  result = result.replace(/^>\s?/gm, "┃ ");

  // 14. Horizontal rules
  result = result.replace(/^[-*_]{3,}$/gm, "─────────");

  // 15. Restore code blocks with visual markers
  result = result.replace(/\x00CB(\d+)\x00/g, (_m, idx) => {
    const code = codeBlocks[Number(idx)] ?? "";
    return `\n━━━ code ━━━\n${code}\n━━━━━━━━━━━━\n`;
  });

  // 16. Restore inline code with backtick markers
  result = result.replace(/\x00IC(\d+)\x00/g, (_m, idx) =>
    `\`${inlineCodes[Number(idx)] ?? ""}\``);

  // 17. Restore escape characters
  result = result.replace(/\x00ES(\d+)\x00/g, (_m, idx) => escapes[Number(idx)] ?? "");

  return result;
}
