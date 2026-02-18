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
import { MEDIA_DOWNLOAD_TIMEOUT_MS } from "./constants.js";
import { markdownToUnicode } from "./unicode-format.js";

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

function contentTypeToExt(contentType: string): string {
  return CONTENT_TYPE_EXT_MAP[contentType] ?? "";
}

/** Map file extension to WeChat media type */
export function detectMediaType(ext: string): "image" | "voice" | "video" | "file" {
  ext = ext.toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"].includes(ext)) return "image";
  if ([".amr", ".mp3", ".wav", ".ogg", ".silk", ".m4a", ".aac"].includes(ext)) return "voice";
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
    throw new Error(`[wechat-kf] failed to download media: HTTP ${resp.status} from ${url}`);
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
