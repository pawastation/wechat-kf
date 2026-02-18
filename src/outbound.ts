/**
 * Outbound message adapter for WeChat KF  (framework-driven direct delivery)
 *
 * Responsibility:
 *   This module implements the OpenClaw `ChannelPlugin.outbound` interface and
 *   is called by the framework when the agent produces a final reply.
 *
 *   Text chunking is handled by the framework itself via the declared `chunker`
 *   function (P0-01), so `sendText` always receives a single pre-chunked piece.
 *
 *   For media, the file is read from disk, classified, uploaded to WeChat, and
 *   sent using the shared `uploadAndSendMedia` helper from `send-utils.ts`.
 *
 * Counterpart:
 *   `reply-dispatcher.ts` handles the *other* outbound path: typing-aware
 *   streaming replies dispatched internally by `bot.ts`.
 *
 * accountId = openKfId (dynamically discovered)
 */

import { sendTextMessage } from "./api.js";
import { resolveAccount } from "./accounts.js";
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { formatText, detectMediaType, uploadAndSendMedia } from "./send-utils.js";
import { chunkText } from "./chunk-utils.js";
import { WECHAT_TEXT_CHUNK_LIMIT } from "./constants.js";
import type { OpenClawConfig } from "./types.js";

export type SendTextParams = {
  cfg: OpenClawConfig;
  to: string;
  text: string;
  accountId: string;
};

export type SendMediaParams = {
  cfg: OpenClawConfig;
  to: string;
  text?: string;
  mediaUrl?: string;
  mediaPath?: string;
  accountId: string;
};

export type SendResult = {
  channel: string;
  messageId: string;
  chatId: string;
};

export const wechatKfOutbound = {
  deliveryMode: "direct" as const,
  chunker: (text: string, limit: number): string[] => chunkText(text, limit),
  chunkerMode: "text" as const,
  textChunkLimit: WECHAT_TEXT_CHUNK_LIMIT,

  sendText: async ({ cfg, to, text, accountId }: SendTextParams): Promise<SendResult> => {
    const account = resolveAccount(cfg, accountId);
    const openKfId = account.openKfId ?? accountId;
    if (!account.corpId || !account.appSecret || !openKfId) {
      throw new Error("[wechat-kf] missing corpId/appSecret/openKfId");
    }
    const externalUserId = String(to).replace(/^user:/, "");
    const formatted = formatText(text);
    const result = await sendTextMessage(account.corpId, account.appSecret, externalUserId, openKfId, formatted);
    return { channel: "wechat-kf", messageId: result.msgid, chatId: to };
  },

  sendMedia: async ({ cfg, to, text, mediaUrl, mediaPath, accountId }: SendMediaParams): Promise<SendResult> => {
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

      const result = await uploadAndSendMedia(
        account.corpId, account.appSecret, externalUserId, openKfId,
        buffer, filename, mediaType,
      );

      if (text?.trim()) {
        await sendTextMessage(account.corpId, account.appSecret, externalUserId, openKfId, formatText(text));
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
