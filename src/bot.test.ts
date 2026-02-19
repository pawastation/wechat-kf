import { beforeEach, describe, expect, it, vi } from "vitest";
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

import { _testing, type BotContext, handleWebhookEvent } from "./bot.js";

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
    expect(executionOrder.indexOf("call1-end")).toBeLessThan(executionOrder.indexOf("call2-start"));
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
    expect(executionOrder.indexOf("kfB-start")).toBeLessThan(executionOrder.indexOf("kfA-end"));
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

    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([makeTextMessage("user1", "hello", "msg_cleanup_1")]));

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
      debug: (...args: any[]) => logMessages.push(args.join(" ")),
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
    expect(mockWriteFile).toHaveBeenCalledWith(expect.stringContaining("cursor"), "cursor_after_mixed_batch", "utf8");
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
      "dispatch",
      "save_cursor", // page 1
      "dispatch",
      "save_cursor", // page 2
    ]);
  });
});

// ── P2-05: sync_msg token/cursor mutual exclusivity ──

describe("bot sync_msg token/cursor mutual exclusivity (P2-05)", () => {
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

  it("sends only cursor (no token) when cursor exists", async () => {
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

    // Simulate persisted cursor by mocking readFile to return a cursor
    const fsp = await import("node:fs/promises");
    (fsp.readFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce("saved_cursor_123");

    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "webhook_token_456");

    // syncMessages should have been called with cursor but NOT token
    expect(mockSyncMessages).toHaveBeenCalledTimes(1);
    const syncReq = mockSyncMessages.mock.calls[0][2];
    expect(syncReq.cursor).toBe("saved_cursor_123");
    expect(syncReq.token).toBeUndefined();
    expect(syncReq.limit).toBe(1000);
    expect(syncReq.open_kfid).toBe("kf_test123");
  });

  it("sends only token (no cursor) when no cursor but syncToken exists", async () => {
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

    // No persisted cursor (readFile fails by default mock)
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "webhook_token_789");

    // syncMessages should have been called with token but NOT cursor
    expect(mockSyncMessages).toHaveBeenCalledTimes(1);
    const syncReq = mockSyncMessages.mock.calls[0][2];
    expect(syncReq.token).toBe("webhook_token_789");
    expect(syncReq.cursor).toBeUndefined();
  });

  it("sends neither cursor nor token when both are empty, and logs", async () => {
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

    // No persisted cursor (readFile fails by default mock), empty syncToken
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    // syncMessages should have been called with neither cursor nor token
    expect(mockSyncMessages).toHaveBeenCalledTimes(1);
    const syncReq = mockSyncMessages.mock.calls[0][2];
    expect(syncReq.cursor).toBeUndefined();
    expect(syncReq.token).toBeUndefined();

    // Should log the initial batch message
    expect(logMessages.some((m) => m.includes("no cursor or token") && m.includes("initial batch"))).toBe(true);
  });

  it("uses cursor from pagination (next_cursor) for subsequent pages, not token", async () => {
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

    // No persisted cursor
    // Page 1: returns has_more=1 with next_cursor
    mockSyncMessages.mockResolvedValueOnce({
      errcode: 0,
      errmsg: "ok",
      next_cursor: "page1_cursor",
      has_more: 1,
      msg_list: [],
    });

    // Page 2: returns has_more=0
    mockSyncMessages.mockResolvedValueOnce({
      errcode: 0,
      errmsg: "ok",
      next_cursor: "page2_cursor",
      has_more: 0,
      msg_list: [],
    });

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "initial_token");

    // First call: should use token (no cursor)
    expect(mockSyncMessages).toHaveBeenCalledTimes(2);
    const req1 = mockSyncMessages.mock.calls[0][2];
    expect(req1.token).toBe("initial_token");
    expect(req1.cursor).toBeUndefined();

    // Second call: should use cursor from first response (no token)
    const req2 = mockSyncMessages.mock.calls[1][2];
    expect(req2.cursor).toBe("page1_cursor");
    expect(req2.token).toBeUndefined();
  });
});

// ── P2-08: Event message handling ──

