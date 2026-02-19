import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock dependencies ──

const mockSendTextMessage = vi.fn();
const mockSendLinkMessage = vi.fn();
const mockUploadMedia = vi.fn();
vi.mock("./api.js", () => ({
  sendTextMessage: (...args: any[]) => mockSendTextMessage(...args),
  sendLinkMessage: (...args: any[]) => mockSendLinkMessage(...args),
  uploadMedia: (...args: any[]) => mockUploadMedia(...args),
  sendImageMessage: vi.fn().mockResolvedValue({ errcode: 0, errmsg: "ok", msgid: "img_disp" }),
  sendVoiceMessage: vi.fn().mockResolvedValue({ errcode: 0, errmsg: "ok", msgid: "voice_disp" }),
  sendVideoMessage: vi.fn().mockResolvedValue({ errcode: 0, errmsg: "ok", msgid: "video_disp" }),
  sendFileMessage: vi.fn().mockResolvedValue({ errcode: 0, errmsg: "ok", msgid: "file_disp" }),
}));

const mockResolveAccount = vi.fn();
vi.mock("./accounts.js", () => ({
  resolveAccount: (...args: any[]) => mockResolveAccount(...args),
}));

const mockReadFile = vi.fn();
vi.mock("node:fs/promises", () => ({
  readFile: (...args: any[]) => mockReadFile(...args),
}));

const mockDownloadMediaFromUrl = vi.fn();
vi.mock("./send-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./send-utils.js")>();
  return {
    ...actual,
    downloadMediaFromUrl: (...args: any[]) => mockDownloadMediaFromUrl(...args),
  };
});

// Capture the deliver callback that createReplyDispatcher passes to the runtime
let capturedDeliver: ((payload: any) => Promise<void>) | null = null;
let capturedOnError: ((err: any, info: any) => void) | null = null;

const mockGetRuntime = vi.fn();
vi.mock("./runtime.js", () => ({
  getRuntime: () => mockGetRuntime(),
}));

// ── Import after mocks ──

import { type CreateReplyDispatcherParams, createReplyDispatcher } from "./reply-dispatcher.js";

// ── Helpers ──

const defaultAccount = {
  accountId: "kf_test",
  openKfId: "kf_test",
  corpId: "corp1",
  appSecret: "secret1",
  enabled: true,
  configured: true,
  webhookPath: "/wechat-kf",
  config: {},
};

function makeMockRuntime() {
  return {
    channel: {
      text: {
        resolveTextChunkLimit: vi.fn().mockReturnValue(2000),
        resolveChunkMode: vi.fn().mockReturnValue("length"),
        chunkTextWithMode: vi.fn((text: string) => [text]), // no splitting by default
      },
      reply: {
        resolveHumanDelayConfig: vi.fn().mockReturnValue({}),
        createReplyDispatcherWithTyping: vi.fn((opts: any) => {
          capturedDeliver = opts.deliver;
          capturedOnError = opts.onError;
          return {
            dispatcher: { deliver: opts.deliver },
            replyOptions: {},
            markDispatchIdle: vi.fn(),
          };
        }),
      },
    },
  };
}

function makeParams(overrides: Partial<CreateReplyDispatcherParams> = {}): CreateReplyDispatcherParams {
  return {
    cfg: { channels: { "wechat-kf": {} } },
    agentId: "agent_1",
    runtime: { error: vi.fn() },
    externalUserId: "ext_user_1",
    openKfId: "kf_test",
    accountId: "kf_test",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedDeliver = null;
  capturedOnError = null;
  mockResolveAccount.mockReturnValue(defaultAccount);
  mockSendTextMessage.mockResolvedValue({ errcode: 0, errmsg: "ok", msgid: "txt_disp" });
  mockSendLinkMessage.mockResolvedValue({ errcode: 0, errmsg: "ok", msgid: "link_disp" });
  mockUploadMedia.mockResolvedValue({
    errcode: 0,
    errmsg: "ok",
    type: "image",
    media_id: "mid_disp",
    created_at: 123,
  });
});

// ── Tests ──

describe("createReplyDispatcher", () => {
  it("returns dispatcher, replyOptions, and markDispatchIdle", () => {
    const runtime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(runtime);

    const result = createReplyDispatcher(makeParams());

    expect(result.dispatcher).toBeDefined();
    expect(result.replyOptions).toBeDefined();
    expect(typeof result.markDispatchIdle).toBe("function");
  });

  it("resolves text chunk limit from runtime", () => {
    const runtime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(runtime);

    createReplyDispatcher(makeParams());

    expect(runtime.channel.text.resolveTextChunkLimit).toHaveBeenCalledWith(
      expect.any(Object),
      "wechat-kf",
      "kf_test",
      expect.objectContaining({ fallbackLimit: 2000 }),
    );
  });

  it("resolves chunk mode from runtime", () => {
    const runtime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(runtime);

    createReplyDispatcher(makeParams());

    expect(runtime.channel.text.resolveChunkMode).toHaveBeenCalledWith(expect.any(Object), "wechat-kf");
  });
});

