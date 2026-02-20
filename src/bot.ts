/**
 * Message processing — pull messages via sync_msg and dispatch to OpenClaw agent.
 *
 * Architecture:
 * - Each openKfId is an independent account with its own cursor and session
 * - sync_msg is called with open_kfid filter to only pull messages for that kf account
 * - Plugin layer: download media, save via MediaPaths/MediaTypes
 * - OpenClaw runner: handles media understanding (transcription, vision, etc.)
 */

import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChannelLogSink, OpenClawConfig } from "openclaw/plugin-sdk";
import { getChannelConfig, registerKfId, resolveAccount } from "./accounts.js";
import { downloadMedia, syncMessages } from "./api.js";
import { MAX_MESSAGE_AGE_S } from "./constants.js";
import { atomicWriteFile } from "./fs-utils.js";
import { createReplyDispatcher } from "./reply-dispatcher.js";
import { getRuntime } from "./runtime.js";
import { contentTypeToExt, detectImageMime } from "./send-utils.js";
import type {
  ResolvedWechatKfAccount,
  WechatKfMessage,
  WechatKfSyncMsgRequest,
  WechatKfSyncMsgResponse,
} from "./types.js";

/** Minimal runtime shape used only for error logging in the reply dispatcher. */
export type RuntimeErrorLogger = {
  error?: (...args: unknown[]) => void;
  [key: string]: unknown;
};

export type BotContext = {
  cfg: OpenClawConfig;
  runtime?: RuntimeErrorLogger;
  stateDir: string;
  log?: ChannelLogSink;
};

// ── Per-kfId async mutex ──
// Ensures that concurrent calls to handleWebhookEvent for the same openKfId
// (e.g. from webhook + polling simultaneously) are serialized.

const kfLocks = new Map<string, Promise<void>>();

// ── Message deduplication ──
// Tracks recently-processed msgids to avoid dispatching the same message twice,
// even if sync_msg returns overlapping batches from concurrent paths.

const processedMsgIds = new Set<string>();
const DEDUP_MAX_SIZE = 10_000;

function isDuplicate(msgid: string): boolean {
  if (processedMsgIds.has(msgid)) return true;
  if (processedMsgIds.size >= DEDUP_MAX_SIZE) {
    // Evict the oldest half (Set preserves insertion order)
    const entries = [...processedMsgIds];
    processedMsgIds.clear();
    for (const id of entries.slice(entries.length >>> 1)) {
      processedMsgIds.add(id);
    }
  }
  processedMsgIds.add(msgid);
  return false;
}

/** Exposed for testing only — do not use in production code. */
export const _testing = {
  kfLocks,
  processedMsgIds,
  isDuplicate,
  DEDUP_MAX_SIZE,
  handleEvent,
  drainToLatestCursor,
  resetState() {
    kfLocks.clear();
    processedMsgIds.clear();
  },
};

// ── Cursor persistence (per kfid) ──

async function loadCursor(stateDir: string, kfId: string): Promise<string> {
  try {
    return (await readFile(join(stateDir, `wechat-kf-cursor-${kfId}.txt`), "utf8")).trim();
  } catch {
    return "";
  }
}

let dirCreated = false;

async function saveCursor(stateDir: string, kfId: string, cursor: string): Promise<void> {
  if (!dirCreated) {
    await mkdir(stateDir, { recursive: true });
    dirCreated = true;
  }
  await atomicWriteFile(join(stateDir, `wechat-kf-cursor-${kfId}.txt`), cursor);
}

// ── Message text extraction ──

