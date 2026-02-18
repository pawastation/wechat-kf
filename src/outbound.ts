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

import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { resolveAccount } from "./accounts.js";
import { sendLinkMessage, sendTextMessage, uploadMedia } from "./api.js";
import { chunkText } from "./chunk-utils.js";
import { WECHAT_MSG_LIMIT_ERRCODE, WECHAT_TEXT_CHUNK_LIMIT } from "./constants.js";
import { detectMediaType, downloadMediaFromUrl, formatText, uploadAndSendMedia } from "./send-utils.js";
import type { OpenClawConfig } from "./types.js";
import { parseWechatLinkDirective } from "./wechat-kf-directives.js";

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

export type SendPayloadParams = {
  cfg: OpenClawConfig;
  to: string;
  text?: string;
  accountId: string;
  payload: {
    text?: string;
    channelData?: Record<string, unknown>;
    [key: string]: unknown;
  };
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

    // ── Intercept [[wechat_link:...]] directives ──
    const directive = parseWechatLinkDirective(formatted);
    if (directive.link) {
      try {
        let thumbMediaId: string | undefined;

        if (directive.link.thumbUrl) {
          const downloaded = await downloadMediaFromUrl(directive.link.thumbUrl);
          const uploaded = await uploadMedia(
            account.corpId,
            account.appSecret,
            "image",
            downloaded.buffer,
            downloaded.filename,
          );
          thumbMediaId = uploaded.media_id;
        }

        // WeChat requires thumb_media_id for link cards — fall back to plain text if missing
        if (!thumbMediaId) {
          const fallbackText = directive.text
            ? `${directive.text}\n${directive.link.title}: ${directive.link.url}`
            : `${directive.link.title}: ${directive.link.url}`;
          const result = await sendTextMessage(
            account.corpId,
            account.appSecret,
            externalUserId,
            openKfId,
            fallbackText,
          );
          return { channel: "wechat-kf", messageId: result.msgid, chatId: to };
        }

        const linkResult = await sendLinkMessage(account.corpId, account.appSecret, externalUserId, openKfId, {
          title: directive.link.title,
          desc: directive.link.desc,
          url: directive.link.url,
          thumb_media_id: thumbMediaId,
        });

        // Send remaining text if non-empty
        if (directive.text) {
          await sendTextMessage(account.corpId, account.appSecret, externalUserId, openKfId, directive.text);
        }

        return { channel: "wechat-kf", messageId: linkResult.msgid, chatId: to };
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
          account.corpId,
          account.appSecret,
          externalUserId,
          openKfId,
          downloaded.buffer,
          downloaded.filename,
          mediaType,
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
          account.corpId,
          account.appSecret,
          externalUserId,
          openKfId,
          buffer,
          filename,
          mediaType,
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
      : mediaUrl
        ? mediaUrl
        : mediaPath
          ? mediaPath
          : (text ?? "");
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

  sendPayload: async ({ cfg, to, text, accountId, payload }: SendPayloadParams): Promise<SendResult> => {
    const account = resolveAccount(cfg, accountId);
    const openKfId = account.openKfId ?? accountId;
    if (!account.corpId || !account.appSecret || !openKfId) {
      throw new Error("[wechat-kf] missing corpId/appSecret/openKfId");
    }

    const externalUserId = String(to).replace(/^user:/, "");
    const wechatKf = payload.channelData?.wechatKf as Record<string, unknown> | undefined;
    const link = wechatKf?.link as
      | { title: string; desc?: string; url: string; thumbUrl?: string; thumb_media_id?: string }
      | undefined;

    if (link) {
      let thumbMediaId = link.thumb_media_id;

      // Download and upload thumbnail if only URL is provided
      if (!thumbMediaId && link.thumbUrl) {
        const downloaded = await downloadMediaFromUrl(link.thumbUrl);
        const uploaded = await uploadMedia(
          account.corpId,
          account.appSecret,
          "image",
          downloaded.buffer,
          downloaded.filename,
        );
        thumbMediaId = uploaded.media_id;
      }

      if (!thumbMediaId) {
        throw new Error("[wechat-kf] sendPayload link requires thumb_media_id or thumbUrl");
      }

      try {
        const result = await sendLinkMessage(account.corpId, account.appSecret, externalUserId, openKfId, {
          title: link.title,
          desc: link.desc,
          url: link.url,
          thumb_media_id: thumbMediaId,
        });

        // Send accompanying text if present
        if ((text ?? payload.text)?.trim()) {
          const textContent = (text ?? payload.text) as string;
          await sendTextMessage(account.corpId, account.appSecret, externalUserId, openKfId, formatText(textContent));
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

    // No link data — fall back to sending text
    const textContent = text ?? payload.text ?? "";
    if (textContent.trim()) {
      try {
        const result = await sendTextMessage(
          account.corpId,
          account.appSecret,
          externalUserId,
          openKfId,
          formatText(textContent),
        );
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

    return { channel: "wechat-kf", messageId: "", chatId: to };
  },
};
