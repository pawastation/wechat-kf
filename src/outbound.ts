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
 *   For media, the file is read from disk (or downloaded from HTTP URL),
 *   classified, uploaded to WeChat, and sent using the shared
 *   `uploadAndSendMedia` helper from `send-utils.ts`.
 *
 * WeChat KF session limits:
 *   The API enforces a 48-hour / 5-message limit per session window.
 *   Once a customer sends a message, the agent may reply with up to 5 messages
 *   within 48 hours.  After that, sending returns errcode 95026.
 *   This module detects that error and logs a clear warning rather than
 *   propagating a generic failure.
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
import { extname } from "node:path";
import { formatText, detectMediaType, uploadAndSendMedia, downloadMediaFromUrl } from "./send-utils.js";
import { chunkText } from "./chunk-utils.js";
import { WECHAT_TEXT_CHUNK_LIMIT, WECHAT_MSG_LIMIT_ERRCODE } from "./constants.js";
import type { OpenClawConfig } from "./types.js";

/**
 * Check whether an error indicates the WeChat 48h/5-message session limit.
 * When detected, logs a warning and returns true so the caller can handle
 * gracefully instead of throwing a generic error.
 */
function isSessionLimitError(err: unknown): boolean {
  if (err instanceof Error) {
    return err.message.includes(String(WECHAT_MSG_LIMIT_ERRCODE));
  }
  return false;
}

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
    try {
      const result = await sendTextMessage(account.corpId, account.appSecret, externalUserId, openKfId, formatted);
      return { channel: "wechat-kf", messageId: result.msgid, chatId: to };
    } catch (err) {
      if (isSessionLimitError(err)) {
        console.error(
          `[wechat-kf] session limit exceeded (48h/5-msg) for user=${externalUserId} kf=${openKfId}. ` +
          `The customer must send a new message before more replies can be delivered.`,
        );
      }
      throw err;
    }
  },

  sendMedia: async ({ cfg, to, text, mediaUrl, mediaPath, accountId }: SendMediaParams): Promise<SendResult> => {
    const account = resolveAccount(cfg, accountId);
    const openKfId = account.openKfId ?? accountId;
    if (!account.corpId || !account.appSecret || !openKfId) {
      throw new Error("[wechat-kf] missing corpId/appSecret/openKfId");
    }

    const externalUserId = String(to).replace(/^user:/, "");
    const resolvedPath = mediaPath || mediaUrl;

    // ── HTTP/HTTPS URL: download then upload ──
    if (resolvedPath?.startsWith("http")) {
      const downloaded = await downloadMediaFromUrl(resolvedPath);
      const ext = downloaded.ext.toLowerCase();
      const mediaType = detectMediaType(ext);

      try {
        const result = await uploadAndSendMedia(
          account.corpId, account.appSecret, externalUserId, openKfId,
          downloaded.buffer, downloaded.filename, mediaType,
        );

        if (text?.trim()) {
          await sendTextMessage(account.corpId, account.appSecret, externalUserId, openKfId, formatText(text));
        }

        return { channel: "wechat-kf", messageId: result.msgid, chatId: to };
      } catch (err) {
        if (isSessionLimitError(err)) {
          console.error(
            `[wechat-kf] session limit exceeded (48h/5-msg) for user=${externalUserId} kf=${openKfId}. ` +
            `The customer must send a new message before more replies can be delivered.`,
          );
        }
        throw err;
      }
    }

    // ── Local file path: read then upload ──
    if (resolvedPath) {
      const buffer = await readFile(resolvedPath);
      const ext = extname(resolvedPath).toLowerCase();
      const mediaType = detectMediaType(ext);
      const filename = resolvedPath.split("/").pop() || "file";

      try {
        const result = await uploadAndSendMedia(
          account.corpId, account.appSecret, externalUserId, openKfId,
          buffer, filename, mediaType,
        );

        if (text?.trim()) {
          await sendTextMessage(account.corpId, account.appSecret, externalUserId, openKfId, formatText(text));
        }

        return { channel: "wechat-kf", messageId: result.msgid, chatId: to };
      } catch (err) {
        if (isSessionLimitError(err)) {
          console.error(
            `[wechat-kf] session limit exceeded (48h/5-msg) for user=${externalUserId} kf=${openKfId}. ` +
            `The customer must send a new message before more replies can be delivered.`,
          );
        }
        throw err;
      }
    }

    // ── No resolvable media: send as text ──
    const content = text?.trim()
      ? `${text}\n${mediaUrl || mediaPath || ""}`
      : mediaUrl ? mediaUrl : mediaPath ? mediaPath : text ?? "";
    try {
      const result = await sendTextMessage(account.corpId, account.appSecret, externalUserId, openKfId, content);
      return { channel: "wechat-kf", messageId: result.msgid, chatId: to };
    } catch (err) {
      if (isSessionLimitError(err)) {
        console.error(
          `[wechat-kf] session limit exceeded (48h/5-msg) for user=${externalUserId} kf=${openKfId}. ` +
          `The customer must send a new message before more replies can be delivered.`,
        );
      }
      throw err;
    }
  },
};