// Descriptions of non-text messages injected into the AI agent's context.
// Kept in Chinese because end-users are Chinese WeChat users and the agent
// replies in Chinese. These are NOT displayed to end-users directly.
function extractText(msg: WechatKfMessage): string | null {
  switch (msg.msgtype) {
    case "text":
      return msg.text?.content ?? "";
    case "image":
      return "[用户发送了一张图片]";
    case "voice":
      return "[用户发送了一段语音]";
    case "video":
      return "[用户发送了一段视频]";
    case "file":
      return "[用户发送了一个文件]";
    case "location": {
      const loc = msg.location;
      const parts = [loc?.name, loc?.address].filter(Boolean).join(" ");
      const coords = loc?.latitude != null && loc?.longitude != null ? ` (${loc.latitude}, ${loc.longitude})` : "";
      return parts ? `[位置: ${parts}${coords}]` : coords ? `[位置:${coords}]` : "[位置]";
    }
    case "link":
      return `[链接: ${msg.link?.title ?? ""} ${msg.link?.url ?? ""}]`;
    case "merged_msg": {
      const merged = msg.merged_msg;
      if (!merged) return "[转发的聊天记录]";
      const title = merged.title ?? "聊天记录";
      const items = Array.isArray(merged.item) ? merged.item : [];
      const lines = items.map((item) => {
        const sender = item.sender_name ?? "未知";
        let content = "";
        try {
          const parsed = JSON.parse(item.msg_content ?? "{}") as Record<string, unknown>;
          const parsedText = parsed.text as { content?: string } | undefined;
          if (parsedText?.content) content = parsedText.content;
          else if (parsed.image) content = "[图片]";
          else if (parsed.voice) content = "[语音]";
          else if (parsed.video) content = "[视频]";
          else if (parsed.file) content = "[文件]";
          else if (parsed.link) content = `[链接: ${(parsed.link as { title?: string })?.title ?? ""}]`;
          else content = `[${(parsed.msgtype as string) ?? "未知类型"}]`;
        } catch {
          content = item.msg_content ?? "";
        }
        return `${sender}: ${content}`;
      });
      return `[转发的聊天记录: ${title}]\n${lines.join("\n")}`;
    }
    case "channels": {
      const ch = msg.channels;
      const typeMap: Record<number, string> = { 1: "视频号动态", 2: "视频号直播", 3: "视频号名片" };
      const typeName = ch?.sub_type != null ? (typeMap[ch.sub_type] ?? "视频号消息") : "视频号消息";
      return `[${typeName}] ${ch?.nickname ?? ""}: ${ch?.title ?? ""}`;
    }
    case "miniprogram": {
      const mp = msg.miniprogram;
      return `[小程序] ${mp?.title ?? ""} (appid: ${mp?.appid ?? ""})`;
    }
    case "msgmenu": {
      const menu = msg.msgmenu;
      const head = menu?.head_content ?? "";
      const items = Array.isArray(menu?.list) ? menu.list.map((item) => item.content ?? item.id).join(", ") : "";
      return head ? `${head} [选项: ${items}]` : `[菜单消息: ${items}]`;
    }
    case "business_card":
      return `[名片] userid: ${msg.business_card?.userid ?? ""}`;
    case "event":
      return null;
    default:
      return `[未支持的消息类型: ${msg.msgtype}]`;
  }
}

// ── Event handling ──

async function handleEvent(ctx: BotContext, _account: ResolvedWechatKfAccount, msg: WechatKfMessage): Promise<void> {
  const event = msg.event;
  const { log } = ctx;
  const kfId = msg.open_kfid;

  switch (event?.event_type) {
    case "enter_session":
      log?.info(
        `[wechat-kf:${kfId}] user ${msg.external_userid} entered session` +
          (event.welcome_code ? `, welcome_code=${event.welcome_code}` : "") +
          (event.scene ? `, scene=${event.scene}` : ""),
      );
      break;
    case "msg_send_fail":
      log?.error(`[wechat-kf:${kfId}] message send failed: msgid=${event.fail_msgid}, type=${event.fail_type}`);
      break;
    case "servicer_status_change":
      log?.info(`[wechat-kf:${kfId}] servicer status changed: ${event.servicer_userid} -> ${event.status}`);
      break;
    default:
      log?.info(`[wechat-kf:${kfId}] unhandled event: ${event?.event_type}`);
  }
}

// ── Cold Start Catch-up (Layer 1) ──
// When there is no cursor (file missing, empty, corrupt), drain all pending
// messages without dispatching them.  This prevents historical message
// bombardment after cursor loss.

async function drainToLatestCursor(
  corpId: string,
  appSecret: string,
  openKfId: string,
  syncToken: string,
  stateDir: string,
  log?: ChannelLogSink,
): Promise<void> {
  let cursor = "";
  let hasMore = true;
  let totalDrained = 0;

  while (hasMore) {
    const syncReq: WechatKfSyncMsgRequest = { limit: 1000, open_kfid: openKfId };
    if (cursor) syncReq.cursor = cursor;
    else if (syncToken) syncReq.token = syncToken;

    let resp: WechatKfSyncMsgResponse;
    try {
      resp = await syncMessages(corpId, appSecret, syncReq);
    } catch (err) {
      log?.error?.(`[wechat-kf:${openKfId}] drain failed: ${err instanceof Error ? err.message : err}`);
      return;
    }

    totalDrained += resp.msg_list?.length ?? 0;
    if (resp.next_cursor) {
      cursor = resp.next_cursor;
      await saveCursor(stateDir, openKfId, cursor);
    }
    hasMore = resp.has_more === 1;
  }

  if (totalDrained > 0) {
    log?.info?.(`[wechat-kf:${openKfId}] cold start catch-up: skipped ${totalDrained} messages, cursor saved`);
  }
}