describe("deliver callback: text", () => {
  it("sends formatted text via sendTextMessage", async () => {
    const runtime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(runtime);

    createReplyDispatcher(makeParams());
    expect(capturedDeliver).toBeDefined();

    await capturedDeliver?.({ text: "hello world", attachments: [] });

    expect(mockSendTextMessage).toHaveBeenCalledWith("corp1", "secret1", "ext_user_1", "kf_test", expect.any(String));
  });

  it("applies formatText (markdown to unicode) before sending", async () => {
    const runtime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(runtime);

    createReplyDispatcher(makeParams());
    await capturedDeliver?.({ text: "**bold text**", attachments: [] });

    const sentText = mockSendTextMessage.mock.calls[0][4];
    expect(sentText).not.toContain("**");
  });

  it("chunks text using runtime chunkTextWithMode", async () => {
    const runtime = makeMockRuntime();
    runtime.channel.text.chunkTextWithMode.mockReturnValue(["chunk1", "chunk2"]);
    mockGetRuntime.mockReturnValue(runtime);

    createReplyDispatcher(makeParams());
    await capturedDeliver?.({ text: "long text here", attachments: [] });

    expect(runtime.channel.text.chunkTextWithMode).toHaveBeenCalled();
    expect(mockSendTextMessage).toHaveBeenCalledTimes(2);
    expect(mockSendTextMessage).toHaveBeenNthCalledWith(1, "corp1", "secret1", "ext_user_1", "kf_test", "chunk1");
    expect(mockSendTextMessage).toHaveBeenNthCalledWith(2, "corp1", "secret1", "ext_user_1", "kf_test", "chunk2");
  });

  it("does not send text when payload text is empty/whitespace", async () => {
    const runtime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(runtime);

    createReplyDispatcher(makeParams());
    await capturedDeliver?.({ text: "   ", attachments: [] });

    expect(mockSendTextMessage).not.toHaveBeenCalled();
  });

  it("does nothing when both text and attachments are empty", async () => {
    const runtime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(runtime);

    createReplyDispatcher(makeParams());
    await capturedDeliver?.({ text: "", attachments: [] });

    expect(mockSendTextMessage).not.toHaveBeenCalled();
  });
});

describe("deliver callback: media attachments", () => {
  it("uploads and sends image attachment", async () => {
    const runtime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(runtime);
    mockReadFile.mockResolvedValue(Buffer.from("img data"));

    createReplyDispatcher(makeParams());

    const { sendImageMessage } = await import("./api.js");

    await capturedDeliver?.({
      text: "",
      attachments: [{ path: "/tmp/photo.jpg", type: "image" }],
    });

    expect(mockReadFile).toHaveBeenCalledWith("/tmp/photo.jpg");
    expect(mockUploadMedia).toHaveBeenCalledWith("corp1", "secret1", "image", expect.any(Buffer), "photo.jpg");
    expect(sendImageMessage).toHaveBeenCalled();
  });

  it("logs error and continues when attachment upload fails", async () => {
    const runtime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(runtime);
    mockReadFile.mockRejectedValue(new Error("ENOENT"));

    const params = makeParams();
    createReplyDispatcher(params);

    await capturedDeliver?.({
      text: "text after failed media",
      attachments: [{ path: "/tmp/missing.jpg", type: "image" }],
    });

    // Error should be logged
    expect(params.runtime.error).toHaveBeenCalledWith(expect.stringContaining("failed to send"));

    // Text should still be sent despite attachment failure
    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
  });

  it("skips attachment with no path", async () => {
    const runtime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(runtime);

    createReplyDispatcher(makeParams());

    await capturedDeliver?.({
      text: "text only",
      attachments: [{ type: "image" }], // no path
    });

    expect(mockReadFile).not.toHaveBeenCalled();
    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
  });
});

describe("deliver callback: missing credentials", () => {
  it("throws when corpId is missing", async () => {
    const runtime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(runtime);
    mockResolveAccount.mockReturnValue({ ...defaultAccount, corpId: undefined });

    createReplyDispatcher(makeParams());

    await expect(capturedDeliver?.({ text: "test", attachments: [] })).rejects.toThrow(
      "missing corpId/appSecret for send",
    );
  });
});

