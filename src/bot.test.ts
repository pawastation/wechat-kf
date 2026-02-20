import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WechatKfSyncMsgResponse } from "./types.js";

// ── Mock all heavy dependencies ──

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn().mockResolvedValue("existing_cursor"),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
}));

const mockSyncMessages = vi.fn<(...args: any[]) => Promise<WechatKfSyncMsgResponse>>();
const mockDownloadMedia = vi.fn();
const mockSendTextMessage = vi.fn().mockResolvedValue({ errcode: 0, errmsg: "ok" });
vi.mock("./api.js", () => ({
  syncMessages: (...args: any[]) => mockSyncMessages(...args),
  downloadMedia: (...args: any[]) => mockDownloadMedia(...args),
  sendTextMessage: (...args: any[]) => mockSendTextMessage(...args),
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

const mockSetPairingKfId = vi.fn();
vi.mock("./monitor.js", () => ({
  setPairingKfId: (...args: any[]) => mockSetPairingKfId(...args),
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
      pairing: {
        readAllowFromStore: vi.fn().mockResolvedValue([]),
        upsertPairingRequest: vi.fn().mockResolvedValue({ code: "ABC12345", created: true }),
        buildPairingReply: vi.fn().mockReturnValue("Your pairing code is ABC12345"),
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

  it("pairing: blocks unauthorized sender and sends pairing reply", async () => {
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
    mockRuntime.channel.pairing.readAllowFromStore.mockResolvedValue([]);
    mockRuntime.channel.pairing.upsertPairingRequest.mockResolvedValue({ code: "ABC12345", created: true });
    mockGetRuntime.mockReturnValue(mockRuntime);

    const msg = makeTextMessage("ext_user_1", "hello");
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    expect(mockRuntime.channel.reply.dispatchReplyFromConfig).not.toHaveBeenCalled();
    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
    expect(logMessages.some((m) => m.includes("pairing request"))).toBe(true);
  });

  it("pairing: allows sender found in pairing store", async () => {
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
    mockRuntime.channel.pairing.readAllowFromStore.mockResolvedValue(["ext_user_1"]);
    mockGetRuntime.mockReturnValue(mockRuntime);

    const msg = makeTextMessage("ext_user_1", "hello");
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    expect(mockRuntime.channel.reply.dispatchReplyFromConfig).toHaveBeenCalledTimes(1);
  });

  it("pairing: does not re-send reply on repeat (created=false)", async () => {
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
    mockRuntime.channel.pairing.readAllowFromStore.mockResolvedValue([]);
    mockRuntime.channel.pairing.upsertPairingRequest.mockResolvedValue({ code: "ABC12345", created: false });
    mockGetRuntime.mockReturnValue(mockRuntime);

    const msg = makeTextMessage("ext_user_1", "hello");
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    expect(mockSendTextMessage).not.toHaveBeenCalled();
    expect(mockRuntime.channel.reply.dispatchReplyFromConfig).not.toHaveBeenCalled();
  });

  it("allowlist: also checks pairing store", async () => {
    const cfg = {
      channels: {
        "wechat-kf": {
          corpId: "corp1",
          appSecret: "secret1",
          token: "tok",
          encodingAESKey: "key",
          dmPolicy: "allowlist",
          allowFrom: ["allowed_static"],
        },
      },
    };

    const mockRuntime = makeMockRuntime();
    mockRuntime.channel.pairing.readAllowFromStore.mockResolvedValue(["ext_user_1"]);
    mockGetRuntime.mockReturnValue(mockRuntime);

    const msg = makeTextMessage("ext_user_1", "hello");
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    expect(mockRuntime.channel.reply.dispatchReplyFromConfig).toHaveBeenCalledTimes(1);
  });

  it("readAllowFromStore failure degrades to config-only", async () => {
    const cfg = {
      channels: {
        "wechat-kf": {
          corpId: "corp1",
          appSecret: "secret1",
          token: "tok",
          encodingAESKey: "key",
          dmPolicy: "allowlist",
          allowFrom: ["ext_user_1"],
        },
      },
    };

    const mockRuntime = makeMockRuntime();
    mockRuntime.channel.pairing.readAllowFromStore.mockRejectedValue(new Error("store error"));
    mockGetRuntime.mockReturnValue(mockRuntime);

    const msg = makeTextMessage("ext_user_1", "hello");
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

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

  it("uses next_cursor from pagination for subsequent pages", async () => {
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
    await handleWebhookEvent(ctx, "kf_test123", "");

    // First call: should use the existing cursor (default mock)
    expect(mockSyncMessages).toHaveBeenCalledTimes(2);
    const req1 = mockSyncMessages.mock.calls[0][2];
    expect(req1.cursor).toBe("existing_cursor");
    expect(req1.token).toBeUndefined();

    // Second call: should use next_cursor from first response
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
      warn: (...args: any[]) => logMessages.push(args.join(" ")),
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

    // Should log the failure as error with label
    expect(
      logMessages.some(
        (m) =>
          m.includes("message send failed") &&
          m.includes("msgid=failed_msg_001") &&
          m.includes("type=1") &&
          m.includes("(unrecognized)"),
      ),
    ).toBe(true);

    expect(mockRuntime.channel.reply.dispatchReplyFromConfig).not.toHaveBeenCalled();
  });

  it("logs content security warning for fail_type=13", async () => {
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
      fail_msgid: "failed_msg_cs",
      fail_type: 13,
    });
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([eventMsg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    // Should include label in error
    expect(
      logMessages.some(
        (m) => m.includes("message send failed") && m.includes("type=13") && m.includes("content security"),
      ),
    ).toBe(true);

    // Should also log a warn with actionable advice
    expect(logMessages.some((m) => m.includes("content security block") && m.includes("numbered lists"))).toBe(true);
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
    mockDownloadMedia.mockResolvedValue({ buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]), contentType: "image/jpeg" });
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

  it("detects GIF from magic bytes regardless of content-type", async () => {
    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);
    // GIF89a magic bytes, but content-type says JPEG (WeChat lies)
    mockDownloadMedia.mockResolvedValueOnce({
      buffer: Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]),
      contentType: "image/jpeg",
    });

    const msg = makeMessage("image", { image: { media_id: "img_gif_1" } });
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    const saveCall = mockRuntime.channel.media.saveMediaBuffer.mock.calls[0];
    expect(saveCall[1]).toBe("image/gif"); // mime from magic bytes
    expect(saveCall[4]).toMatch(/\.gif$/); // filename
  });

  it("detects PNG from magic bytes regardless of content-type", async () => {
    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);
    // PNG magic bytes, but content-type says JPEG
    mockDownloadMedia.mockResolvedValueOnce({
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]),
      contentType: "image/jpeg",
    });

    const msg = makeMessage("image", { image: { media_id: "img_png_1" } });
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    const saveCall = mockRuntime.channel.media.saveMediaBuffer.mock.calls[0];
    expect(saveCall[1]).toBe("image/png"); // mime from magic bytes
    expect(saveCall[4]).toMatch(/\.png$/); // filename
  });

  it("falls back to content-type when magic bytes unknown", async () => {
    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);
    // Unknown magic bytes, content-type provides the answer
    mockDownloadMedia.mockResolvedValueOnce({
      buffer: Buffer.from([0x00, 0x00, 0x00, 0x00]),
      contentType: "image/webp",
    });

    const msg = makeMessage("image", { image: { media_id: "img_ct_fallback" } });
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    const saveCall = mockRuntime.channel.media.saveMediaBuffer.mock.calls[0];
    expect(saveCall[1]).toBe("image/webp"); // from content-type fallback
    expect(saveCall[4]).toMatch(/\.webp$/); // filename
  });

  it("falls back to JPEG when both magic bytes and content-type are unknown", async () => {
    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);
    mockDownloadMedia.mockResolvedValueOnce({ buffer: Buffer.from([0x00, 0x00, 0x00, 0x00]), contentType: "" });

    const msg = makeMessage("image", { image: { media_id: "img_no_ct" } });
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    const saveCall = mockRuntime.channel.media.saveMediaBuffer.mock.calls[0];
    expect(saveCall[1]).toBe("image/jpeg"); // final fallback
    expect(saveCall[4]).toMatch(/\.jpg$/); // fallback extension
  });

  it("handles content-type with charset parameter as fallback", async () => {
    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);
    // Unknown magic bytes, content-type with charset
    mockDownloadMedia.mockResolvedValueOnce({
      buffer: Buffer.from([0x00, 0x00, 0x00, 0x00]),
      contentType: "image/png; charset=utf-8",
    });

    const msg = makeMessage("image", { image: { media_id: "img_charset" } });
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    const saveCall = mockRuntime.channel.media.saveMediaBuffer.mock.calls[0];
    expect(saveCall[1]).toBe("image/png"); // parsed correctly from content-type
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

  it("extracts location with name, address, and coordinates", async () => {
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
    expect(body).toContain("39.9");
    expect(body).toContain("116.3");
  });

  it("extracts location with coordinates only (no name/address)", async () => {
    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    const msg = makeMessage("location", {
      location: { latitude: 39.9, longitude: 116.3 },
    });
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    const body = getCapturedBody(mockRuntime);
    expect(body).toContain("位置");
    expect(body).toContain("39.9");
    expect(body).toContain("116.3");
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

  it("includes raw JSON for unknown message type", async () => {
    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    const msg = makeMessage("contact_card", { contact_card: { userid: "user_abc" } });
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    const body = getCapturedBody(mockRuntime);
    expect(body).toContain("未支持的消息类型: contact_card");
    expect(body).toContain("原始JSON");
    expect(body).toContain('"contact_card"');
    expect(body).toContain('"userid"');
    expect(body).toContain("user_abc");
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

  // ── text with menu_id ──

  it("extracts text with menu_id appended", async () => {
    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    const msg = makeMessage("text", { text: { content: "选项A", menu_id: "menu_001" } });
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    expect(getCapturedBody(mockRuntime)).toBe("选项A [menu_id: menu_001]");
  });

  it("extracts text without menu_id (plain content only)", async () => {
    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    const msg = makeMessage("text", { text: { content: "just text" } });
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    expect(getCapturedBody(mockRuntime)).toBe("just text");
  });

  // ── link with desc + pic_url ──

  it("extracts link with desc and pic_url", async () => {
    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    const msg = makeMessage("link", {
      link: {
        title: "Example",
        desc: "A description",
        url: "https://example.com",
        pic_url: "https://example.com/pic.jpg",
      },
    });
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    const body = getCapturedBody(mockRuntime);
    expect(body).toContain("Example - A description");
    expect(body).toContain("https://example.com");
    expect(body).toContain("pic_url: https://example.com/pic.jpg");
  });

  it("extracts link without desc or pic_url", async () => {
    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    const msg = makeMessage("link", {
      link: { title: "Only Title", url: "https://example.com" },
    });
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    const body = getCapturedBody(mockRuntime);
    expect(body).toContain("Only Title");
    expect(body).toContain("https://example.com");
    expect(body).not.toContain("pic_url");
  });

  // ── miniprogram with pagepath + thumb_media_id ──

  it("extracts miniprogram with pagepath and thumb_media_id", async () => {
    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    const msg = makeMessage("miniprogram", {
      miniprogram: { title: "小商店", appid: "wx123", pagepath: "pages/index", thumb_media_id: "thumb_001" },
    });
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    const body = getCapturedBody(mockRuntime);
    expect(body).toContain("小程序");
    expect(body).toContain("小商店");
    expect(body).toContain("wx123");
    expect(body).toContain("pagepath: pages/index");
    expect(body).toContain("thumb_media_id: thumb_001");
  });

  it("extracts miniprogram without pagepath or thumb_media_id", async () => {
    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    const msg = makeMessage("miniprogram", {
      miniprogram: { title: "简单小程序", appid: "wx456" },
    });
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    const body = getCapturedBody(mockRuntime);
    expect(body).toBe("[小程序] 简单小程序 (appid: wx456)");
    expect(body).not.toContain("pagepath");
    expect(body).not.toContain("thumb_media_id");
  });

  // ── merged_msg with send_time ──

  it("extracts merged_msg items with send_time timestamps", async () => {
    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    const msg = makeMessage("merged_msg", {
      merged_msg: {
        title: "带时间的记录",
        item: [
          {
            sender_name: "Alice",
            msg_content: JSON.stringify({ msgtype: "text", text: { content: "hello" } }),
            send_time: 1700000000,
          },
          {
            sender_name: "Bob",
            msg_content: JSON.stringify({ image: {} }),
          },
        ],
      },
    });
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    const body = getCapturedBody(mockRuntime);
    expect(body).toContain("带时间的记录");
    // Alice's line should include a timestamp
    expect(body).toMatch(/Alice \(\d{4}\/\d{1,2}\/\d{1,2}/);
    expect(body).toContain("hello");
    // Bob has no send_time, so no parenthetical timestamp
    expect(body).toMatch(/Bob: \[图片\]/);
  });

  // ── channels_shop_product ──

  it("extracts channels_shop_product with all fields", async () => {
    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    const msg = makeMessage("channels_shop_product", {
      channels_shop_product: {
        product_id: "P001",
        head_image: "https://img.example.com/product.jpg",
        title: "测试商品",
        sales_price: "99.00",
        shop_nickname: "好物店",
        shop_head_image: "https://img.example.com/shop.jpg",
      },
    });
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    const body = getCapturedBody(mockRuntime);
    expect(body).toContain("视频号商品");
    expect(body).toContain("测试商品");
    expect(body).toContain("价格: 99.00");
    expect(body).toContain("店铺: 好物店");
    expect(body).toContain("商品ID: P001");
    expect(body).toContain("图片: https://img.example.com/product.jpg");
    expect(body).toContain("店铺头像: https://img.example.com/shop.jpg");
  });

  it("extracts channels_shop_product with minimal fields", async () => {
    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    const msg = makeMessage("channels_shop_product", {
      channels_shop_product: {},
    });
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    const body = getCapturedBody(mockRuntime);
    expect(body).toBe("[视频号商品]");
  });

  // ── channels_shop_order ──

  it("extracts channels_shop_order with all fields", async () => {
    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    const msg = makeMessage("channels_shop_order", {
      channels_shop_order: {
        order_id: "ORD001",
        product_titles: "高级茶具套装",
        price_wording: "¥288.00",
        state: "已完成",
        image_url: "https://img.example.com/order.jpg",
        shop_nickname: "茶道优选",
      },
    });
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    const body = getCapturedBody(mockRuntime);
    expect(body).toContain("视频号订单");
    expect(body).toContain("高级茶具套装");
    expect(body).toContain("金额: ¥288.00");
    expect(body).toContain("状态: 已完成");
    expect(body).toContain("店铺: 茶道优选");
    expect(body).toContain("订单ID: ORD001");
    expect(body).toContain("图片: https://img.example.com/order.jpg");
  });

  it("extracts channels_shop_order with minimal fields", async () => {
    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    const msg = makeMessage("channels_shop_order", {
      channels_shop_order: {},
    });
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    const body = getCapturedBody(mockRuntime);
    expect(body).toBe("[视频号订单]");
  });

  // ── note ──

  it("extracts note message placeholder", async () => {
    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    const msg = makeMessage("note");
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    expect(getCapturedBody(mockRuntime)).toBe("[用户发送了一条笔记]");
  });
});

// ── raw_msg debug log ──

describe("bot raw_msg debug log", () => {
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

  it("logs raw_msg with JSON.stringify for each message", async () => {
    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    const msg = {
      msgid: "raw_log_test_1",
      open_kfid: "kf_test123",
      external_userid: "ext_user_1",
      send_time: Math.floor(Date.now() / 1000),
      origin: 3,
      msgtype: "text",
      text: { content: "hello" },
    };
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    const rawLogEntry = logMessages.find((m) => m.includes("raw_msg") && m.includes("raw_log_test_1"));
    expect(rawLogEntry).toBeDefined();
    expect(rawLogEntry).toContain("type=text");
    expect(rawLogEntry).toContain('"msgid"');
    expect(rawLogEntry).toContain('"text"');
  });
});

// ── Cursor loss protection (Layer 1 + Layer 2) ──

describe("cursor loss protection", () => {
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

  // ── Layer 1: Cold Start Catch-up ──

  it("drains without dispatching when no cursor exists", async () => {
    const fsp = await import("node:fs/promises");
    (fsp.readFile as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("no cursor"));

    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    const msg = makeTextMessage("user1", "old message", "drain_msg_1");
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    // Should NOT dispatch any messages
    expect(mockRuntime.channel.reply.dispatchReplyFromConfig).not.toHaveBeenCalled();
    // Should log drain activity
    expect(logMessages.some((m) => m.includes("no cursor, draining"))).toBe(true);
    expect(logMessages.some((m) => m.includes("cold start catch-up") && m.includes("skipped 1 messages"))).toBe(true);
  });

  it("saves the latest cursor during drain", async () => {
    const fsp = await import("node:fs/promises");
    (fsp.readFile as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("no cursor"));
    const mockRename = fsp.rename as ReturnType<typeof vi.fn>;
    const mockWriteFile = fsp.writeFile as ReturnType<typeof vi.fn>;

    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    mockSyncMessages.mockResolvedValueOnce({
      errcode: 0,
      errmsg: "ok",
      next_cursor: "drained_cursor_abc",
      has_more: 0,
      msg_list: [makeTextMessage("user1", "old", "drain_save_1")],
    });

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    // Cursor should be saved via atomicWriteFile (writeFile + rename)
    expect(mockWriteFile).toHaveBeenCalledWith(expect.stringContaining("cursor"), "drained_cursor_abc", "utf8");
    expect(mockRename).toHaveBeenCalled();
  });

  it("handles multi-page drain correctly", async () => {
    const fsp = await import("node:fs/promises");
    (fsp.readFile as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("no cursor"));

    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    // Page 1: has_more = 1
    mockSyncMessages.mockResolvedValueOnce({
      errcode: 0,
      errmsg: "ok",
      next_cursor: "drain_page1",
      has_more: 1,
      msg_list: [makeTextMessage("user1", "p1", "drain_p1_1"), makeTextMessage("user1", "p1b", "drain_p1_2")],
    });

    // Page 2: has_more = 0
    mockSyncMessages.mockResolvedValueOnce({
      errcode: 0,
      errmsg: "ok",
      next_cursor: "drain_page2",
      has_more: 0,
      msg_list: [makeTextMessage("user1", "p2", "drain_p2_1")],
    });

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "sync_token_123");

    // Should have called syncMessages twice
    expect(mockSyncMessages).toHaveBeenCalledTimes(2);

    // First drain call should use token (no cursor yet)
    const req1 = mockSyncMessages.mock.calls[0][2];
    expect(req1.token).toBe("sync_token_123");
    expect(req1.cursor).toBeUndefined();

    // Second drain call should use cursor from first page
    const req2 = mockSyncMessages.mock.calls[1][2];
    expect(req2.cursor).toBe("drain_page1");
    expect(req2.token).toBeUndefined();

    // No messages dispatched
    expect(mockRuntime.channel.reply.dispatchReplyFromConfig).not.toHaveBeenCalled();

    // Log should report total drained count
    expect(logMessages.some((m) => m.includes("skipped 3 messages"))).toBe(true);
  });

  it("handles drain sync_msg failure gracefully", async () => {
    const fsp = await import("node:fs/promises");
    (fsp.readFile as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("no cursor"));

    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    mockSyncMessages.mockRejectedValueOnce(new Error("network timeout"));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    // Should not throw
    await handleWebhookEvent(ctx, "kf_test123", "");

    expect(logMessages.some((m) => m.includes("drain failed") && m.includes("network timeout"))).toBe(true);
    expect(mockRuntime.channel.reply.dispatchReplyFromConfig).not.toHaveBeenCalled();
  });

  it("uses saved cursor for normal processing after drain", async () => {
    const fsp = await import("node:fs/promises");

    // First call: no cursor → drain
    (fsp.readFile as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("no cursor"));
    mockSyncMessages.mockResolvedValueOnce({
      errcode: 0,
      errmsg: "ok",
      next_cursor: "drained_cursor",
      has_more: 0,
      msg_list: [makeTextMessage("user1", "old msg", "drain_then_normal_1")],
    });

    // Second call: has cursor → normal processing
    (fsp.readFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce("drained_cursor");
    const freshMsg = makeTextMessage("user1", "new msg", "fresh_msg_1");
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([freshMsg]));

    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };

    await handleWebhookEvent(ctx, "kf_test123", "sync_token");
    await handleWebhookEvent(ctx, "kf_test123", "");

    // Only the second call's message should be dispatched (drain skips messages)
    expect(mockRuntime.channel.reply.dispatchReplyFromConfig).toHaveBeenCalledTimes(1);

    // Second call should have used cursor
    const secondSyncReq = mockSyncMessages.mock.calls[1][2];
    expect(secondSyncReq.cursor).toBe("drained_cursor");
    expect(secondSyncReq.token).toBeUndefined();
  });

  it("does not drain when cursor exists — processes messages normally", async () => {
    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    const msg = makeTextMessage("user1", "hello", "normal_msg_1");
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    // Message should be dispatched normally
    expect(mockRuntime.channel.reply.dispatchReplyFromConfig).toHaveBeenCalledTimes(1);
    // Should NOT log drain
    expect(logMessages.some((m) => m.includes("draining"))).toBe(false);
  });

  // ── Layer 2: Message age filter ──

  it("dispatches fresh messages (age < 5 minutes)", async () => {
    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    // Message from 60 seconds ago
    const msg = {
      ...makeTextMessage("user1", "recent", "fresh_age_1"),
      send_time: Math.floor(Date.now() / 1000) - 60,
    };
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    expect(mockRuntime.channel.reply.dispatchReplyFromConfig).toHaveBeenCalledTimes(1);
  });

  it("skips stale messages (age > 5 minutes)", async () => {
    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    // Message from 10 minutes ago
    const msg = {
      ...makeTextMessage("user1", "old message", "stale_age_1"),
      send_time: Math.floor(Date.now() / 1000) - 600,
    };
    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([msg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    expect(mockRuntime.channel.reply.dispatchReplyFromConfig).not.toHaveBeenCalled();
    expect(logMessages.some((m) => m.includes("skipping stale msg stale_age_1") && m.includes("age="))).toBe(true);
  });

  it("dispatches only fresh messages in a mixed batch", async () => {
    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    const now = Math.floor(Date.now() / 1000);
    const freshMsg = { ...makeTextMessage("user1", "fresh", "mixed_fresh_1"), send_time: now - 30 };
    const staleMsg = { ...makeTextMessage("user1", "stale", "mixed_stale_1"), send_time: now - 600 };
    const freshMsg2 = { ...makeTextMessage("user1", "fresh2", "mixed_fresh_2"), send_time: now - 120 };

    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([freshMsg, staleMsg, freshMsg2]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    // Only the 2 fresh messages should be dispatched
    expect(mockRuntime.channel.reply.dispatchReplyFromConfig).toHaveBeenCalledTimes(2);
    // Stale message should be logged
    expect(logMessages.some((m) => m.includes("skipping stale msg mixed_stale_1"))).toBe(true);
  });

  it("filters stale messages even with valid cursor (corrupt cursor scenario)", async () => {
    const fsp = await import("node:fs/promises");
    // Cursor exists but points to an old position (e.g. stale/corrupt cursor)
    (fsp.readFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce("stale_but_valid_cursor");

    const mockRuntime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(mockRuntime);

    const now = Math.floor(Date.now() / 1000);
    // All messages are old — cursor was pointing to an old position
    const oldMsg1 = { ...makeTextMessage("user1", "old1", "corrupt_cursor_1"), send_time: now - 7200 }; // 2h ago
    const oldMsg2 = { ...makeTextMessage("user1", "old2", "corrupt_cursor_2"), send_time: now - 3600 }; // 1h ago
    const recentMsg = { ...makeTextMessage("user1", "recent", "corrupt_cursor_3"), send_time: now - 10 }; // 10s ago

    mockSyncMessages.mockResolvedValueOnce(makeSyncResponse([oldMsg1, oldMsg2, recentMsg]));

    const ctx: BotContext = { cfg, stateDir: "/tmp/state", log };
    await handleWebhookEvent(ctx, "kf_test123", "");

    // Only the recent message should be dispatched
    expect(mockRuntime.channel.reply.dispatchReplyFromConfig).toHaveBeenCalledTimes(1);
    expect(logMessages.some((m) => m.includes("skipping stale msg corrupt_cursor_1"))).toBe(true);
    expect(logMessages.some((m) => m.includes("skipping stale msg corrupt_cursor_2"))).toBe(true);
  });
});
