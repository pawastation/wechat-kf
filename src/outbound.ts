/**
 * Outbound message adapter for WeChat KF  (framework-driven direct delivery)
 *
 * Responsibility:
 *   This module implements the OpenClaw `ChannelPlugin.outbound` interface and
 *   is called by the framework when the agent produces a final reply.
 *
 *   Text is first converted from markdown to Unicode formatting (formatText),
 *   then chunked via the runtime's `chunkTextWithMode` helper (respecting user
 *   `chunkMode` config).  Framework auto-chunking is disabled (`chunker: null`)
 *   because it would chunk *before* formatting, causing post-format expansion
 *   (Unicode math-bold chars are 2 `.length` units each) to exceed the limit.
 *
 *   For media, the framework's `loadWebMedia` handles all URL formats
 *   (HTTP, file://, local paths, MEDIA: prefix, ~), then the buffer is
 *   uploaded to WeChat and sent using `uploadAndSendMedia` from `send-utils.ts`.
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

import type { ChannelOutboundAdapter, OpenClawConfig } from "openclaw/plugin-sdk";
import { resolveAccount } from "./accounts.js";
import {
  sendBusinessCardMessage,
  sendCaLinkMessage,
  sendLinkMessage,
  sendLocationMessage,
  sendMiniprogramMessage,
  sendMsgMenuMessage,
  sendRawMessage,
  sendTextMessage,
} from "./api.js";
import { CHANNEL_ID, logTag, WECHAT_MSG_LIMIT_ERRCODE, WECHAT_TEXT_CHUNK_LIMIT } from "./constants.js";
import { getSharedContext } from "./monitor.js";
import { getRuntime } from "./runtime.js";
import { formatText, mediaKindToWechatType, resolveThumbMediaId, uploadAndSendMedia } from "./send-utils.js";
import type { WechatKfSendMsgRequest, WechatKfSendMsgResponse } from "./types.js";
import { buildMsgMenuPayload, parseWechatDirective } from "./wechat-kf-directives.js";

/** Resolve chunk limit and mode from the runtime, then split text accordingly. */
function chunkViaRuntime(text: string, cfg: OpenClawConfig, accountId: string): string[] {
  const core = getRuntime();
  const limit = core.channel.text.resolveTextChunkLimit(cfg, CHANNEL_ID, accountId, {
    fallbackLimit: WECHAT_TEXT_CHUNK_LIMIT,
  });
  const mode = core.channel.text.resolveChunkMode(cfg, CHANNEL_ID);
  return core.channel.text.chunkTextWithMode(text, limit, mode);
}

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

function warnSessionLimit(err: unknown, externalUserId: string, openKfId: string): void {
  if (isSessionLimitError(err)) {
    getSharedContext()?.botCtx.log?.warn(
      `${logTag()} session limit exceeded (48h/5-msg) for user=${externalUserId} kf=${openKfId}. ` +
        `The customer must send a new message before more replies can be delivered.`,
    );
  }
}

