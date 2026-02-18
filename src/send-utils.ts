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

import { markdownToUnicode } from "./unicode-format.js";
import {
  uploadMedia,
  sendImageMessage,
  sendVoiceMessage,
  sendVideoMessage,
  sendFileMessage,
} from "./api.js";

/** Markdown to Unicode text formatting (shared by both outbound paths) */
export function formatText(text: string): string {
  return markdownToUnicode(text);
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
