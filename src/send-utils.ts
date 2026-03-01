/**
 * Shared outbound utilities for WeChat KF
 *
 * Extracted helpers used by both outbound paths:
 *   - outbound.ts      (framework-driven direct delivery)
 *   - reply-dispatcher.ts (typing-aware streaming replies)
 *
 * Centralises Markdown formatting, media-type detection, and the
 * upload-then-send media workflow so changes only need to happen once.
 */

import { basename, extname } from "node:path";
import { sendFileMessage, sendImageMessage, sendVideoMessage, sendVoiceMessage, uploadMedia } from "./api.js";
import { logTag, MEDIA_DOWNLOAD_TIMEOUT_MS } from "./constants.js";
import { getRuntime } from "./runtime.js";
import { markdownToUnicode } from "./unicode-format.js";

/** Calculate the UTF-8 byte length of a single code point. */
function utf8ByteLengthOfCodePoint(cp: number): number {
  if (cp <= 0x7f) return 1;
  if (cp <= 0x7ff) return 2;
  if (cp <= 0xffff) return 3;
  return 4;
}

/**
 * Split text into chunks that each fit within `byteLimit` UTF-8 bytes.
 *
 * Iterates by code point (safe for surrogate pairs / emoji) and prefers
 * breaking at newline or space boundaries.  When no natural break point
 * exists the chunk is split at the byte-limit boundary (still on a code
 * point edge, never mid-surrogate).
 */
export function chunkTextByUtf8Bytes(text: string, byteLimit: number): string[] {
  if (byteLimit <= 0) return [];
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];

  const chunks: string[] = [];
  let chunkStart = 0; // index into `trimmed` (UTF-16 offset)
  let byteCount = 0;
  let lastBreak = -1; // UTF-16 index of last space/newline *start*
  let i = 0;

  for (const char of trimmed) {
    const cp = char.codePointAt(0)!;
    const cpBytes = utf8ByteLengthOfCodePoint(cp);

    if (byteCount + cpBytes > byteLimit) {
      // Need to flush a chunk
      if (lastBreak > chunkStart) {
        // Break at the last whitespace
        const chunk = trimmed.slice(chunkStart, lastBreak).trimEnd();
        if (chunk) chunks.push(chunk);
        chunkStart = lastBreak;
        // Skip leading whitespace after break
        while (chunkStart < trimmed.length && (trimmed[chunkStart] === " " || trimmed[chunkStart] === "\n")) {
          chunkStart++;
        }
        // Recalculate byteCount from chunkStart to i
        byteCount = 0;
        for (const c of trimmed.slice(chunkStart, i)) {
          byteCount += utf8ByteLengthOfCodePoint(c.codePointAt(0)!);
        }
        lastBreak = -1;
      } else {
        // No break point — hard cut at current position
        const chunk = trimmed.slice(chunkStart, i).trimEnd();
        if (chunk) chunks.push(chunk);
        chunkStart = i;
        byteCount = 0;
        lastBreak = -1;
      }
    }

    // Track break points
    if (char === "\n" || char === " ") {
      lastBreak = i;
    }

    byteCount += cpBytes;
    i += char.length; // 1 for BMP, 2 for supplementary
  }

  // Flush remaining
  if (chunkStart < trimmed.length) {
    const chunk = trimmed.slice(chunkStart).trim();
    if (chunk) chunks.push(chunk);
  }

  return chunks;
}

/** Markdown to Unicode text formatting (shared by both outbound paths) */
export function formatText(text: string): string {
  return markdownToUnicode(text);
}

const CONTENT_TYPE_EXT_MAP: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/bmp": ".bmp",
  "audio/amr": ".amr",
  "audio/mpeg": ".mp3",
  "audio/ogg": ".ogg",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "video/mp4": ".mp4",
  "application/pdf": ".pdf",
};

export function contentTypeToExt(contentType: string): string {
  return CONTENT_TYPE_EXT_MAP[contentType] ?? "";
}