export const wechatKfOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct" as const,
  chunker: null, // disabled — sendText formats first, then chunks internally
  textChunkLimit: WECHAT_TEXT_CHUNK_LIMIT,

  sendText: async ({ cfg, to, text, accountId }) => {
    const account = resolveAccount(cfg, accountId ?? "");
    const effectiveAccountId = accountId ?? "";
    const openKfId = account.openKfId ?? effectiveAccountId;
    if (!account.corpId || !account.appSecret || !openKfId) {
      throw new Error(`${logTag()} missing corpId/appSecret/openKfId`);
    }
    const externalUserId = String(to).replace(/^user:/, "");

    // ── Intercept [[wechat_*:...]] directives BEFORE formatText ──
    // Parse on raw text so fields stay clean (formatText would
    // convert markdown inside the directive to unicode characters).
    const directive = parseWechatDirective(text);
    if (directive.link) {
      try {
        let thumbMediaId: string | undefined;

        if (directive.link.thumbUrl) {
          thumbMediaId = await resolveThumbMediaId(directive.link.thumbUrl, account.corpId, account.appSecret);
        }

        // WeChat requires thumb_media_id for link cards — fall back to plain text if missing
        if (!thumbMediaId) {
          const fallbackText = directive.text
            ? `${formatText(directive.text)}\n${directive.link.title}: ${directive.link.url}`
            : `${directive.link.title}: ${directive.link.url}`;
          const fallbackChunks = chunkViaRuntime(fallbackText, cfg, effectiveAccountId);
          let lastResult: WechatKfSendMsgResponse | undefined;
          for (const chunk of fallbackChunks) {
            lastResult = await sendTextMessage(account.corpId, account.appSecret, externalUserId, openKfId, chunk);
          }
          return { channel: CHANNEL_ID, messageId: lastResult?.msgid ?? "", chatId: to };
        }

        const linkResult = await sendLinkMessage(account.corpId, account.appSecret, externalUserId, openKfId, {
          title: directive.link.title,
          desc: directive.link.desc,
          url: directive.link.url,
          thumb_media_id: thumbMediaId,
        });

        // Send remaining text if non-empty (apply formatText to surrounding text only)
        if (directive.text) {
          const remainFormatted = formatText(directive.text);
          const remainChunks = chunkViaRuntime(remainFormatted, cfg, effectiveAccountId);
          for (const chunk of remainChunks) {
            await sendTextMessage(account.corpId, account.appSecret, externalUserId, openKfId, chunk);
          }
        }

        return { channel: CHANNEL_ID, messageId: linkResult.msgid, chatId: to };
      } catch (err) {
        warnSessionLimit(err, externalUserId, openKfId);
        throw err;
      }
    }

    if (directive.location) {
      try {
        const locResult = await sendLocationMessage(
          account.corpId,
          account.appSecret,
          externalUserId,
          openKfId,
          directive.location,
        );
        if (directive.text) {
          const remainChunks = chunkViaRuntime(formatText(directive.text), cfg, effectiveAccountId);
          for (const chunk of remainChunks) {
            await sendTextMessage(account.corpId, account.appSecret, externalUserId, openKfId, chunk);
          }
        }
        return { channel: CHANNEL_ID, messageId: locResult.msgid, chatId: to };
      } catch (err) {
        warnSessionLimit(err, externalUserId, openKfId);
        throw err;
      }
    }

    if (directive.miniprogram) {
      try {
        let thumbMediaId: string | undefined;
        if (directive.miniprogram.thumbUrl) {
          thumbMediaId = await resolveThumbMediaId(directive.miniprogram.thumbUrl, account.corpId, account.appSecret);
        }
        if (!thumbMediaId) {
          // Miniprogram card requires thumb — fall back to text
          const fallback = directive.text
            ? `${formatText(directive.text)}\n[小程序] ${directive.miniprogram.title}`
            : `[小程序] ${directive.miniprogram.title}`;
          const chunks = chunkViaRuntime(fallback, cfg, effectiveAccountId);
          let lastResult: WechatKfSendMsgResponse | undefined;
          for (const chunk of chunks) {
            lastResult = await sendTextMessage(account.corpId, account.appSecret, externalUserId, openKfId, chunk);
          }
          return { channel: CHANNEL_ID, messageId: lastResult?.msgid ?? "", chatId: to };
        }
        const mpResult = await sendMiniprogramMessage(account.corpId, account.appSecret, externalUserId, openKfId, {
          appid: directive.miniprogram.appid,
          title: directive.miniprogram.title,
          pagepath: directive.miniprogram.pagepath,
          thumb_media_id: thumbMediaId,
        });
        if (directive.text) {
          const remainChunks = chunkViaRuntime(formatText(directive.text), cfg, effectiveAccountId);
          for (const chunk of remainChunks) {
            await sendTextMessage(account.corpId, account.appSecret, externalUserId, openKfId, chunk);
          }
        }
        return { channel: CHANNEL_ID, messageId: mpResult.msgid, chatId: to };
      } catch (err) {
        warnSessionLimit(err, externalUserId, openKfId);
        throw err;
      }
    }

    if (directive.menu) {
      try {
        const menuPayload = buildMsgMenuPayload(directive.menu);
        const menuResult = await sendMsgMenuMessage(
          account.corpId,
          account.appSecret,
          externalUserId,
          openKfId,
          menuPayload,
        );
        if (directive.text) {
          const remainChunks = chunkViaRuntime(formatText(directive.text), cfg, effectiveAccountId);
          for (const chunk of remainChunks) {
            await sendTextMessage(account.corpId, account.appSecret, externalUserId, openKfId, chunk);
          }
        }
        return { channel: CHANNEL_ID, messageId: menuResult.msgid, chatId: to };
      } catch (err) {
        warnSessionLimit(err, externalUserId, openKfId);
        throw err;
      }
    }

    if (directive.businessCard) {
      try {
        const cardResult = await sendBusinessCardMessage(
          account.corpId,
          account.appSecret,
          externalUserId,
          openKfId,
          directive.businessCard,
        );
        if (directive.text) {
          const remainChunks = chunkViaRuntime(formatText(directive.text), cfg, effectiveAccountId);
          for (const chunk of remainChunks) {
            await sendTextMessage(account.corpId, account.appSecret, externalUserId, openKfId, chunk);
          }
        }
        return { channel: CHANNEL_ID, messageId: cardResult.msgid, chatId: to };
      } catch (err) {
        warnSessionLimit(err, externalUserId, openKfId);
        throw err;
      }
    }

    if (directive.caLink) {
      try {
        const caResult = await sendCaLinkMessage(
          account.corpId,
          account.appSecret,
          externalUserId,
          openKfId,
          directive.caLink,
        );
        if (directive.text) {
          const remainChunks = chunkViaRuntime(formatText(directive.text), cfg, effectiveAccountId);
          for (const chunk of remainChunks) {
            await sendTextMessage(account.corpId, account.appSecret, externalUserId, openKfId, chunk);
          }
        }
        return { channel: CHANNEL_ID, messageId: caResult.msgid, chatId: to };
      } catch (err) {
        warnSessionLimit(err, externalUserId, openKfId);
        throw err;
      }
    }

    if (directive.raw) {
      try {
        const rawResult = await sendRawMessage(
          account.corpId,
          account.appSecret,
          externalUserId,
          openKfId,
          directive.raw.msgtype,
          directive.raw.payload,
        );
        if (directive.text) {
          const remainChunks = chunkViaRuntime(formatText(directive.text), cfg, effectiveAccountId);
          for (const chunk of remainChunks) {
            await sendTextMessage(account.corpId, account.appSecret, externalUserId, openKfId, chunk);
          }
        }
        return { channel: CHANNEL_ID, messageId: rawResult.msgid, chatId: to };
      } catch (err) {
        warnSessionLimit(err, externalUserId, openKfId);
        throw err;
      }
    }

    const formatted = formatText(text);
    const chunks = chunkViaRuntime(formatted, cfg, effectiveAccountId);
    try {
      let lastResult: WechatKfSendMsgResponse | undefined;
      for (const chunk of chunks) {
        lastResult = await sendTextMessage(account.corpId, account.appSecret, externalUserId, openKfId, chunk);
      }
      return { channel: CHANNEL_ID, messageId: lastResult?.msgid ?? "", chatId: to };
    } catch (err) {
      warnSessionLimit(err, externalUserId, openKfId);
      throw err;
    }
  },

  sendMedia: async ({ cfg, to, text, mediaUrl, accountId }) => {
    const account = resolveAccount(cfg, accountId ?? "");
    const openKfId = account.openKfId ?? accountId ?? "";
    if (!account.corpId || !account.appSecret || !openKfId) {
      throw new Error(`${logTag()} missing corpId/appSecret/openKfId`);
    }

    const externalUserId = String(to).replace(/^user:/, "");

    if (mediaUrl) {
      const core = getRuntime();
      const loaded = await core.media.loadWebMedia(mediaUrl, { optimizeImages: false });
      const mediaType = mediaKindToWechatType(loaded.kind);

      try {
        const result = await uploadAndSendMedia(
          account.corpId,
          account.appSecret,
          externalUserId,
          openKfId,
          loaded.buffer,
          loaded.fileName ?? "file",
          mediaType,
        );

        if (text?.trim()) {
          await sendTextMessage(account.corpId, account.appSecret, externalUserId, openKfId, formatText(text));
        }

        return { channel: CHANNEL_ID, messageId: result.msgid, chatId: to };
      } catch (err) {
        warnSessionLimit(err, externalUserId, openKfId);
        throw err;
      }
    }

    // ── No resolvable media: send as text ──
    const content = text?.trim() ? `${text}\n${mediaUrl || ""}` : mediaUrl || text || "";
    try {
      const result = await sendTextMessage(account.corpId, account.appSecret, externalUserId, openKfId, content);
      return { channel: CHANNEL_ID, messageId: result.msgid, chatId: to };
    } catch (err) {
      warnSessionLimit(err, externalUserId, openKfId);
      throw err;
    }
  },

  sendPayload: async ({ cfg, to, text, accountId, payload }) => {
    const account = resolveAccount(cfg, accountId ?? "");
    const openKfId = account.openKfId ?? accountId ?? "";
    if (!account.corpId || !account.appSecret || !openKfId) {
      throw new Error(`${logTag()} missing corpId/appSecret/openKfId`);
    }

    const externalUserId = String(to).replace(/^user:/, "");
    const wechatKf = payload.channelData?.wechatKf as Record<string, unknown> | undefined;
    const link = wechatKf?.link as
      | { title: string; desc?: string; url: string; thumbUrl?: string; thumb_media_id?: string }
      | undefined;

    if (link) {
      let thumbMediaId = link.thumb_media_id;

      // Resolve thumbnail if only thumbUrl/path/media_id is provided
      if (!thumbMediaId && link.thumbUrl) {
        thumbMediaId = await resolveThumbMediaId(link.thumbUrl, account.corpId, account.appSecret);
      }

      if (!thumbMediaId) {
        throw new Error(`${logTag()} sendPayload link requires thumb_media_id or thumbUrl`);
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

        return { channel: CHANNEL_ID, messageId: result.msgid, chatId: to };
      } catch (err) {
        warnSessionLimit(err, externalUserId, openKfId);
        throw err;
      }
    }

    const location = wechatKf?.location as
      | { name?: string; address?: string; latitude: number; longitude: number }
      | undefined;
    if (location) {
      try {
        const result = await sendLocationMessage(account.corpId, account.appSecret, externalUserId, openKfId, location);
        if ((text ?? payload.text)?.trim()) {
          await sendTextMessage(
            account.corpId,
            account.appSecret,
            externalUserId,
            openKfId,
            formatText((text ?? payload.text) as string),
          );
        }
        return { channel: CHANNEL_ID, messageId: result.msgid, chatId: to };
      } catch (err) {
        warnSessionLimit(err, externalUserId, openKfId);
        throw err;
      }
    }

    const miniprogram = wechatKf?.miniprogram as
      | { appid: string; title: string; pagepath: string; thumb_media_id?: string; thumbUrl?: string }
      | undefined;
    if (miniprogram) {
      let thumbMediaId = miniprogram.thumb_media_id;
      if (!thumbMediaId && miniprogram.thumbUrl) {
        thumbMediaId = await resolveThumbMediaId(miniprogram.thumbUrl, account.corpId, account.appSecret);
      }
      if (!thumbMediaId) {
        throw new Error(`${logTag()} sendPayload miniprogram requires thumb_media_id or thumbUrl`);
      }
      try {
        const result = await sendMiniprogramMessage(account.corpId, account.appSecret, externalUserId, openKfId, {
          appid: miniprogram.appid,
          title: miniprogram.title,
          pagepath: miniprogram.pagepath,
          thumb_media_id: thumbMediaId,
        });
        if ((text ?? payload.text)?.trim()) {
          await sendTextMessage(
            account.corpId,
            account.appSecret,
            externalUserId,
            openKfId,
            formatText((text ?? payload.text) as string),
          );
        }
        return { channel: CHANNEL_ID, messageId: result.msgid, chatId: to };
      } catch (err) {
        warnSessionLimit(err, externalUserId, openKfId);
        throw err;
      }
    }

    const msgmenu = wechatKf?.msgmenu as WechatKfSendMsgRequest["msgmenu"] | undefined;
    if (msgmenu) {
      try {
        const result = await sendMsgMenuMessage(account.corpId, account.appSecret, externalUserId, openKfId, msgmenu);
        if ((text ?? payload.text)?.trim()) {
          await sendTextMessage(
            account.corpId,
            account.appSecret,
            externalUserId,
            openKfId,
            formatText((text ?? payload.text) as string),
          );
        }
        return { channel: CHANNEL_ID, messageId: result.msgid, chatId: to };
      } catch (err) {
        warnSessionLimit(err, externalUserId, openKfId);
        throw err;
      }
    }

    const businessCard = wechatKf?.businessCard as { userid: string } | undefined;
    if (businessCard) {
      try {
        const result = await sendBusinessCardMessage(
          account.corpId,
          account.appSecret,
          externalUserId,
          openKfId,
          businessCard,
        );
        if ((text ?? payload.text)?.trim()) {
          await sendTextMessage(
            account.corpId,
            account.appSecret,
            externalUserId,
            openKfId,
            formatText((text ?? payload.text) as string),
          );
        }
        return { channel: CHANNEL_ID, messageId: result.msgid, chatId: to };
      } catch (err) {
        warnSessionLimit(err, externalUserId, openKfId);
        throw err;
      }
    }

    const caLink = wechatKf?.caLink as { link_url: string } | undefined;
    if (caLink) {
      try {
        const result = await sendCaLinkMessage(account.corpId, account.appSecret, externalUserId, openKfId, caLink);
        if ((text ?? payload.text)?.trim()) {
          await sendTextMessage(
            account.corpId,
            account.appSecret,
            externalUserId,
            openKfId,
            formatText((text ?? payload.text) as string),
          );
        }
        return { channel: CHANNEL_ID, messageId: result.msgid, chatId: to };
      } catch (err) {
        warnSessionLimit(err, externalUserId, openKfId);
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
        return { channel: CHANNEL_ID, messageId: result.msgid, chatId: to };
      } catch (err) {
        warnSessionLimit(err, externalUserId, openKfId);
        throw err;
      }
    }

    return { channel: CHANNEL_ID, messageId: "", chatId: to };
  },
};
