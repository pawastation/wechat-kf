import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WechatKfSyncMsgResponse } from "./types.js";

// ── Mock all heavy dependencies ──

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn().mockRejectedValue(new Error("no cursor")),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
}));

const mockSyncMessages = vi.fn<(...args: any[]) => Promise<WechatKfSyncMsgResponse>>();
const mockDownloadMedia = vi.fn();
vi.mock("./api.js", () => ({
  syncMessages: (...args: any[]) => mockSyncMessages(...args),
  downloadMedia: (...args: any[]) => mockDownloadMedia(...args),
}));

const mockGetRuntime = vi.fn();
vi.mock("./runtime.js", () => ({
  getRuntime: () => mockGetRuntime(),
}));

vi.mock("./reply-dispatcher.js", () => ({
  createReplyDispatcher: vi.fn().mockReturnValue({
    dispatcher: {},
    replyOptions: {},
    markDispatchIdle: vi.fn(),
  }),
}));

// We need accounts to work normally but we can control cfg
vi.mock("./accounts.js", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    registerKfId: vi.fn().mockResolvedValue(undefined),
  };
});

// ── Import after mocks ──

import { handleWebhookEvent, _testing, type BotContext } from "./bot.js";

// ── Helpers ──

function makeSyncResponse(messages: any[]): WechatKfSyncMsgResponse {
  return {
    errcode: 0,
    errmsg: "ok",
    next_cursor: "cursor_1",
    has_more: 0,
    msg_list: messages,
  };
}

