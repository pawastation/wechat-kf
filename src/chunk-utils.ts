/**
 * Text chunking utilities for WeChat KF message splitting.
 *
 * Splits long text into chunks that fit within the WeChat character limit,
 * preferring natural boundaries (newlines, then whitespace) before hard-cutting.
 */

/**
 * Split `text` into chunks of at most `limit` characters.
 *
 * Strategy (per chunk):
 *  1. If remaining text fits within `limit`, emit it as the final chunk.
 *  2. Look for the last newline (`\n`) within the first `limit` characters.
 *  3. Failing that, look for the last whitespace character.
 *  4. Failing that, hard-cut at exactly `limit` characters.
 *
 * Chunks are trimmed; empty chunks are never returned.
 */
export function chunkText(text: string, limit: number): string[] {
  if (limit <= 0) return [];
  if (text.length <= limit) {
    const trimmed = text.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      const trimmed = remaining.trim();
      if (trimmed.length > 0) {
        chunks.push(trimmed);
      }
      break;
    }

    const window = remaining.slice(0, limit);

    // Try to split at the last newline within the window
    let splitIdx = window.lastIndexOf("\n");

    // Fall back to last whitespace
    if (splitIdx <= 0) {
      splitIdx = window.lastIndexOf(" ");
    }
    if (splitIdx <= 0) {
      splitIdx = window.lastIndexOf("\t");
    }

    // Hard-cut if no suitable boundary found
    if (splitIdx <= 0) {
      splitIdx = limit;
    }

    const chunk = remaining.slice(0, splitIdx).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    // Advance past the split point (skip the delimiter character when splitting on boundary)
    remaining = remaining.slice(splitIdx).trimStart();
  }

  return chunks;
}
