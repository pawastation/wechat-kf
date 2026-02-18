/**
 * Reply dispatcher for WeChat KF
 *
 * accountId = openKfId (dynamically discovered)
 */

import { sendTextMessage, sendImageMessage, uploadMedia } from "./api.js";
import { resolveAccount } from "./accounts.js";
import { getRuntime } from "./runtime.js";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { markdownToUnicode } from "./unicode-format.js";
import { WECHAT_TEXT_CHUNK_LIMIT } from "./constants.js";

export type CreateReplyDispatcherParams = {
  cfg: any;
  agentId: string;
  runtime: any;
  externalUserId: string;
  openKfId: string;
  accountId: string; // same as openKfId
};

export function createReplyDispatcher(params: CreateReplyDispatcherParams) {
  const core = getRuntime();
  const { cfg, agentId, externalUserId, openKfId, accountId } = params;

  const account = resolveAccount(cfg, accountId);
  const kfId = openKfId; // accountId IS the kfid

  const textChunkLimit = core.channel.text.resolveTextChunkLimit(cfg, "wechat-kf", accountId, {
    fallbackLimit: WECHAT_TEXT_CHUNK_LIMIT,
  });
  const chunkMode = core.channel.text.resolveChunkMode(cfg, "wechat-kf");

  const { dispatcher, replyOptions, markDispatchIdle } =
    core.channel.reply.createReplyDispatcherWithTyping({
      humanDelay: core.channel.reply.resolveHumanDelayConfig(cfg, agentId),
      deliver: async (payload: any) => {
        const text = payload.text ?? "";
        const attachments = payload.attachments || [];

        const { corpId, appSecret } = account;
        if (!corpId || !appSecret) {
          throw new Error("[wechat-kf] missing corpId/appSecret for send");
        }

        // Handle image attachments
        for (const attachment of attachments) {
          if (attachment.type === "image" && attachment.path) {
            try {
              const buffer = await readFile(attachment.path);
              const ext = extname(attachment.path).toLowerCase();
              const filename = `image${ext || '.jpg'}`;
              
              const uploadResponse = await uploadMedia(corpId, appSecret, "image", buffer, filename);
              await sendImageMessage(corpId, appSecret, externalUserId, kfId, uploadResponse.media_id);
            } catch (err) {
              params.runtime?.error?.(`[wechat-kf] failed to send image attachment: ${String(err)}`);
            }
          }
        }

        // Send text — convert markdown to Unicode styled text
        const formatted = text.trim() ? markdownToUnicode(text) : "";
        if (formatted.trim()) {
          const chunks = core.channel.text.chunkTextWithMode(formatted, textChunkLimit, chunkMode);
          for (const chunk of chunks) {
            await sendTextMessage(corpId, appSecret, externalUserId, kfId, chunk);
          }
        }

        if (!text.trim() && attachments.length === 0) {
          return;
        }
      },
      onError: (err: any, info: any) => {
        params.runtime?.error?.(
          `[wechat-kf] ${info?.kind ?? "unknown"} reply failed: ${String(err)}`,
        );
      },
    });

  return { dispatcher, replyOptions, markDispatchIdle };
}
