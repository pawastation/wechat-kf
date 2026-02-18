import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WechatKfSyncMsgResponse } from "./types.js";

// ── Mock all heavy dependencies ──

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn().mockRejectedValue(new Error("no cursor")),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
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

import { handleWebhookEvent, type BotContext } from "./bot.js";

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

function makeTextMessage(externalUserId: string, text: string) {
  return {
    msgid: `msg_${Date.now()}`,
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
