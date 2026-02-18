/**
 * WeChat KF ChannelPlugin implementation
 *
 * Dynamically discovers kfids from webhook callbacks.
 * Each kfid = one accountId = one independent session.
 */

import { homedir } from "node:os";
import type { ResolvedWechatKfAccount } from "./types.js";
import { getChannelConfig, listAccountIds, resolveAccount } from "./accounts.js";
import { wechatKfOutbound } from "./outbound.js";
import { wechatKfConfigSchema } from "./config-schema.js";
import { startMonitor } from "./monitor.js";

type ChannelMeta = Record<string, any>;
type ChannelPlugin<T = any> = Record<string, any> & { id: string };
type ClawdbotConfig = Record<string, any>;

const meta: ChannelMeta = {
  id: "wechat-kf",
  label: "WeChat KF",
  selectionLabel: "WeChat Customer Service (微信客服)",
  docsPath: "/channels/wechat-kf",
  docsLabel: "wechat-kf",
  blurb: "企业微信客服 API channel — let WeChat users chat with your agent.",
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
    ],
  },

  reload: { configPrefixes: ["channels.wechat-kf"] },

  configSchema: { schema: wechatKfConfigSchema },

  config: {
    listAccountIds: (cfg: ClawdbotConfig) => listAccountIds(cfg),
    resolveAccount: (cfg: ClawdbotConfig, accountId?: string) => resolveAccount(cfg, accountId),
    defaultAccountId: (cfg: ClawdbotConfig) => listAccountIds(cfg)[0] ?? "default",
    setAccountEnabled: ({ cfg, accountId, enabled }: any) => {
      // Dynamic accounts — no config mutation needed
      return cfg;
    },
    deleteAccount: ({ cfg, accountId }: any) => {
      // Dynamic accounts — no config mutation needed
      return cfg;
    },
    isConfigured: (account: ResolvedWechatKfAccount) => account.configured,
    describeAccount: (account: ResolvedWechatKfAccount) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
      corpId: account.corpId,
      openKfId: account.openKfId,
    }),
    resolveAllowFrom: ({ cfg }: any) => {
      const config = getChannelConfig(cfg);
      return (config.allowFrom ?? []).map(String);
    },
    formatAllowFrom: ({ allowFrom }: any) => allowFrom.map((e: string) => e.trim()).filter(Boolean),
  },

  security: {
    resolveDmPolicy: ({ cfg }: any) => {
      const config = getChannelConfig(cfg);
      const policy = config.dmPolicy ?? "open";
      return {
        policy,
        allowFrom: config.allowFrom ?? [],
        allowFromPath: "channels.wechat-kf.allowFrom",
        approveHint: [
          "To approve a WeChat KF user, add their external_userid to the allowlist:",
          '  openclaw config set channels.wechat-kf.allowFrom \'["{userid}"]\'',
        ].join("\n"),
        normalizeEntry: (raw: string) => raw.replace(/^user:/i, "").trim(),
      };
    },
    collectWarnings: ({ cfg }: any) => {
      const config = getChannelConfig(cfg);
      const policy = config.dmPolicy ?? "open";
      if (policy === "open") {
        return ["- WeChat KF: dmPolicy=\"open\" — any WeChat user can chat with the agent."];
      }
      return [];
    },
  },

  setup: {
    resolveAccountId: (_cfg: any, accountId?: string) => accountId ?? "default",
    applyAccountConfig: ({ cfg, accountId }: any) => {
      const config = getChannelConfig(cfg);
      return {
        ...cfg,
        channels: { ...cfg.channels, "wechat-kf": { ...config, enabled: true } },
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
      port: null,
    },
    buildChannelSummary: ({ snapshot }: any) => ({
      configured: snapshot.configured ?? false,
      running: snapshot.running ?? false,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastError: snapshot.lastError ?? null,
      port: snapshot.port ?? null,
    }),
    buildAccountSnapshot: ({ account, runtime }: any) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
      corpId: account.corpId,
      running: runtime?.running ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastError: runtime?.lastError ?? null,
      port: runtime?.port ?? null,
    }),
  },

  gateway: {
    startAccount: async (ctx: any) => {
      const config = getChannelConfig(ctx.cfg);
      const port = config.webhookPort ?? 9999;
      const path = config.webhookPath ?? "/wechat-kf";

      ctx.setStatus?.({ accountId: ctx.accountId, port, running: true, lastStartAt: new Date().toISOString() });
      ctx.log?.info(`[wechat-kf] starting on :${port}${path}`);

      const stateDir = ctx.runtime?.state?.resolveStateDir?.() ?? `${homedir()}/.openclaw/state/wechat-kf`;

      await startMonitor({
        cfg: ctx.cfg,
        runtime: ctx.runtime,
        abortSignal: ctx.abortSignal,
        stateDir,
        log: ctx.log,
      });
    },
  },
};
