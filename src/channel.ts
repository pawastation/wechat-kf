/**
 * WeChat KF ChannelPlugin implementation
 *
 * Dynamically discovers kfids from webhook callbacks.
 * Each kfid = one accountId = one independent session.
 */

import { homedir } from "node:os";
import { deleteKfId, disableKfId, enableKfId, getChannelConfig, listAccountIds, resolveAccount } from "./accounts.js";
import type { Logger } from "./bot.js";
import { wechatKfConfigSchema } from "./config-schema.js";
import { startMonitor } from "./monitor.js";
import { wechatKfOutbound } from "./outbound.js";
import type { PluginRuntime } from "./runtime.js";
import type { OpenClawConfig, ResolvedWechatKfAccount } from "./types.js";

// ── OpenClaw plugin interface types (minimal, based on actual usage) ──

type ChannelMeta = {
  id: string;
  label: string;
  selectionLabel: string;
  docsPath: string;
  docsLabel: string;
  blurb: string;
  aliases?: string[];
  order?: number;
};

type ChannelCapabilities = {
  chatTypes: string[];
  media: boolean;
  reactions: boolean;
  threads: boolean;
  polls: boolean;
  nativeCommands: boolean;
  blockStreaming: boolean;
};

type AccountRuntimeStatus = {
  accountId: string;
  running: boolean;
  lastStartAt: string | null;
  lastStopAt: string | null;
  lastError: string | null;
  port: number | null;
};

type GatewayContext = {
  cfg: OpenClawConfig;
  runtime?: PluginRuntime;
  abortSignal?: AbortSignal;
  accountId: string;
  log?: Logger;
  setStatus?: (status: Partial<AccountRuntimeStatus>) => void;
};

type ChannelPlugin<T = unknown> = {
  id: string;
  meta: ChannelMeta;
  capabilities: ChannelCapabilities;
  agentPrompt: { messageToolHints: () => string[] };
  reload: { configPrefixes: string[] };
  configSchema: { schema: unknown };
  config: {
    listAccountIds: (cfg: OpenClawConfig) => string[];
    resolveAccount: (cfg: OpenClawConfig, accountId?: string) => T;
    defaultAccountId: (cfg: OpenClawConfig) => string;
    setAccountEnabled: (opts: { cfg: OpenClawConfig; accountId: string; enabled: boolean }) => OpenClawConfig;
    deleteAccount: (opts: { cfg: OpenClawConfig; accountId: string }) => OpenClawConfig;
    isConfigured: (account: T) => boolean;
    describeAccount: (account: T) => Record<string, unknown>;
    resolveAllowFrom: (opts: { cfg: OpenClawConfig }) => string[];
    formatAllowFrom: (opts: { allowFrom: string[] }) => string[];
  };
  security: {
    resolveDmPolicy: (opts: { cfg: OpenClawConfig }) => Record<string, unknown>;
    collectWarnings: (opts: { cfg: OpenClawConfig }) => string[];
  };
  setup: {
    resolveAccountId: (cfg: OpenClawConfig, accountId?: string) => string;
    applyAccountConfig: (opts: { cfg: OpenClawConfig; accountId: string }) => OpenClawConfig;
  };
  outbound: typeof wechatKfOutbound;
  status: {
    defaultRuntime: AccountRuntimeStatus;
    buildChannelSummary: (opts: { snapshot: Record<string, unknown> }) => Record<string, unknown>;
    buildAccountSnapshot: (opts: {
      account: T;
      runtime: Partial<AccountRuntimeStatus> | null;
    }) => Record<string, unknown>;
  };
  gateway: {
    _started: boolean;
    startAccount: (ctx: GatewayContext) => Promise<void>;
  };
};

const meta: ChannelMeta = {
  id: "wechat-kf",
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
    ],
  },

  reload: { configPrefixes: ["channels.wechat-kf"] },

  configSchema: { schema: wechatKfConfigSchema },

  config: {
    listAccountIds: (cfg: OpenClawConfig) => listAccountIds(cfg),
    resolveAccount: (cfg: OpenClawConfig, accountId?: string) => resolveAccount(cfg, accountId),
    defaultAccountId: (cfg: OpenClawConfig) => listAccountIds(cfg)[0] ?? "default",
    setAccountEnabled: ({ cfg, accountId, enabled }: { cfg: OpenClawConfig; accountId: string; enabled: boolean }) => {
      // Dynamic accounts — toggle via in-memory disabled set (persisted to disk).
      // Fire-and-forget: the async persist is best-effort; the in-memory state
      // takes effect immediately so the framework sees the change right away.
      if (enabled) {
        void enableKfId(accountId);
      } else {
        void disableKfId(accountId);
      }
      return cfg;
    },
    deleteAccount: ({ cfg, accountId }: { cfg: OpenClawConfig; accountId: string }) => {
      // Remove from discovered set and add to disabled set so it won't come
      // back from future webhook callbacks. Fire-and-forget for persistence.
      void deleteKfId(accountId);
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
    resolveAllowFrom: ({ cfg }: { cfg: OpenClawConfig }) => {
      const config = getChannelConfig(cfg);
      return (config.allowFrom ?? []).map(String);
    },
    formatAllowFrom: ({ allowFrom }: { allowFrom: string[] }) => allowFrom.map((e: string) => e.trim()).filter(Boolean),
  },

  security: {
    resolveDmPolicy: ({ cfg }: { cfg: OpenClawConfig }) => {
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
    collectWarnings: ({ cfg }: { cfg: OpenClawConfig }) => {
      const config = getChannelConfig(cfg);
      const policy = config.dmPolicy ?? "open";
      if (policy === "open") {
        return ['- WeChat KF: dmPolicy="open" — any WeChat user can chat with the agent.'];
      }
      return [];
    },
  },

  setup: {
    resolveAccountId: (_cfg: OpenClawConfig, accountId?: string) => accountId ?? "default",
    applyAccountConfig: ({ cfg }: { cfg: OpenClawConfig; accountId: string }) => {
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
      port: null,
    },
    buildChannelSummary: ({ snapshot }: { snapshot: Record<string, unknown> }) => ({
      configured: (snapshot.configured as boolean) ?? false,
      running: (snapshot.running as boolean) ?? false,
      lastStartAt: (snapshot.lastStartAt as string | null) ?? null,
      lastError: (snapshot.lastError as string | null) ?? null,
      port: (snapshot.port as number | null) ?? null,
    }),
    buildAccountSnapshot: ({
      account,
      runtime,
    }: {
      account: ResolvedWechatKfAccount;
      runtime: Partial<AccountRuntimeStatus> | null;
    }) => ({
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
    /** Track whether the account is currently started to prevent duplicate launches. */
    _started: false,

    startAccount: async (ctx: GatewayContext) => {
      const self = wechatKfPlugin.gateway;

      // Idempotency guard — skip if already started
      if (self._started) {
        ctx.log?.info("[wechat-kf] startAccount: already running, skipping duplicate call");
        return;
      }

      const config = getChannelConfig(ctx.cfg);
      const port = config.webhookPort ?? 9999;
      const path = config.webhookPath ?? "/wechat-kf";

      try {
        self._started = true;

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
      } catch (err) {
        self._started = false;

        ctx.setStatus?.({
          accountId: ctx.accountId,
          port,
          running: false,
          lastError: err instanceof Error ? err.message : String(err),
          lastStopAt: new Date().toISOString(),
        });
        ctx.log?.error?.(`[wechat-kf] startAccount failed: ${err instanceof Error ? err.message : String(err)}`);

        throw err;
      }
    },
  },
};