describe("bot event message handling (P2-08)", () => {
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

  function makeEventMessage(eventType: string, extra?: Record<string, any>) {
    return {
      msgid: `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      open_kfid: "kf_test123",
      external_userid: "ext_user_1",
      send_time: Math.floor(Date.now() / 1000),
      origin: 4, // system origin
      msgtype: "event",
      event: {
        event_type: eventType,
        ...extra,
      },
    };
  }

  it("logs enter_session event with welcome_code", async () => {
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

    const eventMsg = makeEventMessage("enter_session", {
      welcome_code: "WELCOME_CODE_123",
      scene: "scene_param_1",
    });
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([eventMsg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    // Should log the enter_session event
    expect(
      logMessages.some(
        (m) =>
          m.includes("entered session") &&
          m.includes("welcome_code=WELCOME_CODE_123") &&
          m.includes("scene=scene_param_1"),
      ),
    ).toBe(true);

    // Should NOT attempt to dispatch as agent message
    expect(mockRuntime.channel.reply.dispatchReplyFromConfig).not.toHaveBeenCalled();
  });

  it("logs enter_session event without welcome_code", async () => {
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

    const eventMsg = makeEventMessage("enter_session", {});
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([eventMsg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    // Should log enter_session without welcome_code details
    expect(logMessages.some((m) => m.includes("entered session"))).toBe(true);
    expect(logMessages.some((m) => m.includes("welcome_code="))).toBe(false);
  });

  it("logs msg_send_fail event as error", async () => {
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

    const eventMsg = makeEventMessage("msg_send_fail", {
      fail_msgid: "failed_msg_001",
      fail_type: 1,
    });
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([eventMsg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    // Should log the failure as error
    expect(
      logMessages.some(
        (m) => m.includes("message send failed") && m.includes("msgid=failed_msg_001") && m.includes("type=1"),
      ),
    ).toBe(true);

    expect(mockRuntime.channel.reply.dispatchReplyFromConfig).not.toHaveBeenCalled();
  });

  it("logs servicer_status_change event", async () => {
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

    const eventMsg = makeEventMessage("servicer_status_change", {
      servicer_userid: "servicer_001",
      status: 1,
    });
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([eventMsg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    expect(
      logMessages.some((m) => m.includes("servicer status changed") && m.includes("servicer_001") && m.includes("1")),
    ).toBe(true);

    expect(mockRuntime.channel.reply.dispatchReplyFromConfig).not.toHaveBeenCalled();
  });

  it("logs unknown event type without throwing", async () => {
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

    const eventMsg = makeEventMessage("some_future_event", {});
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([eventMsg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    expect(logMessages.some((m) => m.includes("unhandled event") && m.includes("some_future_event"))).toBe(true);
    expect(mockRuntime.channel.reply.dispatchReplyFromConfig).not.toHaveBeenCalled();
  });

  it("processes event messages alongside normal messages without interference", async () => {
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

    const eventMsg = makeEventMessage("enter_session", { welcome_code: "WC_001" });
    const textMsg = makeTextMessage("ext_user_1", "hello after event", "mixed_msg_001");

    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([eventMsg, textMsg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    // Event should be logged
    expect(logMessages.some((m) => m.includes("entered session"))).toBe(true);

    // Normal text message should still be dispatched
    expect(mockRuntime.channel.reply.dispatchReplyFromConfig).toHaveBeenCalledTimes(1);
  });

  it("handles event with missing event field gracefully", async () => {
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

    // Event message with no event field at all
    const eventMsg = {
      msgid: "evt_no_field",
      open_kfid: "kf_test123",
      external_userid: "ext_user_1",
      send_time: Math.floor(Date.now() / 1000),
      origin: 4,
      msgtype: "event",
      // no event field
    };
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([eventMsg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    // Should not throw
    await handleWebhookEvent(ctx, "kf_test123", "");

    // Should log as unhandled event with undefined event_type
    expect(logMessages.some((m) => m.includes("unhandled event"))).toBe(true);
  });
});

// ── P2-02: extractText coverage for all message types ──
// extractText is private, but we exercise it via handleWebhookEvent.
// The extracted text is passed to formatAgentEnvelope as `body`.

describe("bot extractText coverage (P2-02)", () => {
  let logMessages: string[];
  let log: BotContext["log"];

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

  function makeMessage(msgtype: string, extra: Record<string, any> = {}) {
    return {
      msgid: `extract_${msgtype}_${Math.random().toString(36).slice(2)}`,
      open_kfid: "kf_test123",
      external_userid: "ext_user_1",
      send_time: Math.floor(Date.now() / 1000),
      origin: 3, // customer message
      msgtype,
      ...extra,
    };
  }

  /** Get the body text that was passed to formatAgentEnvelope */
  function getCapturedBody(mockRuntime: ReturnType<typeof makeMockRuntime>): string {
    const calls = mockRuntime.channel.reply.formatAgentEnvelope.mock.calls;
    if (calls.length === 0) return "";
    return calls[0][0]?.body ?? "";
  }

  beforeEach(() => {
    vi.clearAllMocks();
    _testing.resetState();
    mockDownloadMedia.mockResolvedValue({ buffer: Buffer.from("fake"), contentType: "image/jpeg" });
    logMessages = [];
    log = {
      info: (...args: any[]) => logMessages.push(args.join(" ")),
      error: (...args: any[]) => logMessages.push(args.join(" ")),
    };
  });

  it("extracts plain text from text message", async () => {
    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    const msg = makeMessage("text", { text: { content: "hello from user" } });
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    expect(getCapturedBody(mockRuntime)).toBe("hello from user");
  });

  it("extracts placeholder for image message", async () => {
    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    const msg = makeMessage("image", { image: { media_id: "img_media_1" } });
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    expect(getCapturedBody(mockRuntime)).toBe("[用户发送了一张图片]");
  });

  it("saves image as GIF when content-type is image/gif", async () => {
    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);
    mockDownloadMedia.mockResolvedValueOnce({ buffer: Buffer.from("gif"), contentType: "image/gif" });

    const msg = makeMessage("image", { image: { media_id: "img_gif_1" } });
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    const saveCall = mockRuntime.channel.media.saveMediaBuffer.mock.calls[0];
    expect(saveCall[1]).toBe("image/gif"); // mime
    expect(saveCall[4]).toMatch(/\.gif$/); // filename
  });

  it("saves image as PNG when content-type is image/png", async () => {
    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);
    mockDownloadMedia.mockResolvedValueOnce({ buffer: Buffer.from("png"), contentType: "image/png" });

    const msg = makeMessage("image", { image: { media_id: "img_png_1" } });
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    const saveCall = mockRuntime.channel.media.saveMediaBuffer.mock.calls[0];
    expect(saveCall[1]).toBe("image/png"); // mime
    expect(saveCall[4]).toMatch(/\.png$/); // filename
  });

  it("falls back to JPEG when content-type is missing", async () => {
    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);
    mockDownloadMedia.mockResolvedValueOnce({ buffer: Buffer.from("data"), contentType: "" });

    const msg = makeMessage("image", { image: { media_id: "img_no_ct" } });
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    const saveCall = mockRuntime.channel.media.saveMediaBuffer.mock.calls[0];
    expect(saveCall[1]).toBe("image/jpeg"); // fallback mime
    expect(saveCall[4]).toMatch(/\.jpg$/); // fallback extension
  });

  it("handles content-type with charset parameter", async () => {
    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);
    mockDownloadMedia.mockResolvedValueOnce({ buffer: Buffer.from("png"), contentType: "image/png; charset=utf-8" });

    const msg = makeMessage("image", { image: { media_id: "img_charset" } });
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    const saveCall = mockRuntime.channel.media.saveMediaBuffer.mock.calls[0];
    expect(saveCall[1]).toBe("image/png"); // parsed correctly
    expect(saveCall[4]).toMatch(/\.png$/); // correct extension
  });

  it("extracts placeholder for voice message", async () => {
    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    const msg = makeMessage("voice", { voice: { media_id: "voice_media_1" } });
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    expect(getCapturedBody(mockRuntime)).toBe("[用户发送了一段语音]");
  });

  it("extracts placeholder for video message", async () => {
    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    const msg = makeMessage("video", { video: { media_id: "video_media_1" } });
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    expect(getCapturedBody(mockRuntime)).toBe("[用户发送了一段视频]");
  });

  it("extracts placeholder for file message", async () => {
    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    const msg = makeMessage("file", { file: { media_id: "file_media_1" } });
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    expect(getCapturedBody(mockRuntime)).toBe("[用户发送了一个文件]");
  });

  it("extracts location with name and address", async () => {
    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    const msg = makeMessage("location", {
      location: { latitude: 39.9, longitude: 116.3, name: "故宫", address: "北京市东城区" },
    });
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    const body = getCapturedBody(mockRuntime);
    expect(body).toContain("位置");
    expect(body).toContain("故宫");
    expect(body).toContain("北京市东城区");
  });

  it("extracts link with title and URL", async () => {
    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    const msg = makeMessage("link", {
      link: { title: "Example", desc: "A link", url: "https://example.com", pic_url: "" },
    });
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    const body = getCapturedBody(mockRuntime);
    expect(body).toContain("链接");
    expect(body).toContain("Example");
    expect(body).toContain("https://example.com");
  });

  it("extracts merged_msg (forwarded chat records) with items", async () => {
    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    const msg = makeMessage("merged_msg", {
      merged_msg: {
        title: "聊天记录",
        item: [
          { sender_name: "Alice", msg_content: JSON.stringify({ msgtype: "text", text: { content: "hi" } }) },
          { sender_name: "Bob", msg_content: JSON.stringify({ image: {} }) },
        ],
      },
    });
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    const body = getCapturedBody(mockRuntime);
    expect(body).toContain("转发的聊天记录");
    expect(body).toContain("Alice: hi");
    expect(body).toContain("Bob: [图片]");
  });

  it("extracts merged_msg with no items gracefully", async () => {
    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    const msg = makeMessage("merged_msg", {
      merged_msg: { title: "空记录", item: [] },
    });
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    const body = getCapturedBody(mockRuntime);
    expect(body).toContain("转发的聊天记录: 空记录");
  });

  it("extracts merged_msg without merged_msg field (fallback)", async () => {
    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    const msg = makeMessage("merged_msg");
    // no merged_msg field at all
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    const body = getCapturedBody(mockRuntime);
    expect(body).toBe("[转发的聊天记录]");
  });

  it("extracts channels message (video account)", async () => {
    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    const msg = makeMessage("channels", {
      channels: { sub_type: 1, nickname: "测试号", title: "精彩视频" },
    });
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    const body = getCapturedBody(mockRuntime);
    expect(body).toContain("视频号动态");
    expect(body).toContain("测试号");
    expect(body).toContain("精彩视频");
  });

  it("extracts miniprogram message", async () => {
    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    const msg = makeMessage("miniprogram", {
      miniprogram: { title: "小测试", appid: "wx_mp_001" },
    });
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    const body = getCapturedBody(mockRuntime);
    expect(body).toContain("小程序");
    expect(body).toContain("小测试");
    expect(body).toContain("wx_mp_001");
  });

  it("extracts business_card message", async () => {
    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    const msg = makeMessage("business_card", {
      business_card: { userid: "card_user_001" },
    });
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    const body = getCapturedBody(mockRuntime);
    expect(body).toContain("名片");
    expect(body).toContain("card_user_001");
  });

  it("returns null for event type (skips dispatch)", async () => {
    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    // event with origin=3 to test extractText returning null
    const msg = makeMessage("event", {
      origin: 3,
      event: { event_type: "enter_session" },
    });
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    // Event messages are handled before extractText (origin check), dispatch should not be called
    expect(mockRuntime.channel.reply.dispatchReplyFromConfig).not.toHaveBeenCalled();
  });

  it("returns fallback text for unknown message type", async () => {
    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    const msg = makeMessage("some_future_type");
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    const body = getCapturedBody(mockRuntime);
    expect(body).toContain("未支持的消息类型");
    expect(body).toContain("some_future_type");
  });

  it("skips empty text content (does not dispatch)", async () => {
    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    const msg = makeMessage("text", { text: { content: "" } });
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    expect(mockRuntime.channel.reply.dispatchReplyFromConfig).not.toHaveBeenCalled();
  });
});
