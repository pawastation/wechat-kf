/**
 * WeChat KF ChannelPlugin implementation
 *
 * Dynamically discovers kfids from webhook callbacks.
 * Each kfid = one accountId = one independent session.
 *
 * Architecture:
 * - "default" account: enterprise-level shared infra (loads kfIds, validates token, sets shared context)
 * - Per-kfId accounts: wait for shared context, then start 30s polling loop
 * - Webhook handler: registered on framework's shared gateway server (no self-managed HTTP server)
 */

import { homedir } from "node:os";
import type { ChannelAccountSnapshot, ChannelGatewayContext, ChannelPlugin, OpenClawConfig } from "openclaw/plugin-sdk";
import {
  deleteKfId,
  disableKfId,
  enableKfId,
  getChannelConfig,
  listAccountIds,
  loadKfIds,
  resolveAccount,
} from "./accounts.js";
import type { BotContext } from "./bot.js";
import { handleWebhookEvent } from "./bot.js";
import { wechatKfConfigSchema } from "./config-schema.js";
import { formatError } from "./constants.js";
import { clearSharedContext, setSharedContext, waitForSharedContext } from "./monitor.js";
import { wechatKfOutbound } from "./outbound.js";
import { getRuntime } from "./runtime.js";
import { getAccessToken } from "./token.js";
import type { ResolvedWechatKfAccount } from "./types.js";

const meta = {
  id: "wechat-kf" as const,
  label: "WeChat KF",
  selectionLabel: "WeChat Customer Service (微信客服)",
  docsPath: "/channels/wechat-kf",
  docsLabel: "wechat-kf",
  blurb: "WeCom Customer Service (企业微信客服) API channel — let WeChat users chat with your agent.",
  aliases: ["wxkf"],
  order: 80,
};

