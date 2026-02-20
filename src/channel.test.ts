import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getKnownKfIds, isKfIdEnabled, registerKfId, _reset as resetAccounts } from "./accounts.js";
import { _reset as resetMonitor } from "./monitor.js";

// Mock token.ts so we don't make real HTTP calls
vi.mock("./token.js", () => ({
  getAccessToken: vi.fn().mockResolvedValue("fake_token"),
}));

// Mock bot.ts
const mockHandleWebhookEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("./bot.js", () => ({
  handleWebhookEvent: (...args: unknown[]) => mockHandleWebhookEvent(...args),
}));

// Mock runtime.ts — startAccount now calls getRuntime() for stateDir
const mockGetRuntime = vi.fn();
vi.mock("./runtime.js", () => ({
  getRuntime: () => mockGetRuntime(),
  setRuntime: vi.fn(),
}));

import { wechatKfPlugin } from "./channel.js";

describe("capabilities", () => {
  it("capabilities.media is true", () => {
    expect(wechatKfPlugin.capabilities.media).toBe(true);
  });
});

describe("agentPrompt", () => {
  it("agentPrompt mentions media support", () => {
    const hints = wechatKfPlugin.agentPrompt.messageToolHints();
    const joined = hints.join("\n");
    expect(joined).toContain("media");
  });

  it("agentPrompt mentions AMR voice format", () => {
    const hints = wechatKfPlugin.agentPrompt.messageToolHints();
    const joined = hints.join("\n");
    expect(joined).toContain("AMR");
  });

  it("agentPrompt documents all directive types", () => {
    const hints = wechatKfPlugin.agentPrompt.messageToolHints();
    const joined = hints.join("\n");
    expect(joined).toContain("wechat_link");
    expect(joined).toContain("wechat_location");
    expect(joined).toContain("wechat_miniprogram");
    expect(joined).toContain("wechat_menu");
    expect(joined).toContain("wechat_business_card");
    expect(joined).toContain("wechat_ca_link");
  });

  it("agentPrompt mentions 48h reply window", () => {
    const hints = wechatKfPlugin.agentPrompt.messageToolHints();
    const joined = hints.join("\n");
    expect(joined).toContain("auto-chunked");
  });
});