// ── Core message handler (per kfid) ──

export async function handleWebhookEvent(ctx: BotContext, openKfId: string, syncToken: string): Promise<void> {
  // Acquire per-kfId mutex — chains onto any in-flight processing for this kfId
  const prev = kfLocks.get(openKfId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((r) => {
    release = r;
  });
  kfLocks.set(openKfId, current);

  try {
    await prev;
    await _handleWebhookEventInner(ctx, openKfId, syncToken);
  } finally {
    release();
    // Clean up map entry only if no newer caller has replaced it
    if (kfLocks.get(openKfId) === current) {
      kfLocks.delete(openKfId);
    }
  }
}

async function _handleWebhookEventInner(ctx: BotContext, openKfId: string, syncToken: string): Promise<void> {
  const { cfg, stateDir, log } = ctx;
  const account = resolveAccount(cfg, openKfId); // kfid as accountId

  const { corpId, appSecret } = account;
  if (!corpId || !appSecret) {
    log?.error("[wechat-kf] missing corpId/appSecret");
    return;
  }

  // Register this kfid as discovered
  await registerKfId(openKfId);

  let cursor = await loadCursor(stateDir, openKfId);

  // Layer 1: Cold Start Catch-up — no cursor means drain without dispatching
  if (!cursor) {
    log?.info?.(`[wechat-kf:${openKfId}] no cursor, draining to current position`);
    await drainToLatestCursor(corpId, appSecret, openKfId, syncToken, stateDir, log);
    return;
  }

  // Normal incremental fetch — cursor is always present at this point
  let hasMore = true;

  while (hasMore) {
    const syncReq: WechatKfSyncMsgRequest = {
      limit: 1000,
      open_kfid: openKfId, // Only pull messages for this kf account
      cursor,
    };

    let resp: WechatKfSyncMsgResponse;
    try {
      resp = await syncMessages(corpId, appSecret, syncReq);
    } catch (err) {
      log?.error(`[wechat-kf:${openKfId}] sync_msg failed: ${err instanceof Error ? err.message : err}`);
      return;
    }

    for (const msg of resp.msg_list ?? []) {
      // Handle event messages (any origin) before normal message processing
      if (msg.msgtype === "event") {
        await handleEvent(ctx, account, msg);
        continue;
      }

      if (msg.origin !== 3) continue; // Only customer messages

      // Layer 2: skip stale messages to prevent bombardment from corrupt cursors
      const messageAgeS = Math.floor(Date.now() / 1000) - msg.send_time;
      if (messageAgeS > MAX_MESSAGE_AGE_S) {
        log?.debug?.(`[wechat-kf:${openKfId}] skipping stale msg ${msg.msgid} (age=${messageAgeS}s)`);
        continue;
      }

      // Dedup: skip messages we have already processed
      if (isDuplicate(msg.msgid)) {
        log?.debug?.(`[wechat-kf:${openKfId}] skipping duplicate msg ${msg.msgid}`);
        continue;
      }

      const text = extractText(msg);
      if (text === null || text === "") continue;

      try {
        await dispatchMessage(ctx, account, msg, text);
      } catch (err) {
        log?.error(
          `[wechat-kf:${openKfId}] dispatch error for msg ${msg.msgid}: ${err instanceof Error ? err.stack || err.message : err}`,
        );
      }
    }

    // P1-02: Save cursor AFTER all messages in the batch are processed
    // (at-least-once delivery). If the process crashes mid-batch, the
    // cursor has not advanced and the batch will be re-fetched on restart.
    // P1-01 msgid dedup ensures replayed messages are not dispatched twice.
    if (resp.next_cursor) {
      cursor = resp.next_cursor;
      await saveCursor(stateDir, openKfId, cursor);
    }

    hasMore = resp.has_more === 1;
  }
}

// ── Dispatch message to agent ──

async function dispatchMessage(
  ctx: BotContext,
  account: ResolvedWechatKfAccount,
  msg: WechatKfMessage,
  text: string,
): Promise<void> {
  const { cfg, runtime, log } = ctx;

  // ── DM policy check ──
  const channelConfig = getChannelConfig(cfg);
  const dmPolicy = channelConfig.dmPolicy ?? "open";
  const externalUserId = msg.external_userid;
  if (dmPolicy === "disabled") {
    log?.info?.(`[wechat-kf] drop DM (dmPolicy: disabled)`);
    return;
  }
  if (dmPolicy === "allowlist") {
    const allowFrom = channelConfig.allowFrom ?? [];
    if (!allowFrom.includes(externalUserId)) {
      log?.info?.(`[wechat-kf] blocked sender ${externalUserId} (dmPolicy: allowlist)`);
      return;
    }
  }
  // "open" and "pairing" modes: allow message through
  // Note: full pairing flow requires runtime API support, deferred to P2

  const core = getRuntime();
  const kfId = msg.open_kfid;

  const from = `wechat-kf:${msg.external_userid}`;
  const to = `user:${msg.external_userid}`;

  // Download media
  const mediaPaths: string[] = [];
  const mediaTypes: string[] = [];

  if (account.corpId && account.appSecret) {
    const mediaId = msg.image?.media_id || msg.voice?.media_id || msg.video?.media_id || msg.file?.media_id;
    if (mediaId) {
      try {
        const { buffer, contentType } = await downloadMedia(account.corpId, account.appSecret, mediaId);

        let mime: string;
        let filename: string;
        if (msg.msgtype === "image") {
          // Detect actual image format: magic bytes first, content-type fallback
          const detected = detectImageMime(buffer);
          if (detected) {
            mime = detected;
          } else {
            const ct = contentType.split(";")[0].trim();
            mime = ct.startsWith("image/") ? ct : "image/jpeg";
          }
          const ext = contentTypeToExt(mime) || ".jpg";
          filename = `wechat_image_${msg.msgid}${ext}`;
        } else {
          const staticMap: Record<string, [string, string]> = {
            voice: ["audio/amr", `wechat_voice_${msg.msgid}.amr`],
            video: ["video/mp4", `wechat_video_${msg.msgid}.mp4`],
            file: ["application/octet-stream", `wechat_file_${msg.msgid}`],
          };
          [mime, filename] = staticMap[msg.msgtype] ?? ["application/octet-stream", `wechat_media_${msg.msgid}`];
        }

        const saved = await core.channel.media.saveMediaBuffer(buffer, mime, "inbound", undefined, filename);
        mediaPaths.push(saved.path);
        mediaTypes.push(mime);
        log?.info(`[wechat-kf:${kfId}] saved media: ${saved.path} (${mime})`);
      } catch (err) {
        log?.error(`[wechat-kf:${kfId}] failed to save media ${mediaId}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  // Route using kfid as accountId — multi-account isolation is handled by the framework
  // via dmScope config (e.g. "per-account-channel-peer"), not by embedding kfId in peer.id
  const route = core.channel.routing.resolveAgentRoute({
    cfg,
    channel: "wechat-kf",
    accountId: kfId,
    peer: { kind: "direct", id: msg.external_userid },
  });

  // System event
  const preview = text.replace(/\s+/g, " ").slice(0, 160);
  core.system.enqueueSystemEvent(`WeChat-KF[${kfId}] DM from ${msg.external_userid}: ${preview}`, {
    sessionKey: route.sessionKey,
    contextKey: `wechat-kf:message:${msg.msgid}`,
  });

  // Format envelope
  const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(cfg);
  const body = core.channel.reply.formatAgentEnvelope({
    channel: "WeChat-KF",
    from: msg.external_userid,
    timestamp: new Date(msg.send_time * 1000),
    envelope: envelopeOptions,
    body: text,
  });

  // Build inbound context
  const inboundCtx = core.channel.reply.finalizeInboundContext({
    Body: body,
    RawBody: text,
    CommandBody: text,
    From: from,
    To: to,
    SessionKey: route.sessionKey,
    AccountId: kfId,
    ChatType: "direct",
    SenderName: msg.external_userid,
    SenderId: msg.external_userid,
    Provider: "wechat-kf",
    Surface: "wechat-kf",
    MessageSid: msg.msgid,
    Timestamp: msg.send_time * 1000,
    WasMentioned: false,
    CommandAuthorized: true,
    OriginatingChannel: "wechat-kf",
    OriginatingTo: to,
    MediaPaths: mediaPaths.length > 0 ? mediaPaths : undefined,
    MediaTypes: mediaTypes.length > 0 ? mediaTypes : undefined,
  });

  // Dispatch to agent
  const { dispatcher, replyOptions, markDispatchIdle } = createReplyDispatcher({
    cfg,
    agentId: route.agentId,
    runtime: runtime ?? {},
    externalUserId: msg.external_userid,
    openKfId: kfId,
    accountId: kfId,
  });

  log?.info(`[wechat-kf:${kfId}] dispatching to agent (session=${route.sessionKey})`);

  const { queuedFinal, counts } = await core.channel.reply.dispatchReplyFromConfig({
    ctx: inboundCtx,
    cfg,
    dispatcher,
    replyOptions,
  });

  markDispatchIdle?.();
  log?.info(`[wechat-kf:${kfId}] dispatch complete (queuedFinal=${queuedFinal}, replies=${counts?.final})`);
}