/** Detect image MIME type from magic bytes (file header) */
export function detectImageMime(buffer: Buffer): string | null {
  if (buffer.length < 4) return null;
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return "image/gif";
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "image/png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return "image/jpeg";
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) return "image/bmp";
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString() === "RIFF" &&
    buffer.subarray(8, 12).toString() === "WEBP"
  )
    return "image/webp";
  return null;
}

/** Map framework MediaKind to WeChat media type */
export function mediaKindToWechatType(kind: string): "image" | "voice" | "video" | "file" {
  switch (kind) {
    case "image":
      return "image";
    case "audio":
      return "voice";
    case "video":
      return "video";
    default:
      return "file"; // "document" | "unknown"
  }
}

/** Map file extension to WeChat media type */
export function detectMediaType(ext: string): "image" | "voice" | "video" | "file" {
  ext = ext.toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"].includes(ext)) return "image";
  if (ext === ".amr") return "voice";
  if ([".mp4", ".avi", ".mov", ".mkv", ".wmv"].includes(ext)) return "video";
  return "file";
}

/** Upload media to WeChat and send via the appropriate message type */
export async function uploadAndSendMedia(
  corpId: string,
  appSecret: string,
  toUser: string,
  openKfId: string,
  buffer: Buffer,
  filename: string,
  mediaType: "image" | "voice" | "video" | "file",
): Promise<{ msgid: string }> {
  const uploaded = await uploadMedia(corpId, appSecret, mediaType, buffer, filename);
  const mid = uploaded.media_id;
  switch (mediaType) {
    case "image":
      return sendImageMessage(corpId, appSecret, toUser, openKfId, mid);
    case "voice":
      return sendVoiceMessage(corpId, appSecret, toUser, openKfId, mid);
    case "video":
      return sendVideoMessage(corpId, appSecret, toUser, openKfId, mid);
    default:
      return sendFileMessage(corpId, appSecret, toUser, openKfId, mid);
  }
}

/**
 * Download media from an HTTP/HTTPS URL and return the buffer + filename.
 *
 * WeChat does not accept external URLs directly — media must be uploaded to
 * the temporary media store first.  This helper fetches the remote resource
 * so the caller can then pass the buffer through `uploadAndSendMedia`.
 */
export async function downloadMediaFromUrl(url: string): Promise<{ buffer: Buffer; filename: string; ext: string }> {
  const resp = await fetch(url, {
    signal: AbortSignal.timeout(MEDIA_DOWNLOAD_TIMEOUT_MS),
  });
  if (!resp.ok) {
    throw new Error(`${logTag()} failed to download media: HTTP ${resp.status} from ${url}`);
  }
  const buffer = Buffer.from(await resp.arrayBuffer());
  const urlPath = new URL(resp.url ?? url).pathname;
  let filename = basename(urlPath) || "download";
  let ext = extname(filename);

  // Fall back to Content-Type when URL has no extension
  if (!ext) {
    const ct = resp.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    ext = contentTypeToExt(ct);
    if (ext) filename = `${filename}${ext}`;
  }

  return { buffer, filename, ext };
}

function isMediaSource(value: string): boolean {
  return /^(https?:\/\/|file:\/\/|data:|[~/])/.test(value);
}

/**
 * Resolve a thumbnail reference to a WeChat thumb_media_id.
 *
 * Accepts three kinds of input:
 *   - URL (http://, https://) or local path (/, ~, file://, data:) → loadWebMedia + uploadMedia
 *   - media_id string (anything else) → used directly
 */
export async function resolveThumbMediaId(thumbRef: string, corpId: string, appSecret: string): Promise<string> {
  if (isMediaSource(thumbRef)) {
    const core = getRuntime();
    const loaded = await core.media.loadWebMedia(thumbRef, { optimizeImages: false });
    const uploaded = await uploadMedia(corpId, appSecret, "image", loaded.buffer, loaded.fileName ?? "thumb.jpg");
    return uploaded.media_id;
  }
  // Treat as raw media_id
  return thumbRef;
}