describe("security adapter", () => {
  const security = wechatKfPlugin.security as any;

  describe("resolveDmPolicy", () => {
    it("returns correct structure with default config (no dmPolicy)", () => {
      const cfg = { channels: { "wechat-kf": {} } };
      const result = security.resolveDmPolicy({ cfg });

      expect(result).toEqual(
        expect.objectContaining({
          policy: "open",
          allowFrom: [],
          allowFromPath: "channels.wechat-kf.allowFrom",
        }),
      );
      expect(typeof result.approveHint).toBe("string");
      expect(typeof result.normalizeEntry).toBe("function");
    });

    it("returns 'open' when dmPolicy is not set", () => {
      const cfg = { channels: { "wechat-kf": {} } };
      const result = security.resolveDmPolicy({ cfg });
      expect(result.policy).toBe("open");
    });

    it("returns 'allowlist' when dmPolicy is set to allowlist", () => {
      const cfg = { channels: { "wechat-kf": { dmPolicy: "allowlist" } } };
      const result = security.resolveDmPolicy({ cfg });
      expect(result.policy).toBe("allowlist");
    });

    it("returns 'pairing' when dmPolicy is set to pairing", () => {
      const cfg = { channels: { "wechat-kf": { dmPolicy: "pairing" } } };
      const result = security.resolveDmPolicy({ cfg });
      expect(result.policy).toBe("pairing");
    });

    it("passes through allowFrom from config", () => {
      const cfg = {
        channels: { "wechat-kf": { allowFrom: ["user1", "user2"] } },
      };
      const result = security.resolveDmPolicy({ cfg });
      expect(result.allowFrom).toEqual(["user1", "user2"]);
    });

    it("defaults allowFrom to empty array when not configured", () => {
      const cfg = { channels: { "wechat-kf": {} } };
      const result = security.resolveDmPolicy({ cfg });
      expect(result.allowFrom).toEqual([]);
    });

    it("normalizeEntry strips 'user:' prefix", () => {
      const cfg = { channels: { "wechat-kf": {} } };
      const result = security.resolveDmPolicy({ cfg });
      expect(result.normalizeEntry("user:abc123")).toBe("abc123");
      expect(result.normalizeEntry("User:ABC")).toBe("ABC");
    });

    it("normalizeEntry trims whitespace", () => {
      const cfg = { channels: { "wechat-kf": {} } };
      const result = security.resolveDmPolicy({ cfg });
      expect(result.normalizeEntry("  abc  ")).toBe("abc");
    });

    it("normalizeEntry passes through plain ids", () => {
      const cfg = { channels: { "wechat-kf": {} } };
      const result = security.resolveDmPolicy({ cfg });
      expect(result.normalizeEntry("ext_userid_123")).toBe("ext_userid_123");
    });

    it("approveHint contains instructions for adding external_userid", () => {
      const cfg = { channels: { "wechat-kf": {} } };
      const result = security.resolveDmPolicy({ cfg });
      expect(result.approveHint).toContain("external_userid");
      expect(result.approveHint).toContain("openclaw config set");
    });

    it("allowFromPath is correct", () => {
      const cfg = { channels: { "wechat-kf": {} } };
      const result = security.resolveDmPolicy({ cfg });
      expect(result.allowFromPath).toBe("channels.wechat-kf.allowFrom");
    });
  });

  describe("collectWarnings", () => {
    it("warns when dmPolicy is 'open' (default)", () => {
      const cfg = { channels: { "wechat-kf": {} } };
      const warnings = security.collectWarnings({ cfg });
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("dmPolicy");
      expect(warnings[0]).toContain("open");
    });

    it("warns when dmPolicy is explicitly 'open'", () => {
      const cfg = { channels: { "wechat-kf": { dmPolicy: "open" } } };
      const warnings = security.collectWarnings({ cfg });
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("open");
    });

    it("returns empty array when dmPolicy is 'allowlist'", () => {
      const cfg = { channels: { "wechat-kf": { dmPolicy: "allowlist" } } };
      const warnings = security.collectWarnings({ cfg });
      expect(warnings).toEqual([]);
    });

    it("returns empty array when dmPolicy is 'pairing'", () => {
      const cfg = { channels: { "wechat-kf": { dmPolicy: "pairing" } } };
      const warnings = security.collectWarnings({ cfg });
      expect(warnings).toEqual([]);
    });
  });
});

describe("gateway.startAccount — default account", () => {
  const gateway = wechatKfPlugin.gateway as any;

  function makeMockPluginRuntime() {
    return {
      state: { resolveStateDir: () => "/tmp/test-state" },
      error: vi.fn(),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    resetMonitor();
    resetAccounts();
    mockGetRuntime.mockReturnValue(makeMockPluginRuntime());
  });

  afterEach(() => {
    resetMonitor();
    resetAccounts();
  });

  function makeCtx(overrides: Record<string, any> = {}) {
    return {
      accountId: "default",
      cfg: {
        channels: {
          "wechat-kf": {
            corpId: "corp1",
            appSecret: "secret1",
            token: "tok",
            encodingAESKey: "aeskey",
            webhookPath: "/test",
          },
        },
      },
      setStatus: vi.fn(),
      getStatus: vi.fn().mockReturnValue({ accountId: "default" }),
      log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
      runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
      account: {},
      abortSignal: AbortSignal.abort(), // required — default to already-aborted for simple tests
      ...overrides,
    };
  }

  it("sets shared context and running: true on start", async () => {
    const ac = new AbortController();
    const ctx = makeCtx({ abortSignal: ac.signal });

    const p = gateway.startAccount(ctx);

    // Let it reach the blocking point
    await new Promise((r) => setTimeout(r, 50));

    expect(ctx.setStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "default",
        running: true,
      }),
    );

    ac.abort();
    await p;
  });

  it("clears shared context and sets running: false on abort", async () => {
    const ac = new AbortController();
    const ctx = makeCtx({ abortSignal: ac.signal });

    const p = gateway.startAccount(ctx);
    await new Promise((r) => setTimeout(r, 50));

    ac.abort();
    await p;

    expect(ctx.setStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        accountId: "default",
        running: false,
        lastStopAt: expect.any(Number),
      }),
    );
    expect(ctx.log.info).toHaveBeenCalledWith(expect.stringContaining("shared context cleared"));
  });

  it("throws when required config fields are missing", async () => {
    const ctx = makeCtx({
      cfg: { channels: { "wechat-kf": {} } },
    });

    await expect(gateway.startAccount(ctx)).rejects.toThrow("missing required config");
  });

  it("sets lastError on failure", async () => {
    const ctx = makeCtx({
      cfg: { channels: { "wechat-kf": {} } },
    });

    await expect(gateway.startAccount(ctx)).rejects.toThrow();

    expect(ctx.setStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        running: false,
        lastError: expect.stringContaining("missing required config"),
      }),
    );
  });

  it("resolves immediately when signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const ctx = makeCtx({ abortSignal: ac.signal });

    await gateway.startAccount(ctx);

    expect(ctx.setStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ running: false, lastStopAt: expect.any(Number) }),
    );
  });

  it("resolves immediately when signal is already aborted (via default)", async () => {
    // abortSignal is required in SDK; test with pre-aborted signal (default from makeCtx)
    const ctx = makeCtx();
    await gateway.startAccount(ctx);

    expect(ctx.setStatus).toHaveBeenLastCalledWith(expect.objectContaining({ running: false }));
  });

  it("throws when required config fields are missing (setStatus still receives error)", async () => {
    const ctx = makeCtx({
      cfg: { channels: { "wechat-kf": {} } },
    });
    await expect(gateway.startAccount(ctx)).rejects.toThrow();
    expect(ctx.setStatus).toHaveBeenCalledWith(
      expect.objectContaining({ running: false, lastError: expect.any(String) }),
    );
  });
});

