import { describe, it, expect, vi, beforeEach } from "vitest";
import { wechatKfPlugin } from "./channel.js";

// Mock startMonitor so gateway tests don't open real servers
vi.mock("./monitor.js", () => ({
  startMonitor: vi.fn(),
}));

describe("capabilities", () => {
  it("capabilities.media is true", () => {
    expect(wechatKfPlugin.capabilities.media).toBe(true);
  });
});

describe("agentPrompt", () => {
  it("agentPrompt mentions media support", () => {
    const hints = wechatKfPlugin.agentPrompt.messageToolHints();
    const mediaHint = hints.find((h: string) => h.includes("media"));
    expect(mediaHint).toBeDefined();
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

describe("gateway.startAccount", () => {
  const gateway = wechatKfPlugin.gateway as any;

  // Reset idempotency flag before each test
  beforeEach(() => {
    gateway._started = false;
    vi.resetAllMocks();
  });

  function makeCtx(overrides: Record<string, any> = {}) {
    return {
      accountId: "test-account",
      cfg: {
        channels: {
          "wechat-kf": {
            corpId: "corp1",
            appSecret: "secret1",
            token: "tok",
            encodingAESKey: "aeskey",
            webhookPort: 8080,
            webhookPath: "/test",
          },
        },
      },
      setStatus: vi.fn(),
      log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
      runtime: {},
      abortSignal: undefined,
      ...overrides,
    };
  }

  it("sets running: true on start then calls startMonitor", async () => {
    const { startMonitor } = await import("./monitor.js");
    (startMonitor as any).mockResolvedValue(undefined);

    const ctx = makeCtx();
    await gateway.startAccount(ctx);

    expect(ctx.setStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "test-account",
        port: 8080,
        running: true,
      }),
    );
    expect(startMonitor).toHaveBeenCalledOnce();
  });

  it("sets running: false with lastError when startMonitor throws", async () => {
    const { startMonitor } = await import("./monitor.js");
    const portError = new Error("listen EADDRINUSE: address already in use :::8080");
    (startMonitor as any).mockRejectedValue(portError);

    const ctx = makeCtx();
    await expect(gateway.startAccount(ctx)).rejects.toThrow("EADDRINUSE");

    // First call: running: true (optimistic)
    expect(ctx.setStatus).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ running: true }),
    );
    // Second call: running: false with error details
    expect(ctx.setStatus).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        accountId: "test-account",
        port: 8080,
        running: false,
        lastError: expect.stringContaining("EADDRINUSE"),
        lastStopAt: expect.any(String),
      }),
    );
  });

  it("re-throws the original error from startMonitor", async () => {
    const { startMonitor } = await import("./monitor.js");
    const original = new Error("boom");
    (startMonitor as any).mockRejectedValue(original);

    const ctx = makeCtx();
    await expect(gateway.startAccount(ctx)).rejects.toBe(original);
  });

  it("resets _started flag on failure so retry is possible", async () => {
    const { startMonitor } = await import("./monitor.js");
    (startMonitor as any).mockRejectedValueOnce(new Error("first fail"));
    (startMonitor as any).mockResolvedValueOnce(undefined);

    const ctx = makeCtx();

    // First call fails
    await expect(gateway.startAccount(ctx)).rejects.toThrow("first fail");
    expect(gateway._started).toBe(false);

    // Second call should succeed (not blocked by idempotency guard)
    await gateway.startAccount(ctx);
    expect(gateway._started).toBe(true);
  });

  it("idempotency guard: second call is a no-op when already running", async () => {
    const { startMonitor } = await import("./monitor.js");
    (startMonitor as any).mockResolvedValue(undefined);

    const ctx = makeCtx();

    // First call succeeds
    await gateway.startAccount(ctx);
    expect(startMonitor).toHaveBeenCalledOnce();

    // Second call is skipped
    const ctx2 = makeCtx();
    await gateway.startAccount(ctx2);
    expect(startMonitor).toHaveBeenCalledOnce(); // still 1
    expect(ctx2.log.info).toHaveBeenCalledWith(
      expect.stringContaining("already running"),
    );
  });

  it("handles non-Error thrown values in lastError", async () => {
    const { startMonitor } = await import("./monitor.js");
    (startMonitor as any).mockRejectedValue("string error");

    const ctx = makeCtx();
    await expect(gateway.startAccount(ctx)).rejects.toBe("string error");

    expect(ctx.setStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        running: false,
        lastError: "string error",
      }),
    );
  });

  it("works when setStatus is not provided (no crash)", async () => {
    const { startMonitor } = await import("./monitor.js");
    (startMonitor as any).mockRejectedValue(new Error("fail"));

    const ctx = makeCtx({ setStatus: undefined });
    await expect(gateway.startAccount(ctx)).rejects.toThrow("fail");
    // Should not throw due to missing setStatus
  });
});

