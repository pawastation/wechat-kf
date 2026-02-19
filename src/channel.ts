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
      "- WeChat KF: omit `target` to reply to current conversation.",
      "- Supports text and media messages (image, voice, video, file).",
      "- 48h reply window, max 5 replies per window.",
      "- To send a rich link card, include `[[wechat_link: title | desc | url | thumbUrl]]` in your reply. Fields: title (required), desc (optional), url (required, must be https://), thumbUrl (optional, thumbnail image URL). Example: `[[wechat_link: Article Title | Brief description | https://example.com/article | https://example.com/thumb.jpg]]`",
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
            ctx.log?.warn?.(`[wechat-kf] access_token validation failed (will retry on first message): ${err}`);
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
            lastError: err instanceof Error ? err.message : String(err),
            lastStopAt: Date.now(),
          });
          ctx.log?.error?.(`[wechat-kf] default account failed: ${err instanceof Error ? err.message : String(err)}`);
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
              ctx.log?.error?.(
                `[wechat-kf:${ctx.accountId}] poll error: ${err instanceof Error ? err.stack || err.message : err}`,
              );
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
            lastError: err instanceof Error ? err.message : String(err),
            lastStopAt: Date.now(),
          });

          // AbortError is expected when the signal fires before shared context is ready
          if (err instanceof DOMException && err.name === "AbortError") {
            ctx.log?.info(`[wechat-kf:${ctx.accountId}] aborted before shared context ready`);
            return;
          }

          ctx.log?.error?.(
            `[wechat-kf:${ctx.accountId}] startAccount failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          throw err;
        }
      }
    },
  },
};