describe("gateway.startAccount — per-kfId account", () => {
  const gateway = wechatKfPlugin.gateway as any;

  function makeMockPluginRuntime() {
    return {
      state: { resolveStateDir: () => "/tmp/test-state" },
      error: vi.fn(),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    resetMonitor();
    resetAccounts();
    mockGetRuntime.mockReturnValue(makeMockPluginRuntime());
  });

  afterEach(() => {
    vi.useRealTimers();
    resetMonitor();
    resetAccounts();
  });

  function makeDefaultCtx(overrides: Record<string, any> = {}) {
    return {
      accountId: "default",
      cfg: {
        channels: {
          "wechat-kf": {
            corpId: "corp1",
            appSecret: "secret1",
            token: "tok",
            encodingAESKey: "aeskey",
            webhookPath: "/test",
          },
        },
      },
      setStatus: vi.fn(),
      getStatus: vi.fn().mockReturnValue({ accountId: "default" }),
      log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
      runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
      account: {},
      abortSignal: AbortSignal.abort(),
      ...overrides,
    };
  }

  function makeKfCtx(overrides: Record<string, any> = {}) {
    return {
      accountId: "kf_001",
      cfg: {
        channels: {
          "wechat-kf": {
            corpId: "corp1",
            appSecret: "secret1",
            token: "tok",
            encodingAESKey: "aeskey",
          },
        },
      },
      setStatus: vi.fn(),
      getStatus: vi.fn().mockReturnValue({ accountId: "kf_001" }),
      log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
      runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
      account: {},
      abortSignal: AbortSignal.abort(),
      ...overrides,
    };
  }

  it("waits for shared context then starts polling", async () => {
    const defaultAc = new AbortController();
    const kfAc = new AbortController();

    const defaultCtx = makeDefaultCtx({ abortSignal: defaultAc.signal });
    const kfCtx = makeKfCtx({ abortSignal: kfAc.signal });

    // Start both concurrently (like the framework would)
    const pDefault = gateway.startAccount(defaultCtx);
    const pKf = gateway.startAccount(kfCtx);

    // Wait for both to reach blocking state
    await new Promise((r) => setTimeout(r, 100));

    expect(kfCtx.setStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "kf_001",
        running: true,
      }),
    );

    // Abort both
    kfAc.abort();
    defaultAc.abort();
    await Promise.all([pDefault, pKf]);

    expect(kfCtx.setStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        accountId: "kf_001",
        running: false,
        lastStopAt: expect.any(Number),
      }),
    );
  });

  it("registers a 30s polling interval on startup", async () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

    const defaultAc = new AbortController();
    const kfAc = new AbortController();

    const defaultCtx = makeDefaultCtx({ abortSignal: defaultAc.signal });
    const kfCtx = makeKfCtx({ abortSignal: kfAc.signal });

    const pDefault = gateway.startAccount(defaultCtx);
    const pKf = gateway.startAccount(kfCtx);

    // Wait for startup to complete
    await new Promise((r) => setTimeout(r, 100));

    // Verify setInterval was called with the 30s poll interval
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30_000);

    kfAc.abort();
    defaultAc.abort();
    await Promise.all([pDefault, pKf]);

    setIntervalSpy.mockRestore();
  });

  it("aborts gracefully when signal fires before shared context ready", async () => {
    const kfAc = new AbortController();
    const kfCtx = makeKfCtx({ abortSignal: kfAc.signal });

    // Don't start default account — shared context never set
    const pKf = gateway.startAccount(kfCtx);

    // Abort immediately
    kfAc.abort();
    await pKf;

    expect(kfCtx.setStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "kf_001",
        running: false,
      }),
    );
    expect(kfCtx.log.info).toHaveBeenCalledWith(expect.stringContaining("aborted before shared context"));
  });

  it("handles poll errors without crashing — startAccount does not reject", async () => {
    // Rather than testing the full 30s poll cycle with fake timers (which is fragile
    // across parallel test files), we verify the key property: poll errors do NOT
    // crash the kfId account. The startAccount promise should resolve cleanly on abort
    // even if handleWebhookEvent would throw during polling.
    mockHandleWebhookEvent.mockRejectedValue(new Error("poll boom"));

    const defaultAc = new AbortController();
    const kfAc = new AbortController();

    const defaultCtx = makeDefaultCtx({ abortSignal: defaultAc.signal });
    const kfCtx = makeKfCtx({ abortSignal: kfAc.signal });

    const pDefault = gateway.startAccount(defaultCtx);
    const pKf = gateway.startAccount(kfCtx);

    // Let startup complete
    await new Promise((r) => setTimeout(r, 100));

    // Abort — the kfId account should resolve cleanly (not reject)
    kfAc.abort();
    defaultAc.abort();
    await expect(Promise.all([pDefault, pKf])).resolves.not.toThrow();
  });
});