// ══════════════════════════════════════════════
// P2-02: config adapter
// ══════════════════════════════════════════════

describe("config adapter", () => {
  const config = wechatKfPlugin.config as any;

  it("listAccountIds returns ['default'] when no kfids discovered", () => {
    const cfg = { channels: { "wechat-kf": {} } };
    const ids = config.listAccountIds(cfg);
    expect(ids).toEqual(["default"]);
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
    expect(account.webhookPort).toBe(9999);
    expect(account.webhookPath).toBe("/wechat-kf");
  });

  it("defaultAccountId returns first from listAccountIds", () => {
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

  it("describeAccount returns expected shape", () => {
    const account = {
      accountId: "kf_001",
      enabled: true,
      configured: true,
      corpId: "corp1",
      openKfId: "kf_001",
    };
    const desc = config.describeAccount(account);
    expect(desc).toEqual({
      accountId: "kf_001",
      enabled: true,
      configured: true,
      corpId: "corp1",
      openKfId: "kf_001",
    });
  });

  it("setAccountEnabled returns cfg unchanged (dynamic accounts)", () => {
    const cfg = { channels: { "wechat-kf": {} } };
    expect(config.setAccountEnabled({ cfg, accountId: "kf_001", enabled: true })).toBe(cfg);
  });

  it("deleteAccount returns cfg unchanged (dynamic accounts)", () => {
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
    expect(config.formatAllowFrom({ allowFrom: ["  user1  ", "", " user2 "] })).toEqual([
      "user1",
      "user2",
    ]);
  });
});

// ══════════════════════════════════════════════
// P2-02: status adapter
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
      port: null,
    });
  });

  it("buildChannelSummary extracts fields from snapshot", () => {
    const summary = status.buildChannelSummary({
      snapshot: {
        configured: true,
        running: true,
        lastStartAt: "2025-01-01",
        lastError: null,
        port: 9999,
      },
    });
    expect(summary).toEqual({
      configured: true,
      running: true,
      lastStartAt: "2025-01-01",
      lastError: null,
      port: 9999,
    });
  });

  it("buildChannelSummary defaults missing fields to false/null", () => {
    const summary = status.buildChannelSummary({ snapshot: {} });
    expect(summary).toEqual({
      configured: false,
      running: false,
      lastStartAt: null,
      lastError: null,
      port: null,
    });
  });

  it("buildAccountSnapshot merges account and runtime", () => {
    const snap = status.buildAccountSnapshot({
      account: { accountId: "kf_1", enabled: true, configured: true, corpId: "c1" },
      runtime: { running: true, lastStartAt: "2025-01-01", lastError: null, port: 9999 },
    });
    expect(snap).toEqual({
      accountId: "kf_1",
      enabled: true,
      configured: true,
      corpId: "c1",
      running: true,
      lastStartAt: "2025-01-01",
      lastError: null,
      port: 9999,
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
    expect(snap.port).toBeNull();
  });
});

// ══════════════════════════════════════════════
// P2-02: setup adapter
// ══════════════════════════════════════════════

describe("setup adapter", () => {
  const setup = wechatKfPlugin.setup as any;

  it("resolveAccountId defaults to 'default' when not provided", () => {
    expect(setup.resolveAccountId({}, undefined)).toBe("default");
  });

  it("resolveAccountId returns provided accountId", () => {
    expect(setup.resolveAccountId({}, "kf_custom")).toBe("kf_custom");
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
// P2-02: meta and reload
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
