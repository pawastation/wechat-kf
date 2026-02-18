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