describe("onError callback", () => {
  it("logs error via runtime.error", () => {
    const runtime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(runtime);

    const params = makeParams();
    createReplyDispatcher(params);
    expect(capturedOnError).toBeDefined();

    capturedOnError?.(new Error("reply failed"), { kind: "final" });

    expect(params.runtime.error).toHaveBeenCalledWith(expect.stringContaining("final reply failed"));
  });

  it("handles unknown error kind", () => {
    const runtime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(runtime);

    const params = makeParams();
    createReplyDispatcher(params);

    capturedOnError?.(new Error("oops"), undefined);

    expect(params.runtime.error).toHaveBeenCalledWith(expect.stringContaining("unknown reply failed"));
  });
});

// ══════════════════════════════════════════════
// deliver callback: [[wechat_link:...]] directive interception
// ══════════════════════════════════════════════

describe("deliver callback: wechat_link directive", () => {
  it("sends link card when directive with thumbUrl is present", async () => {
    const runtime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(runtime);
    mockDownloadMediaFromUrl.mockResolvedValue({
      buffer: Buffer.from("thumb data"),
      filename: "thumb.jpg",
      ext: ".jpg",
    });

    createReplyDispatcher(makeParams());
    await capturedDeliver?.({
      text: "[[wechat_link: OpenClaw 文档 | AI助手开发平台 | https://docs.openclaw.ai | https://docs.openclaw.ai/img/logo.png]]",
      attachments: [],
    });

    expect(mockDownloadMediaFromUrl).toHaveBeenCalledWith("https://docs.openclaw.ai/img/logo.png");
    expect(mockUploadMedia).toHaveBeenCalledWith("corp1", "secret1", "image", expect.any(Buffer), "thumb.jpg");
    expect(mockSendLinkMessage).toHaveBeenCalledWith("corp1", "secret1", "ext_user_1", "kf_test", {
      title: "OpenClaw 文档",
      desc: "AI助手开发平台",
      url: "https://docs.openclaw.ai",
      thumb_media_id: "mid_disp",
    });
    // No remaining text → sendTextMessage not called
    expect(mockSendTextMessage).not.toHaveBeenCalled();
  });

  it("sends both link card and remaining text", async () => {
    const runtime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(runtime);
    mockDownloadMediaFromUrl.mockResolvedValue({
      buffer: Buffer.from("thumb data"),
      filename: "thumb.jpg",
      ext: ".jpg",
    });

    createReplyDispatcher(makeParams());
    await capturedDeliver?.({
      text: "推荐这篇文章\n[[wechat_link: Title | Desc | https://example.com | https://example.com/thumb.jpg]]",
      attachments: [],
    });

    expect(mockSendLinkMessage).toHaveBeenCalledTimes(1);
    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
    expect(mockSendTextMessage.mock.calls[0][4]).toContain("推荐这篇文章");
  });

  it("falls back to plain text when no thumbUrl is provided", async () => {
    const runtime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(runtime);

    createReplyDispatcher(makeParams());
    await capturedDeliver?.({
      text: "看看这个\n[[wechat_link: Article | https://example.com/article]]",
      attachments: [],
    });

    expect(mockDownloadMediaFromUrl).not.toHaveBeenCalled();
    expect(mockSendLinkMessage).not.toHaveBeenCalled();
    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
    const sentText = mockSendTextMessage.mock.calls[0][4];
    expect(sentText).toContain("Article");
    expect(sentText).toContain("https://example.com/article");
  });

  it("falls back to text with title+url when thumb download fails", async () => {
    const runtime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(runtime);
    mockDownloadMediaFromUrl.mockRejectedValue(new Error("404 not found"));

    const params = makeParams();
    createReplyDispatcher(params);
    await capturedDeliver?.({
      text: "[[wechat_link: Article | Desc | https://example.com | https://example.com/missing.jpg]]",
      attachments: [],
    });

    // Link card failed, but should not throw — falls back to text
    expect(params.runtime.error).toHaveBeenCalledWith(expect.stringContaining("failed to send link card"));
    expect(mockSendLinkMessage).not.toHaveBeenCalled();
    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
    const sentText = mockSendTextMessage.mock.calls[0][4];
    expect(sentText).toContain("Article");
    expect(sentText).toContain("https://example.com");
  });

  it("proceeds normally when no directive is present", async () => {
    const runtime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(runtime);

    createReplyDispatcher(makeParams());
    await capturedDeliver?.({ text: "Just a normal message", attachments: [] });

    expect(mockSendLinkMessage).not.toHaveBeenCalled();
    expect(mockDownloadMediaFromUrl).not.toHaveBeenCalled();
    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
  });
});