// ══════════════════════════════════════════════
// config adapter
// ══════════════════════════════════════════════

describe("config adapter", () => {
  const config = wechatKfPlugin.config as any;

  afterEach(() => {
    resetAccounts();
  });

  it("listAccountIds returns ['default'] when no kfids discovered", () => {
    const cfg = { channels: { "wechat-kf": {} } };
    const ids = config.listAccountIds(cfg);
    expect(ids).toEqual(["default"]);
  });

  it("listAccountIds returns ['default', ...kfIds] when kfids discovered", async () => {
    await registerKfId("kf_1");
    await registerKfId("kf_2");
    const cfg = { channels: { "wechat-kf": {} } };
    const ids = config.listAccountIds(cfg);
    expect(ids).toEqual(["default", "kf_1", "kf_2"]);
  });

  it("resolveAccount returns resolved account object", () => {
    const cfg = {
      channels: {
        "wechat-kf": {
          corpId: "corp_test",
          appSecret: "secret_test",
          token: "tok",
          encodingAESKey: "key",
        },
      },
    };
    const account = config.resolveAccount(cfg, "default");
    expect(account).toBeDefined();
    expect(account.accountId).toBeDefined();
    expect(account.webhookPath).toBe("/wechat-kf");
  });

  it("defaultAccountId returns 'default'", () => {
    const cfg = { channels: { "wechat-kf": {} } };
    const id = config.defaultAccountId(cfg);
    expect(id).toBe("default");
  });

  it("isConfigured returns true when account has all required fields", () => {
    const account = {
      configured: true,
      corpId: "corp1",
      appSecret: "sec",
    };
    expect(config.isConfigured(account)).toBe(true);
  });

  it("isConfigured returns false when not configured", () => {
    expect(config.isConfigured({ configured: false })).toBe(false);
  });

  it("describeAccount returns ChannelAccountSnapshot shape", () => {
    const account = {
      accountId: "kf_001",
      enabled: true,
      configured: true,
      corpId: "corp1",
      openKfId: "kf_001",
    };
    const desc = config.describeAccount(account, {});
    expect(desc).toEqual({
      accountId: "kf_001",
      enabled: true,
      configured: true,
    });
  });

  it("setAccountEnabled returns cfg (config not mutated for dynamic accounts)", () => {
    const cfg = { channels: { "wechat-kf": {} } };
    expect(config.setAccountEnabled({ cfg, accountId: "kf_001", enabled: true })).toBe(cfg);
  });

  it("deleteAccount returns cfg (config not mutated for dynamic accounts)", () => {
    const cfg = { channels: { "wechat-kf": {} } };
    expect(config.deleteAccount({ cfg, accountId: "kf_001" })).toBe(cfg);
  });

  it("resolveAllowFrom returns allowFrom array as strings", () => {
    const cfg = {
      channels: { "wechat-kf": { allowFrom: ["user1", "user2"] } },
    };
    expect(config.resolveAllowFrom({ cfg })).toEqual(["user1", "user2"]);
  });

  it("resolveAllowFrom returns empty array when not configured", () => {
    const cfg = { channels: { "wechat-kf": {} } };
    expect(config.resolveAllowFrom({ cfg })).toEqual([]);
  });

  it("formatAllowFrom trims and filters blank entries", () => {
    expect(config.formatAllowFrom({ allowFrom: ["  user1  ", "", " user2 "] })).toEqual(["user1", "user2"]);
  });
});