function makeTextMessage(externalUserId: string, text: string, msgid?: string) {
  return {
    msgid: msgid ?? `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    open_kfid: "kf_test123",
    external_userid: externalUserId,
    send_time: Math.floor(Date.now() / 1000),
    origin: 3, // customer message
    msgtype: "text",
    text: { content: text },
  };
}

function makeMockRuntime() {
  return {
    channel: {
      media: { saveMediaBuffer: vi.fn().mockResolvedValue({ path: "/tmp/media" }) },
      routing: {
        resolveAgentRoute: vi.fn().mockReturnValue({ sessionKey: "sess_1", agentId: "agent_1" }),
      },
      reply: {
        resolveEnvelopeFormatOptions: vi.fn().mockReturnValue({}),
        formatAgentEnvelope: vi.fn().mockReturnValue("formatted body"),
        finalizeInboundContext: vi.fn().mockReturnValue({}),
        dispatchReplyFromConfig: vi.fn().mockResolvedValue({ queuedFinal: false, counts: { final: 1 } }),
      },
    },
    system: {
      enqueueSystemEvent: vi.fn(),
    },
  };
}

// ── Tests ──

describe("bot DM policy enforcement", () => {
  let logMessages: string[];
  let log: BotContext["log"];

  beforeEach(() => {
    vi.clearAllMocks();
    logMessages = [];
    log = {
      info: (...args: any[]) => logMessages.push(args.join(" ")),
      error: (...args: any[]) => logMessages.push(args.join(" ")),
    };
  });

  it("passes message through when dmPolicy is 'open' (default)", async () => {
    const cfg = {
      channels: {
        "wechat-kf": {
          corpId: "corp1",
          appSecret: "secret1",
          token: "tok",
          encodingAESKey: "key",
        },
      },
    };

    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    const msg = makeTextMessage("ext_user_1", "hello");
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    // Message should reach the runtime dispatcher
    expect(mockRuntime.channel.reply.dispatchReplyFromConfig).toHaveBeenCalledTimes(1);
  });

  it("blocks message when dmPolicy is 'disabled'", async () => {
    const cfg = {
      channels: {
        "wechat-kf": {
          corpId: "corp1",
          appSecret: "secret1",
          token: "tok",
          encodingAESKey: "key",
          dmPolicy: "disabled",
        },
      },
    };

    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    const msg = makeTextMessage("ext_user_1", "hello");
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    // Message should NOT reach the runtime dispatcher
    expect(mockRuntime.channel.reply.dispatchReplyFromConfig).not.toHaveBeenCalled();
    expect(logMessages.some((m) => m.includes("disabled"))).toBe(true);
  });

  it("blocks message when dmPolicy is 'allowlist' and sender not in allowFrom", async () => {
    const cfg = {
      channels: {
        "wechat-kf": {
          corpId: "corp1",
          appSecret: "secret1",
          token: "tok",
          encodingAESKey: "key",
          dmPolicy: "allowlist",
          allowFrom: ["allowed_user_1", "allowed_user_2"],
        },
      },
    };

    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    const msg = makeTextMessage("blocked_user", "hello");
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    // Message should NOT reach the runtime dispatcher
    expect(mockRuntime.channel.reply.dispatchReplyFromConfig).not.toHaveBeenCalled();
    expect(logMessages.some((m) => m.includes("blocked sender blocked_user"))).toBe(true);
  });

  it("passes message when dmPolicy is 'allowlist' and sender IS in allowFrom", async () => {
    const cfg = {
      channels: {
        "wechat-kf": {
          corpId: "corp1",
          appSecret: "secret1",
          token: "tok",
          encodingAESKey: "key",
          dmPolicy: "allowlist",
          allowFrom: ["allowed_user_1", "allowed_user_2"],
        },
      },
    };

    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    const msg = makeTextMessage("allowed_user_1", "hello");
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    // Message should reach the runtime dispatcher
    expect(mockRuntime.channel.reply.dispatchReplyFromConfig).toHaveBeenCalledTimes(1);
  });

  it("passes message when dmPolicy is 'pairing' (deferred to P2)", async () => {
    const cfg = {
      channels: {
        "wechat-kf": {
          corpId: "corp1",
          appSecret: "secret1",
          token: "tok",
          encodingAESKey: "key",
          dmPolicy: "pairing",
        },
      },
    };

    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    const msg = makeTextMessage("ext_user_1", "hello");
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    // Pairing mode currently passes through (full flow deferred to P2)
    expect(mockRuntime.channel.reply.dispatchReplyFromConfig).toHaveBeenCalledTimes(1);
  });
});

// ── P1-01: Mutex and dedup tests ──

describe("bot per-kfId mutex", () => {
  let logMessages: string[];
  let log: BotContext["log"];

  beforeEach(() => {
    vi.clearAllMocks();
    _testing.resetState();
    logMessages = [];
    log = {
      info: (...args: any[]) => logMessages.push(args.join(" ")),
      error: (...args: any[]) => logMessages.push(args.join(" ")),
    };
  });

  it("serializes concurrent calls for the same kfId", async () => {
    const cfg = {
      channels: {
        "wechat-kf": {
          corpId: "corp1",
          appSecret: "secret1",
          token: "tok",
          encodingAESKey: "key",
        },
      },
    };

    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    // Track the order of execution
    const executionOrder: string[] = [];

    // First call: takes 50ms to complete via a delayed syncMessages
    mockSyncMessages.mockImplementationOnce(async () => {
      executionOrder.push("call1-start");
      await new Promise((r) => setTimeout(r, 50));
      executionOrder.push("call1-end");
      return makeSyncResponse([makeTextMessage("user1", "msg1", "unique_msg_1")]);
    });

    // Second call: resolves immediately
    mockSyncMessages.mockImplementationOnce(async () => {
      executionOrder.push("call2-start");
      return makeSyncResponse([makeTextMessage("user1", "msg2", "unique_msg_2")]);
    });

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };

    // Fire both concurrently for the same kfId
    const p1 = handleWebhookEvent(ctx, "kf_test123", "");
    const p2 = handleWebhookEvent(ctx, "kf_test123", "");

    await Promise.all([p1, p2]);

    // call2 must not start until call1 finishes
    expect(executionOrder.indexOf("call1-end")).toBeLessThan(
      executionOrder.indexOf("call2-start"),
    );
  });

  it("allows concurrent calls for different kfIds to run in parallel", async () => {
    const cfg = {
      channels: {
        "wechat-kf": {
          corpId: "corp1",
          appSecret: "secret1",
          token: "tok",
          encodingAESKey: "key",
        },
      },
    };

    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    const executionOrder: string[] = [];

    // kf_A call: takes 50ms
    mockSyncMessages.mockImplementationOnce(async () => {
      executionOrder.push("kfA-start");
      await new Promise((r) => setTimeout(r, 50));
      executionOrder.push("kfA-end");
      return makeSyncResponse([makeTextMessage("user1", "msg1", "msg_a_1")]);
    });

    // kf_B call: resolves immediately
    mockSyncMessages.mockImplementationOnce(async () => {
      executionOrder.push("kfB-start");
      return makeSyncResponse([makeTextMessage("user2", "msg2", "msg_b_1")]);
    });

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };

    const p1 = handleWebhookEvent(ctx, "kf_A", "");
    const p2 = handleWebhookEvent(ctx, "kf_B", "");

    await Promise.all([p1, p2]);

    // Both should start before kfA ends (parallel execution)
    expect(executionOrder.indexOf("kfB-start")).toBeLessThan(
      executionOrder.indexOf("kfA-end"),
    );
  });

  it("cleans up lock from map after completion", async () => {
    const cfg = {
      channels: {
        "wechat-kf": {
          corpId: "corp1",
          appSecret: "secret1",
          token: "tok",
          encodingAESKey: "key",
        },
      },
    };

    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    mockSyncMessages.mockResolvedValueOnce(
      makeSyncResponse([makeTextMessage("user1", "hello", "msg_cleanup_1")]),
    );

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    // Lock should be cleaned up after single call completes
    expect(_testing.kfLocks.has("kf_test123")).toBe(false);
  });
});

describe("bot msgid deduplication", () => {
  let logMessages: string[];
  let log: BotContext["log"];

  beforeEach(() => {
    vi.clearAllMocks();
    _testing.resetState();
    logMessages = [];
    log = {
      info: (...args: any[]) => logMessages.push(args.join(" ")),
      error: (...args: any[]) => logMessages.push(args.join(" ")),
    };
  });

  it("skips duplicate msgid within the same batch", async () => {
    const cfg = {
      channels: {
        "wechat-kf": {
          corpId: "corp1",
          appSecret: "secret1",
          token: "tok",
          encodingAESKey: "key",
        },
      },
    };

    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    const msg1 = makeTextMessage("user1", "hello", "dup_msg_001");
    const msg2 = makeTextMessage("user1", "hello again", "dup_msg_001"); // same msgid

    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg1, msg2]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    // Only the first occurrence should be dispatched
    expect(mockRuntime.channel.reply.dispatchReplyFromConfig).toHaveBeenCalledTimes(1);
    expect(logMessages.some((m) => m.includes("skipping duplicate msg dup_msg_001"))).toBe(true);
  });

  it("skips duplicate msgid across sequential calls", async () => {
    const cfg = {
      channels: {
        "wechat-kf": {
          corpId: "corp1",
          appSecret: "secret1",
          token: "tok",
          encodingAESKey: "key",
        },
      },
    };

    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    const msg = makeTextMessage("user1", "hello", "dup_msg_002");

    // First call returns the message
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));
    // Second call returns the same message (simulating overlapping sync_msg)
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");
    await handleWebhookEvent(ctx, "kf_test123", "");

    // Message should only be dispatched once
    expect(mockRuntime.channel.reply.dispatchReplyFromConfig).toHaveBeenCalledTimes(1);
  });

  it("allows different msgids through", async () => {
    const cfg = {
      channels: {
        "wechat-kf": {
          corpId: "corp1",
          appSecret: "secret1",
          token: "tok",
          encodingAESKey: "key",
        },
      },
    };

    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    const msg1 = makeTextMessage("user1", "hello", "unique_001");
    const msg2 = makeTextMessage("user1", "world", "unique_002");

    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg1, msg2]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    // Both unique messages should be dispatched
    expect(mockRuntime.channel.reply.dispatchReplyFromConfig).toHaveBeenCalledTimes(2);
  });

  it("evicts oldest half when Set exceeds max size", () => {
    // Directly test isDuplicate eviction logic
    _testing.processedMsgIds.clear();

    // Fill to max
    for (let i = 0; i < _testing.DEDUP_MAX_SIZE; i++) {
      _testing.isDuplicate(`fill_${i}`);
    }
    expect(_testing.processedMsgIds.size).toBe(_testing.DEDUP_MAX_SIZE);

    // Adding one more should trigger eviction (oldest half removed)
    const result = _testing.isDuplicate("overflow_trigger");
    expect(result).toBe(false); // new entry, not a duplicate
    // After eviction: kept half + the new entry
    expect(_testing.processedMsgIds.size).toBeLessThanOrEqual(_testing.DEDUP_MAX_SIZE / 2 + 1);

    // Old entries from the first half should be gone
    expect(_testing.processedMsgIds.has("fill_0")).toBe(false);
    expect(_testing.processedMsgIds.has("fill_1")).toBe(false);

    // Recent entries (second half) should still be present
    expect(_testing.processedMsgIds.has(`fill_${_testing.DEDUP_MAX_SIZE - 1}`)).toBe(true);
  });
});

// ── P1-02: Cursor save timing tests ──

describe("bot cursor save timing (P1-02)", () => {
  let logMessages: string[];
  let log: BotContext["log"];
  let mockRename: ReturnType<typeof vi.fn>;
  let mockWriteFile: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    _testing.resetState();
    logMessages = [];
    log = {
      info: (...args: any[]) => logMessages.push(args.join(" ")),
      error: (...args: any[]) => logMessages.push(args.join(" ")),
    };
    // Get handles to the mocked fs functions
    const fsp = await import("node:fs/promises");
    mockRename = fsp.rename as ReturnType<typeof vi.fn>;
    mockWriteFile = fsp.writeFile as ReturnType<typeof vi.fn>;
  });

  it("saves cursor AFTER messages are processed, not before", async () => {
    const cfg = {
      channels: {
        "wechat-kf": {
          corpId: "corp1",
          appSecret: "secret1",
          token: "tok",
          encodingAESKey: "key",
        },
      },
    };

    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    // Track ordering: dispatch happens before cursor is saved
    const callOrder: string[] = [];

    mockRuntime.channel.reply.dispatchReplyFromConfig.mockImplementation(async () => {
      callOrder.push("dispatch");
      return { queuedFinal: false, counts: { final: 1 } };
    });

    // rename is the final step of atomicWriteFile — use it to detect cursor commit
    mockRename.mockImplementation(async (_src: string, dest: string) => {
      if (typeof dest === "string" && dest.includes("cursor")) {
        callOrder.push("save_cursor");
      }
    });

    const msg = makeTextMessage("user1", "hello", "timing_msg_001");
    mockSyncMessages.mockResolvedValueOnce({
      errcode: 0,
      errmsg: "ok",
      next_cursor: "cursor_after_batch",
      has_more: 0,
      msg_list: [msg],
    });

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    // dispatch must happen BEFORE cursor save (at-least-once semantics)
    expect(callOrder).toEqual(["dispatch", "save_cursor"]);
  });

  it("saves cursor even when a single message dispatch fails (batch continues)", async () => {
    const cfg = {
      channels: {
        "wechat-kf": {
          corpId: "corp1",
          appSecret: "secret1",
          token: "tok",
          encodingAESKey: "key",
        },
      },
    };

    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    const callOrder: string[] = [];

    // First dispatch throws, second succeeds
    mockRuntime.channel.reply.dispatchReplyFromConfig
      .mockImplementationOnce(async () => {
        callOrder.push("dispatch_fail");
        throw new Error("simulated dispatch failure");
      })
      .mockImplementationOnce(async () => {
        callOrder.push("dispatch_ok");
        return { queuedFinal: false, counts: { final: 1 } };
      });

    mockRename.mockImplementation(async (_src: string, dest: string) => {
      if (typeof dest === "string" && dest.includes("cursor")) {
        callOrder.push("save_cursor");
      }
    });

    const msg1 = makeTextMessage("user1", "hello", "fail_msg_001");
    const msg2 = makeTextMessage("user2", "world", "fail_msg_002");
    mockSyncMessages.mockResolvedValueOnce({
      errcode: 0,
      errmsg: "ok",
      next_cursor: "cursor_after_mixed_batch",
      has_more: 0,
      msg_list: [msg1, msg2],
    });

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    // Both dispatches should be attempted, and cursor saved after both
    expect(callOrder).toEqual(["dispatch_fail", "dispatch_ok", "save_cursor"]);

    // The error should be logged but not prevent cursor save
    expect(logMessages.some((m) => m.includes("dispatch error") && m.includes("fail_msg_001"))).toBe(true);

    // Cursor value should be written to the .tmp file before rename
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining("cursor"),
      "cursor_after_mixed_batch",
      "utf8",
    );
  });

  it("does not save cursor when sync_msg returns no next_cursor", async () => {
    const cfg = {
      channels: {
        "wechat-kf": {
          corpId: "corp1",
          appSecret: "secret1",
          token: "tok",
          encodingAESKey: "key",
        },
      },
    };

    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    const msg = makeTextMessage("user1", "hello", "no_cursor_msg_001");
    mockSyncMessages.mockResolvedValueOnce({
      errcode: 0,
      errmsg: "ok",
      next_cursor: "", // empty cursor
      has_more: 0,
      msg_list: [msg],
    });

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    // rename should NOT have been called for cursor (no atomic write)
    const cursorRenames = mockRename.mock.calls.filter(
      (call: any[]) => typeof call[1] === "string" && call[1].includes("cursor"),
    );
    expect(cursorRenames).toHaveLength(0);
  });

  it("saves cursor after processing in multi-page (has_more) scenario", async () => {
    const cfg = {
      channels: {
        "wechat-kf": {
          corpId: "corp1",
          appSecret: "secret1",
          token: "tok",
          encodingAESKey: "key",
        },
      },
    };

    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    const callOrder: string[] = [];

    mockRuntime.channel.reply.dispatchReplyFromConfig.mockImplementation(async () => {
      callOrder.push("dispatch");
      return { queuedFinal: false, counts: { final: 1 } };
    });

    mockRename.mockImplementation(async (_src: string, dest: string) => {
      if (typeof dest === "string" && dest.includes("cursor")) {
        callOrder.push("save_cursor");
      }
    });

    // Page 1: has_more = 1
    const msg1 = makeTextMessage("user1", "page1", "multi_msg_001");
    mockSyncMessages.mockResolvedValueOnce({
      errcode: 0,
      errmsg: "ok",
      next_cursor: "cursor_page_1",
      has_more: 1,
      msg_list: [msg1],
    });

    // Page 2: has_more = 0
    const msg2 = makeTextMessage("user1", "page2", "multi_msg_002");
    mockSyncMessages.mockResolvedValueOnce({
      errcode: 0,
      errmsg: "ok",
      next_cursor: "cursor_page_2",
      has_more: 0,
      msg_list: [msg2],
    });

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    // Each page: dispatch first, then save cursor
    expect(callOrder).toEqual([
      "dispatch", "save_cursor",  // page 1
      "dispatch", "save_cursor",  // page 2
    ]);
  });
});
