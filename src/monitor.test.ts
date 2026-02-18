import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock dependencies ──

const mockLoadKfIds = vi.fn();
const mockGetKnownKfIds = vi.fn<() => string[]>();
const mockGetChannelConfig = vi.fn();

vi.mock("./accounts.js", () => ({
  getChannelConfig: (...args: any[]) => mockGetChannelConfig(...args),
  loadKfIds: (...args: any[]) => mockLoadKfIds(...args),
  getKnownKfIds: () => mockGetKnownKfIds(),
}));

vi.mock("./token.js", () => ({
  getAccessToken: vi.fn().mockResolvedValue("fake_token"),
}));

const mockHandleWebhookEvent = vi.fn();
vi.mock("./bot.js", () => ({
  handleWebhookEvent: (...args: any[]) => mockHandleWebhookEvent(...args),
}));

// ── Import after mocks ──

import { startMonitor, type MonitorContext } from "./monitor.js";

// ── Helpers ──

function makeCtx(overrides: Partial<MonitorContext> = {}): MonitorContext {
  return {
    cfg: {
      channels: {
        "wechat-kf": {
          corpId: "corp_test",
          appSecret: "secret_test",
          token: "token_test",
          encodingAESKey: "01234567890123456789012345678901234567890ab",
          webhookPort: 0,
          webhookPath: "/wechat-kf",
        },
      },
    },
    stateDir: "/tmp/test-state",
    log: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    },
    ...overrides,
  };
}

describe("monitor AbortSignal guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadKfIds.mockResolvedValue(undefined);
    mockGetKnownKfIds.mockReturnValue([]);
    mockGetChannelConfig.mockReturnValue({
      corpId: "corp_test",
      appSecret: "secret_test",
      token: "token_test",
      encodingAESKey: "01234567890123456789012345678901234567890ab",
      webhookPort: 0, // port 0 = OS picks random available port
      webhookPath: "/wechat-kf",
    });
    mockHandleWebhookEvent.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should skip resource creation when signal is already aborted", async () => {
    const ctx = makeCtx({ abortSignal: AbortSignal.abort() });
    const server = await startMonitor(ctx);

    // Server returned but should NOT be listening (no .listen called)
    expect(server).toBeDefined();
    expect(server.listening).toBe(false);

    // Should NOT have loaded kfids or validated token (skipped entirely)
    expect(mockLoadKfIds).not.toHaveBeenCalled();

    // Log should indicate skip
    expect(ctx.log!.info).toHaveBeenCalledWith(
      "[wechat-kf] abort signal already triggered, skipping monitor start",
    );
  });

  it("should start normally without an abort signal", async () => {
    const ctx = makeCtx();
    const server = await startMonitor(ctx);

    expect(server.listening).toBe(true);
    expect(mockLoadKfIds).toHaveBeenCalledWith("/tmp/test-state");

    // Cleanup
    server.close();
  });

  it("should clean up resources when signal is aborted after start", async () => {
    const ac = new AbortController();
    const ctx = makeCtx({ abortSignal: ac.signal });
    const server = await startMonitor(ctx);

    expect(server.listening).toBe(true);

    // Abort the signal
    ac.abort();

    // Give the event loop a tick for the abort listener to fire
    await new Promise((r) => setTimeout(r, 50));

    // Server should be closed
    expect(server.listening).toBe(false);

    // Cleanup log message
    expect(ctx.log!.info).toHaveBeenCalledWith(
      "[wechat-kf] webhook server + polling stopped",
    );
  });

  it("should not poll when signal is aborted between interval ticks", async () => {
    const ac = new AbortController();
    mockGetKnownKfIds.mockReturnValue(["kf_001", "kf_002"]);

    const ctx = makeCtx({ abortSignal: ac.signal });

    // Use fake timers to control setInterval
    vi.useFakeTimers();

    const server = await startMonitor(ctx);
    expect(server.listening).toBe(true);

    // Abort before the poll timer fires
    ac.abort();

    // Advance timer past the 30s poll interval
    await vi.advanceTimersByTimeAsync(35_000);

    // handleWebhookEvent should NOT have been called by polling
    // (it could be called from other sources, but not from the poll timer)
    expect(mockHandleWebhookEvent).not.toHaveBeenCalled();

    vi.useRealTimers();

    // Server already closed by abort
    expect(server.listening).toBe(false);
  });

  it("should start normally with a non-aborted signal and poll when kfids exist", async () => {
    const ac = new AbortController();
    mockGetKnownKfIds.mockReturnValue(["kf_001"]);

    const ctx = makeCtx({ abortSignal: ac.signal });

    vi.useFakeTimers();

    const server = await startMonitor(ctx);
    expect(server.listening).toBe(true);

    // Advance timer past the 30s poll interval
    await vi.advanceTimersByTimeAsync(31_000);

    // handleWebhookEvent should have been called for polling
    expect(mockHandleWebhookEvent).toHaveBeenCalledTimes(1);

    vi.useRealTimers();

    // Cleanup
    ac.abort();
    await new Promise((r) => setTimeout(r, 50));
    expect(server.listening).toBe(false);
  });
});