export const wechatKfPlugin: ChannelPlugin<ResolvedWechatKfAccount> = {
  id: "wechat-kf",
  meta: { ...meta },

  capabilities: {
    chatTypes: ["direct"],
    media: true,
    reactions: false,
    threads: false,
    polls: false,
    nativeCommands: false,
    blockStreaming: false,
  },

  agentPrompt: {
    messageToolHints: () => [
      "- WeChat KF is direct-message only (1:1). Omit `target` to reply to current conversation.",
      "- Markdown (bold, italic, headings, lists, code blocks) is auto-converted to Unicode-styled plain text.",
      "- Long replies are auto-chunked at ~2000 chars; write naturally without manually splitting.",
      "- Outbound media: can send image (jpg/png/gif/bmp), video (mp4), and file attachments.",
      "- Voice messages require AMR format (\u22642MB, \u226460s). Other audio formats (mp3, wav, ogg) are sent as file attachments, not playable voice.",
      "- When generating or saving files for sending, prefer the agent workspace directory over /tmp.",
      "- Users may send: text, images, voice, video, files, locations, links, mini-programs, menu selections, forwarded chat history, \u89c6\u9891\u53f7 content, or business cards.",
      "",
      "### WeChat Rich Messages",
      "Embed directives in your reply to send rich messages (one per message):",
      "",
      "**Link Card**: `[[wechat_link: Title | Description | https://url | https://thumb-url]]`",
      "  title + url required; desc + thumbUrl optional. Without thumbUrl falls back to plain-text link.",
      "",
      "**Location**: `[[wechat_location: Place Name | Address | latitude | longitude]]`",
      "  name + coordinates required; address optional.",
      "",
      "**Mini Program**: `[[wechat_miniprogram: appid | Title | pages/path | https://thumb-url]]`",
      "  appid + title + pagepath required; thumbUrl optional but recommended (card won't display without it).",
      "",
      "**Menu**: `[[wechat_menu: Question text | Option1, Option2, Option3 | Footer text]]`",
      "  Presents clickable options to the user. Header required, options comma-separated, footer optional.",
      "",
      "**Business Card**: `[[wechat_business_card: USERID]]`",
      "  Sends a WeCom member's contact card. Requires \u300c\u5ba2\u6237\u8054\u7cfb\u300d permission. Customer must have actively messaged within 48h (menu clicks don't count). Max 1 card per 48h window.",
      "",
      "**Acquisition Link (\u83b7\u5ba2\u94fe\u63a5)**: `[[wechat_ca_link: https://work.weixin.qq.com/ca/...]]`",
      "  Sends a \u83b7\u5ba2\u94fe\u63a5 as a rich card. The URL must be a valid acquisition link.",
    ],
  },

  reload: { configPrefixes: ["channels.wechat-kf"] },

  configSchema: { schema: wechatKfConfigSchema },

  config: {
    listAccountIds: (cfg: OpenClawConfig) => listAccountIds(cfg),
    resolveAccount: (cfg: OpenClawConfig, accountId?: string | null) => resolveAccount(cfg, accountId ?? undefined),
    defaultAccountId: (cfg: OpenClawConfig) => listAccountIds(cfg)[0] ?? "default",
    setAccountEnabled: ({ cfg, accountId, enabled }: { cfg: OpenClawConfig; accountId: string; enabled: boolean }) => {
      if (enabled) {
        void enableKfId(accountId);
      } else {
        void disableKfId(accountId);
      }
      return cfg;
    },
    deleteAccount: ({ cfg, accountId }: { cfg: OpenClawConfig; accountId: string }) => {
      void deleteKfId(accountId);
      return cfg;
    },
    isConfigured: (account: ResolvedWechatKfAccount, _cfg: OpenClawConfig) => account.configured,
    describeAccount: (account: ResolvedWechatKfAccount, _cfg: OpenClawConfig): ChannelAccountSnapshot => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
    }),
    resolveAllowFrom: ({ cfg }: { cfg: OpenClawConfig; accountId?: string | null }) => {
      const config = getChannelConfig(cfg);
      return (config.allowFrom ?? []).map(String);
    },
    formatAllowFrom: ({
      allowFrom,
    }: {
      cfg: OpenClawConfig;
      accountId?: string | null;
      allowFrom: Array<string | number>;
    }) => allowFrom.map((e) => String(e).trim()).filter(Boolean),
  },

  security: {
    resolveDmPolicy: ({
      cfg,
    }: {
      cfg: OpenClawConfig;
      accountId?: string | null;
      account: ResolvedWechatKfAccount;
    }) => {
      const config = getChannelConfig(cfg);
      const policy = config.dmPolicy ?? "open";
      return {
        policy,
        allowFrom: config.allowFrom ?? [],
        allowFromPath: "channels.wechat-kf.allowFrom",
        approveHint: [
          "To approve a WeChat KF user, add their external_userid to the allowlist:",
          "  openclaw config set channels.wechat-kf.allowFrom '[\"{userid}\"]'",
        ].join("\n"),
        normalizeEntry: (raw: string) => raw.replace(/^user:/i, "").trim(),
      };
    },
    collectWarnings: ({
      cfg,
    }: {
      cfg: OpenClawConfig;
      accountId?: string | null;
      account: ResolvedWechatKfAccount;
    }) => {
      const config = getChannelConfig(cfg);
      const policy = config.dmPolicy ?? "open";
      if (policy === "open") {
        return ['- WeChat KF: dmPolicy="open" — any WeChat user can chat with the agent.'];
      }
      return [];
    },
  },

  setup: {
    resolveAccountId: ({ accountId }: { cfg: OpenClawConfig; accountId?: string }) => accountId ?? "default",
    applyAccountConfig: ({
      cfg,
      accountId: _accountId,
      input: _input,
    }: {
      cfg: OpenClawConfig;
      accountId: string;
      input: unknown;
    }) => {
      const config = getChannelConfig(cfg);
      return {
        ...cfg,
        channels: { ...(cfg.channels ?? {}), "wechat-kf": { ...config, enabled: true } },
      };
    },
  },

  outbound: wechatKfOutbound,

  status: {
    defaultRuntime: {
      accountId: "default",
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    buildChannelSummary: ({
      snapshot,
    }: {
      account: ResolvedWechatKfAccount;
      cfg: OpenClawConfig;
      defaultAccountId: string;
      snapshot: ChannelAccountSnapshot;
    }) => ({
      configured: snapshot.configured ?? false,
      running: snapshot.running ?? false,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastError: snapshot.lastError ?? null,
    }),
    buildAccountSnapshot: ({
      account,
      runtime,
    }: {
      account: ResolvedWechatKfAccount;
      cfg: OpenClawConfig;
      runtime?: ChannelAccountSnapshot;
    }): ChannelAccountSnapshot => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
      running: runtime?.running ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastError: runtime?.lastError ?? null,
    }),
  },

  gateway: {
    startAccount: async (ctx: ChannelGatewayContext<ResolvedWechatKfAccount>) => {
      const config = getChannelConfig(ctx.cfg);
      const pluginRuntime = getRuntime();
      const stateDir = pluginRuntime.state?.resolveStateDir?.() ?? `${homedir()}/.openclaw/state/wechat-kf`;

      if (ctx.accountId === "default") {
        // ── "default" account: enterprise-level shared infrastructure ──
        try {
          const { corpId, appSecret, token, encodingAESKey } = config;
          const webhookPath = config.webhookPath ?? "/wechat-kf";

          if (!corpId || !appSecret || !token || !encodingAESKey) {
            throw new Error("[wechat-kf] missing required config fields (corpId, appSecret, token, encodingAESKey)");
          }

          // Load previously discovered kfids
          await loadKfIds(stateDir);

          // Validate access token on startup (best-effort)
          try {
            await getAccessToken(corpId, appSecret);
            ctx.log?.info("[wechat-kf] access_token validated");
          } catch (err) {
            ctx.log?.warn(`[wechat-kf] access_token validation failed (will retry on first message): ${err}`);
          }

          const botCtx: BotContext = { cfg: ctx.cfg, runtime: ctx.runtime, stateDir, log: ctx.log };

          setSharedContext({
            callbackToken: token,
            encodingAESKey,
            corpId,
            appSecret,
            webhookPath,
            botCtx,
          });

          ctx.setStatus({ accountId: ctx.accountId, running: true, lastStartAt: Date.now() });
          ctx.log?.info(`[wechat-kf] shared context ready (webhook path: ${webhookPath})`);

          // Block until abort — framework expects long-lived promise
          await new Promise<void>((resolve) => {
            if (ctx.abortSignal.aborted) {
              resolve();
              return;
            }
            ctx.abortSignal.addEventListener("abort", () => resolve(), { once: true });
          });

          // Shutdown
          clearSharedContext();
          ctx.setStatus({
            accountId: ctx.accountId,
            running: false,
            lastStopAt: Date.now(),
          });
          ctx.log?.info("[wechat-kf] shared context cleared, default account stopped");
        } catch (err) {
          clearSharedContext();
          ctx.setStatus({
            accountId: ctx.accountId,
            running: false,
            lastError: formatError(err),
            lastStopAt: Date.now(),
          });
          ctx.log?.error(`[wechat-kf] default account failed: ${formatError(err)}`);
          throw err;
        }
      } else {
        // ── Per-kfId account: polling loop ──
        let pollTimer: ReturnType<typeof setInterval> | null = null;

        try {
          // Wait for the "default" account to set shared context
          const shared = await waitForSharedContext(ctx.abortSignal);

          ctx.setStatus({ accountId: ctx.accountId, running: true, lastStartAt: Date.now() });
          ctx.log?.info(`[wechat-kf:${ctx.accountId}] polling started`);

          // Start 30s polling loop
          const POLL_INTERVAL_MS = 30_000;
          let polling = false;

          pollTimer = setInterval(async () => {
            if (ctx.abortSignal.aborted) return;
            if (polling) return;
            polling = true;
            try {
              ctx.log?.debug?.(`[wechat-kf:${ctx.accountId}] polling sync_msg...`);
              await handleWebhookEvent(shared.botCtx, ctx.accountId, "");
            } catch (err) {
              ctx.log?.error(`[wechat-kf:${ctx.accountId}] poll error: ${formatError(err)}`);
            } finally {
              polling = false;
            }
          }, POLL_INTERVAL_MS);

          // Block until abort
          await new Promise<void>((resolve) => {
            if (ctx.abortSignal.aborted) {
              resolve();
              return;
            }
            ctx.abortSignal.addEventListener("abort", () => resolve(), { once: true });
          });

          // Cleanup
          if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
          }
          ctx.setStatus({
            accountId: ctx.accountId,
            running: false,
            lastStopAt: Date.now(),
          });
          ctx.log?.info(`[wechat-kf:${ctx.accountId}] polling stopped`);
        } catch (err) {
          if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
          }
          ctx.setStatus({
            accountId: ctx.accountId,
            running: false,
            lastError: formatError(err),
            lastStopAt: Date.now(),
          });

          // AbortError is expected when the signal fires before shared context is ready
          if (err instanceof DOMException && err.name === "AbortError") {
            ctx.log?.info(`[wechat-kf:${ctx.accountId}] aborted before shared context ready`);
            return;
          }

          ctx.log?.error(`[wechat-kf:${ctx.accountId}] startAccount failed: ${formatError(err)}`);
          throw err;
        }
      }
    },
  },
};
