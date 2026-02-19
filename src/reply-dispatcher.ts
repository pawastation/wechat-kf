/**
 * Reply dispatcher for WeChat KF  (typing-aware streaming replies)
 *
 * Responsibility:
 *   This module is used internally by `bot.ts` when the agent streams tokens
 *   back to the user. It wraps OpenClaw's `createReplyDispatcherWithTyping` to
 *   batch tokens into natural-looking messages with simulated human typing
 *   delay, then delivers them through the WeChat KF API.
 *
 *   Text chunking is performed at delivery time via the runtime's
 *   `chunkTextWithMode` helper (NOT the framework auto-chunker), because
 *   streaming replies accumulate text incrementally.
 *
 * Counterpart:
 *   `outbound.ts` handles the *other* outbound path: framework-driven direct
 *   delivery where the framework itself pre-chunks text via the declared
 *   `chunker` function.
 *
 * accountId = openKfId (dynamically discovered)
 */

import type { OpenClawConfig, PluginRuntime, ReplyPayload } from "openclaw/plugin-sdk";
import { resolveAccount } from "./accounts.js";
import { sendLinkMessage, sendTextMessage, uploadMedia } from "./api.js";
import { WECHAT_TEXT_CHUNK_LIMIT } from "./constants.js";
import { getRuntime } from "./runtime.js";
import { downloadMediaFromUrl, formatText, mediaKindToWechatType, uploadAndSendMedia } from "./send-utils.js";
import { parseWechatLinkDirective } from "./wechat-kf-directives.js";

/** Minimal runtime shape used only for error logging in the reply dispatcher. */
type RuntimeErrorLogger = {
  error?: (...args: unknown[]) => void;
  [key: string]: unknown;
};

export type CreateReplyDispatcherParams = {
  cfg: OpenClawConfig;
  agentId: string;
  runtime: RuntimeErrorLogger;
  externalUserId: string;
  openKfId: string;
  accountId: string; // same as openKfId
};

export function createReplyDispatcher(
  params: CreateReplyDispatcherParams,
): ReturnType<PluginRuntime["channel"]["reply"]["createReplyDispatcherWithTyping"]> {
  const core = getRuntime();
  const { cfg, agentId, externalUserId, openKfId, accountId } = params;

  const account = resolveAccount(cfg, accountId);
  const kfId = openKfId; // accountId IS the kfid

  const textChunkLimit = core.channel.text.resolveTextChunkLimit(cfg, "wechat-kf", accountId, {
    fallbackLimit: WECHAT_TEXT_CHUNK_LIMIT,
  });
  const chunkMode = core.channel.text.resolveChunkMode(cfg, "wechat-kf");

  const { dispatcher, replyOptions, markDispatchIdle } = core.channel.reply.createReplyDispatcherWithTyping({
    humanDelay: core.channel.reply.resolveHumanDelayConfig(cfg, agentId),
    deliver: async (payload: ReplyPayload) => {
      const text = payload.text ?? "";
      const mediaUrls = payload.mediaUrls ?? (payload.mediaUrl ? [payload.mediaUrl] : []);

      const { corpId, appSecret } = account;
      if (!corpId || !appSecret) {
        throw new Error("[wechat-kf] missing corpId/appSecret for send");
      }

      // Handle media (image, voice, video, file) via framework loadWebMedia
      for (const url of mediaUrls) {
        try {
          const loaded = await core.media.loadWebMedia(url, { optimizeImages: false });
          const mediaType = mediaKindToWechatType(loaded.kind);
          await uploadAndSendMedia(
            corpId,
            appSecret,
            externalUserId,
            kfId,
            loaded.buffer,
            loaded.fileName ?? "file",
            mediaType,
          );
        } catch (err) {
          params.runtime?.error?.(`[wechat-kf] failed to send media: ${String(err)}`);
        }
      }

      // ── Intercept [[wechat_link:...]] directives BEFORE formatText ──
      // Parse on raw text so title/desc/url stay clean (formatText would
      // convert markdown inside the directive to unicode characters).
      if (text.trim()) {
        const directive = parseWechatLinkDirective(text);
        if (directive.link) {
          let linkSent = false;

          if (directive.link.thumbUrl) {
            try {
              const downloaded = await downloadMediaFromUrl(directive.link.thumbUrl);
              const uploaded = await uploadMedia(corpId, appSecret, "image", downloaded.buffer, downloaded.filename);
              await sendLinkMessage(corpId, appSecret, externalUserId, kfId, {
                title: directive.link.title,
                desc: directive.link.desc,
                url: directive.link.url,
                thumb_media_id: uploaded.media_id,
              });
              linkSent = true;
            } catch (err) {
              params.runtime?.error?.(`[wechat-kf] failed to send link card: ${String(err)}`);
            }
          }

          // Send remaining text (or fallback with title:url if link card failed / no thumbUrl)
          const rawRemaining = linkSent
            ? directive.text
            : directive.text
              ? `${directive.text}\n${directive.link.title}: ${directive.link.url}`
              : `${directive.link.title}: ${directive.link.url}`;

          if (rawRemaining?.trim()) {
            const formatted = formatText(rawRemaining);
            const chunks = core.channel.text.chunkTextWithMode(formatted, textChunkLimit, chunkMode);
            for (const chunk of chunks) {
              await sendTextMessage(corpId, appSecret, externalUserId, kfId, chunk);
            }
          }
        } else {
          // No directive — normal path: formatText then chunk and send
          const formatted = formatText(text);
          if (formatted.trim()) {
            const chunks = core.channel.text.chunkTextWithMode(formatted, textChunkLimit, chunkMode);
            for (const chunk of chunks) {
              await sendTextMessage(corpId, appSecret, externalUserId, kfId, chunk);
            }
          }
        }
      }

      if (!text.trim() && mediaUrls.length === 0) {
        return;
      }
    },
    onError: (err: unknown, info: { kind?: string }) => {
      params.runtime?.error?.(`[wechat-kf] ${info?.kind ?? "unknown"} reply failed: ${String(err)}`);
    },
  });

  return { dispatcher, replyOptions, markDispatchIdle };
}