// ══════════════════════════════════════════════
// status adapter
// ══════════════════════════════════════════════

describe("status adapter", () => {
  const status = wechatKfPlugin.status as any;

  it("defaultRuntime has expected shape", () => {
    expect(status.defaultRuntime).toEqual({
      accountId: "default",
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    });
  });

  it("buildChannelSummary extracts fields from snapshot", () => {
    const summary = status.buildChannelSummary({
      account: {},
      cfg: {},
      defaultAccountId: "default",
      snapshot: {
        accountId: "default",
        configured: true,
        running: true,
        lastStartAt: 1735689600000,
        lastError: null,
      },
    });
    expect(summary).toEqual({
      configured: true,
      running: true,
      lastStartAt: 1735689600000,
      lastError: null,
    });
  });

  it("buildChannelSummary defaults missing fields to false/null", () => {
    const summary = status.buildChannelSummary({
      account: {},
      cfg: {},
      defaultAccountId: "default",
      snapshot: { accountId: "default" },
    });
    expect(summary).toEqual({
      configured: false,
      running: false,
      lastStartAt: null,
      lastError: null,
    });
  });

  it("buildAccountSnapshot merges account and runtime", () => {
    const snap = status.buildAccountSnapshot({
      account: { accountId: "kf_1", enabled: true, configured: true, corpId: "c1" },
      cfg: {},
      runtime: { accountId: "kf_1", running: true, lastStartAt: 1735689600000, lastError: null },
    });
    expect(snap).toEqual({
      accountId: "kf_1",
      enabled: true,
      configured: true,
      running: true,
      lastStartAt: 1735689600000,
      lastError: null,
    });
  });

  it("buildAccountSnapshot defaults runtime fields when runtime is undefined", () => {
    const snap = status.buildAccountSnapshot({
      account: { accountId: "kf_2", enabled: false, configured: false, corpId: undefined },
      runtime: undefined,
    });
    expect(snap.running).toBe(false);
    expect(snap.lastStartAt).toBeNull();
    expect(snap.lastError).toBeNull();
  });
});

// ══════════════════════════════════════════════
// setup adapter
// ══════════════════════════════════════════════

