/**
 * Outbound message adapter for WeChat KF
 *
 * accountId = openKfId (dynamically discovered)
 */

import { sendTextMessage, sendImageMessage, uploadMedia, sendFileMessage, sendVoiceMessage, sendVideoMessage } from "./api.js";
import { resolveAccount } from "./accounts.js";
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { markdownToUnicode } from "./unicode-format.js";

/** Map file extension to WeChat media type */
function detectMediaType(ext: string): "image" | "voice" | "video" | "file" {
  ext = ext.toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"].includes(ext)) return "image";
  if ([".amr", ".mp3", ".wav", ".ogg", ".silk", ".m4a", ".aac"].includes(ext)) return "voice";
  if ([".mp4", ".avi", ".mov", ".mkv", ".wmv"].includes(ext)) return "video";
  return "file";
}

export const wechatKfOutbound = {
  deliveryMode: "direct" as const,
  textChunkLimit: 2000,

  sendText: async ({ cfg, to, text, accountId }: any) => {
    const account = resolveAccount(cfg, accountId);
    const openKfId = account.openKfId ?? accountId;
    if (!account.corpId || !account.appSecret || !openKfId) {
      throw new Error("[wechat-kf] missing corpId/appSecret/openKfId");
    }
    const externalUserId = String(to).replace(/^user:/, "");
    const formatted = markdownToUnicode(text);
    const result = await sendTextMessage(account.corpId, account.appSecret, externalUserId, openKfId, formatted);
    return { channel: "wechat-kf", messageId: result.msgid, chatId: to };
  },

  sendMedia: async ({ cfg, to, text, mediaUrl, mediaPath, accountId, ...rest }: any) => {
    const account = resolveAccount(cfg, accountId);
    const openKfId = account.openKfId ?? accountId;
    if (!account.corpId || !account.appSecret || !openKfId) {
      throw new Error("[wechat-kf] missing corpId/appSecret/openKfId");
    }
    
    const externalUserId = String(to).replace(/^user:/, "");
    const resolvedPath = mediaPath || mediaUrl;
    
    if (resolvedPath && !resolvedPath.startsWith('http')) {
      const buffer = await readFile(resolvedPath);
      const ext = extname(resolvedPath).toLowerCase();
      const mediaType = detectMediaType(ext);
      const filename = basename(resolvedPath);
      
      const uploadResponse = await uploadMedia(account.corpId, account.appSecret, mediaType, buffer, filename);
      const mid = uploadResponse.media_id;
      
      let result: any;
      switch (mediaType) {
        case "image":
          result = await sendImageMessage(account.corpId, account.appSecret, externalUserId, openKfId, mid);
          break;
        case "voice":
          result = await sendVoiceMessage(account.corpId, account.appSecret, externalUserId, openKfId, mid);
          break;
        case "video":
          result = await sendVideoMessage(account.corpId, account.appSecret, externalUserId, openKfId, mid);
          break;
        case "file":
        default:
          result = await sendFileMessage(account.corpId, account.appSecret, externalUserId, openKfId, mid);
          break;
      }
      
      if (text?.trim()) {
        await sendTextMessage(account.corpId, account.appSecret, externalUserId, openKfId, text);
      }
      
      return { channel: "wechat-kf", messageId: result.msgid, chatId: to };
    }
    
    // Fallback: send as text with URL/path
    const content = text?.trim()
      ? `${text}\n📎 ${mediaUrl || mediaPath || ""}`
      : mediaUrl ? `📎 ${mediaUrl}` : mediaPath ? `📎 ${mediaPath}` : text ?? "";
    const result = await sendTextMessage(account.corpId, account.appSecret, externalUserId, openKfId, content);
    return { channel: "wechat-kf", messageId: result.msgid, chatId: to };
  },
};
