import { afterEach, describe, expect, it } from "vitest";
import {
  _reset,
  clearSharedContext,
  getPairingKfId,
  getSharedContext,
  type SharedContext,
  setPairingKfId,
  setSharedContext,
  waitForSharedContext,
} from "./monitor.js";

function makeCtx(overrides: Partial<SharedContext> = {}): SharedContext {
  return {
    callbackToken: "tok",
    encodingAESKey: "key",
    corpId: "corp1",
    appSecret: "secret",
    webhookPath: "/wechat-kf",
    botCtx: { cfg: {}, stateDir: "/tmp/test" },
    ...overrides,
  };
}

describe("shared context lifecycle", () => {
  afterEach(() => {
    _reset();
  });

  it("getSharedContext returns null before setSharedContext", () => {
    expect(getSharedContext()).toBeNull();
  });

  it("setSharedContext stores the context", () => {
    const ctx = makeCtx();
    setSharedContext(ctx);
    expect(getSharedContext()).toBe(ctx);
  });

  it("clearSharedContext removes the context", () => {
    setSharedContext(makeCtx());
    expect(getSharedContext()).not.toBeNull();
    clearSharedContext();
    expect(getSharedContext()).toBeNull();
  });

  it("_reset clears all state", () => {
    setSharedContext(makeCtx());
    _reset();
    expect(getSharedContext()).toBeNull();
  });
});

describe("waitForSharedContext", () => {
  afterEach(() => {
    _reset();
  });

  it("resolves immediately when context is already set", async () => {
    const ctx = makeCtx();
    setSharedContext(ctx);
    const result = await waitForSharedContext();
    expect(result).toBe(ctx);
  });

  it("resolves after setSharedContext is called", async () => {
    const ctx = makeCtx();

    // Start waiting before context is set
    const promise = waitForSharedContext();

    // Set context after a tick
    queueMicrotask(() => setSharedContext(ctx));

    const result = await promise;
    expect(result).toBe(ctx);
  });

  it("rejects when signal is already aborted", async () => {
    const signal = AbortSignal.abort();
    await expect(waitForSharedContext(signal)).rejects.toThrow("aborted");
  });

  it("rejects when signal aborts before context is ready", async () => {
    const ac = new AbortController();
    const promise = waitForSharedContext(ac.signal);

    // Abort before setting context
    queueMicrotask(() => ac.abort());

    await expect(promise).rejects.toThrow("aborted");
  });

  it("multiple waiters all resolve when context is set", async () => {
    const ctx = makeCtx();

    const p1 = waitForSharedContext();
    const p2 = waitForSharedContext();

    queueMicrotask(() => setSharedContext(ctx));

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(ctx);
    expect(r2).toBe(ctx);
  });

  it("resolves with signal when context is set before abort", async () => {
    const ac = new AbortController();
    const ctx = makeCtx();

    const promise = waitForSharedContext(ac.signal);
    queueMicrotask(() => setSharedContext(ctx));

    const result = await promise;
    expect(result).toBe(ctx);

    // Aborting after resolve should not cause issues
    ac.abort();
  });
});

describe("_reset allows fresh state", () => {
  afterEach(() => {
    _reset();
  });

  it("new waiters after _reset wait for new setSharedContext", async () => {
    const ctx1 = makeCtx({ corpId: "first" });
    setSharedContext(ctx1);
    _reset();

    const ctx2 = makeCtx({ corpId: "second" });
    const promise = waitForSharedContext();
    queueMicrotask(() => setSharedContext(ctx2));

    const result = await promise;
    expect(result.corpId).toBe("second");
  });
});

describe("pairing kfId cache", () => {
  afterEach(() => {
    _reset();
  });

  it("setPairingKfId stores and getPairingKfId retrieves the mapping", () => {
    setPairingKfId("user1", "kf_001");
    expect(getPairingKfId("user1")).toBe("kf_001");
  });

  it("getPairingKfId returns undefined for unknown user", () => {
    expect(getPairingKfId("unknown")).toBeUndefined();
  });

  it("clearSharedContext clears the pairing cache", () => {
    setPairingKfId("user1", "kf_001");
    clearSharedContext();
    expect(getPairingKfId("user1")).toBeUndefined();
  });

  it("_reset clears the pairing cache", () => {
    setPairingKfId("user1", "kf_001");
    _reset();
    expect(getPairingKfId("user1")).toBeUndefined();
  });
});