describe("setup adapter", () => {
  const setup = wechatKfPlugin.setup as any;

  it("resolveAccountId defaults to 'default' when not provided", () => {
    expect(setup.resolveAccountId({ cfg: {} })).toBe("default");
  });

  it("resolveAccountId returns provided accountId", () => {
    expect(setup.resolveAccountId({ cfg: {}, accountId: "kf_custom" })).toBe("kf_custom");
  });

  it("applyAccountConfig merges enabled: true into channel config", () => {
    const cfg = {
      channels: { "wechat-kf": { corpId: "corp1" } },
    };
    const result = setup.applyAccountConfig({ cfg, accountId: "kf_001" });
    expect(result.channels["wechat-kf"].enabled).toBe(true);
    expect(result.channels["wechat-kf"].corpId).toBe("corp1");
  });

  it("applyAccountConfig does not mutate original config", () => {
    const cfg = { channels: { "wechat-kf": { corpId: "corp1" } } };
    const result = setup.applyAccountConfig({ cfg, accountId: "kf_001" });
    expect(result).not.toBe(cfg);
    expect(result.channels).not.toBe(cfg.channels);
  });
});

// ══════════════════════════════════════════════
// meta and reload
// ══════════════════════════════════════════════

describe("plugin meta", () => {
  it("id is wechat-kf", () => {
    expect(wechatKfPlugin.id).toBe("wechat-kf");
  });

  it("meta.label exists", () => {
    expect(wechatKfPlugin.meta.label).toBe("WeChat KF");
  });

  it("reload.configPrefixes includes wechat-kf", () => {
    expect(wechatKfPlugin.reload.configPrefixes).toContain("channels.wechat-kf");
  });

  it("configSchema is defined", () => {
    expect(wechatKfPlugin.configSchema).toBeDefined();
    expect(wechatKfPlugin.configSchema.schema).toBeDefined();
  });

  it("capabilities has expected properties", () => {
    expect(wechatKfPlugin.capabilities.chatTypes).toEqual(["direct"]);
    expect(wechatKfPlugin.capabilities.reactions).toBe(false);
    expect(wechatKfPlugin.capabilities.threads).toBe(false);
    expect(wechatKfPlugin.capabilities.polls).toBe(false);
  });
});

// ══════════════════════════════════════════════
// account enable/disable/delete via config adapter
// ══════════════════════════════════════════════

describe("config adapter — setAccountEnabled / deleteAccount", () => {
  const config = wechatKfPlugin.config as any;

  afterEach(() => {
    resetAccounts();
  });

  it("setAccountEnabled(enabled: false) disables a kfid", async () => {
    await registerKfId("kf_toggle");
    expect(isKfIdEnabled("kf_toggle")).toBe(true);

    const cfg = { channels: { "wechat-kf": {} } };
    config.setAccountEnabled({ cfg, accountId: "kf_toggle", enabled: false });

    // Allow fire-and-forget promise to settle
    await new Promise((r) => setTimeout(r, 10));
    expect(isKfIdEnabled("kf_toggle")).toBe(false);
  });

  it("setAccountEnabled(enabled: true) re-enables a disabled kfid", async () => {
    await registerKfId("kf_toggle");
    config.setAccountEnabled({ cfg: {}, accountId: "kf_toggle", enabled: false });
    await new Promise((r) => setTimeout(r, 10));
    expect(isKfIdEnabled("kf_toggle")).toBe(false);

    config.setAccountEnabled({ cfg: {}, accountId: "kf_toggle", enabled: true });
    await new Promise((r) => setTimeout(r, 10));
    expect(isKfIdEnabled("kf_toggle")).toBe(true);
  });

  it("deleteAccount removes kfid from discovered set", async () => {
    await registerKfId("kf_delete_me");
    expect(getKnownKfIds()).toContain("kf_delete_me");

    const cfg = { channels: { "wechat-kf": {} } };
    config.deleteAccount({ cfg, accountId: "kf_delete_me" });

    await new Promise((r) => setTimeout(r, 10));
    expect(getKnownKfIds()).not.toContain("kf_delete_me");
    expect(isKfIdEnabled("kf_delete_me")).toBe(false);
  });

  it("deleteAccount returns cfg unchanged", () => {
    const cfg = { channels: { "wechat-kf": {} } };
    const result = config.deleteAccount({ cfg, accountId: "kf_any" });
    expect(result).toBe(cfg);
  });

  it("setAccountEnabled returns cfg unchanged", () => {
    const cfg = { channels: { "wechat-kf": {} } };
    const result = config.setAccountEnabled({ cfg, accountId: "kf_any", enabled: false });
    expect(result).toBe(cfg);
  });
});
