import { afterEach, describe, expect, it } from "vitest";
import type { PluginRuntime } from "./runtime.js";
import { _reset, getRuntime, setRuntime } from "./runtime.js";

/** Minimal mock PluginRuntime for testing */
function makeMockRuntime(tag = "default"): PluginRuntime {
  return {
    _tag: tag,
    channel: {
      media: { saveMediaBuffer: async () => ({ path: "/tmp/test" }) },
      routing: { resolveAgentRoute: () => ({ sessionKey: "sk", agentId: "a1" }) },
      reply: {
        resolveEnvelopeFormatOptions: () => ({}),
        formatAgentEnvelope: () => "",
        finalizeInboundContext: () => ({}),
        createReplyDispatcherWithTyping: () => ({}),
        dispatchReplyFromConfig: async () => ({}),
        resolveHumanDelayConfig: () => ({}),
      },
      text: {
        resolveTextChunkLimit: () => 2048,
        resolveChunkMode: () => "length",
        chunkTextWithMode: (text: string) => [text],
      },
    },
    system: {
      enqueueSystemEvent: () => {},
    },
  };
}

describe("runtime state isolation", () => {
  afterEach(() => {
    _reset();
  });

  it("getRuntime throws when runtime is not set", () => {
    expect(() => getRuntime()).toThrow("runtime not initialized");
  });

  it("setRuntime + getRuntime round-trips correctly", () => {
    const mock = makeMockRuntime();
    setRuntime(mock);
    expect(getRuntime()).toBe(mock);
  });

  it("_reset clears the runtime back to null", () => {
    setRuntime(makeMockRuntime());
    _reset();
    expect(() => getRuntime()).toThrow("runtime not initialized");
  });

  it("_reset allows a fresh runtime to be set", () => {
    const first = makeMockRuntime("first");
    const second = makeMockRuntime("second");

    setRuntime(first);
    expect(getRuntime()).toBe(first);

    _reset();
    setRuntime(second);
    expect(getRuntime()).toBe(second);
    expect((getRuntime() as any)._tag).toBe("second");
  });

  it("state does not leak between tests (test A: set runtime)", () => {
    setRuntime(makeMockRuntime("leaky"));
    expect((getRuntime() as any)._tag).toBe("leaky");
  });

  it("state does not leak between tests (test B: runtime is cleared)", () => {
    // afterEach _reset ensures runtime from previous test is gone
    expect(() => getRuntime()).toThrow("runtime not initialized");
  });
});

describe("setRuntime", () => {
  afterEach(() => {
    _reset();
  });

  it("overwrites previously set runtime", () => {
    const first = makeMockRuntime("v1");
    const second = makeMockRuntime("v2");

    setRuntime(first);
    setRuntime(second);

    expect(getRuntime()).toBe(second);
    expect((getRuntime() as any)._tag).toBe("v2");
  });
});
