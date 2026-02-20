import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock dependencies ──

const mockSendTextMessage = vi.fn();
const mockSendLinkMessage = vi.fn();
const mockSendLocationMessage = vi.fn();
const mockSendMiniprogramMessage = vi.fn();
const mockSendMsgMenuMessage = vi.fn();
const mockSendBusinessCardMessage = vi.fn();
const mockSendCaLinkMessage = vi.fn();
const mockUploadMedia = vi.fn();
vi.mock("./api.js", () => ({
  sendTextMessage: (...args: any[]) => mockSendTextMessage(...args),
  sendLinkMessage: (...args: any[]) => mockSendLinkMessage(...args),
  sendLocationMessage: (...args: any[]) => mockSendLocationMessage(...args),
  sendMiniprogramMessage: (...args: any[]) => mockSendMiniprogramMessage(...args),
  sendMsgMenuMessage: (...args: any[]) => mockSendMsgMenuMessage(...args),
  sendBusinessCardMessage: (...args: any[]) => mockSendBusinessCardMessage(...args),
  sendCaLinkMessage: (...args: any[]) => mockSendCaLinkMessage(...args),
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

const mockLoadWebMedia = vi.fn();
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
    media: {
      loadWebMedia: (...args: any[]) => mockLoadWebMedia(...args),
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
  mockSendLocationMessage.mockResolvedValue({ errcode: 0, errmsg: "ok", msgid: "loc_disp" });
  mockSendMiniprogramMessage.mockResolvedValue({ errcode: 0, errmsg: "ok", msgid: "mp_disp" });
  mockSendMsgMenuMessage.mockResolvedValue({ errcode: 0, errmsg: "ok", msgid: "menu_disp" });
  mockSendBusinessCardMessage.mockResolvedValue({ errcode: 0, errmsg: "ok", msgid: "card_disp" });
  mockSendCaLinkMessage.mockResolvedValue({ errcode: 0, errmsg: "ok", msgid: "ca_disp" });
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

    await capturedDeliver?.({ text: "hello world" });

    expect(mockSendTextMessage).toHaveBeenCalledWith("corp1", "secret1", "ext_user_1", "kf_test", expect.any(String));
  });

  it("applies formatText (markdown to unicode) before sending", async () => {
    const runtime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(runtime);

    createReplyDispatcher(makeParams());
    await capturedDeliver?.({ text: "**bold text**" });

    const sentText = mockSendTextMessage.mock.calls[0][4];
    expect(sentText).not.toContain("**");
  });

  it("chunks text using runtime chunkTextWithMode", async () => {
    const runtime = makeMockRuntime();
    runtime.channel.text.chunkTextWithMode.mockReturnValue(["chunk1", "chunk2"]);
    mockGetRuntime.mockReturnValue(runtime);

    createReplyDispatcher(makeParams());
    await capturedDeliver?.({ text: "long text here" });

    expect(runtime.channel.text.chunkTextWithMode).toHaveBeenCalled();
    expect(mockSendTextMessage).toHaveBeenCalledTimes(2);
    expect(mockSendTextMessage).toHaveBeenNthCalledWith(1, "corp1", "secret1", "ext_user_1", "kf_test", "chunk1");
    expect(mockSendTextMessage).toHaveBeenNthCalledWith(2, "corp1", "secret1", "ext_user_1", "kf_test", "chunk2");
  });

  it("does not send text when payload text is empty/whitespace", async () => {
    const runtime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(runtime);

    createReplyDispatcher(makeParams());
    await capturedDeliver?.({ text: "   " });

    expect(mockSendTextMessage).not.toHaveBeenCalled();
  });

  it("does nothing when both text and attachments are empty", async () => {
    const runtime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(runtime);

    createReplyDispatcher(makeParams());
    await capturedDeliver?.({ text: "" });

    expect(mockSendTextMessage).not.toHaveBeenCalled();
  });
});

describe("deliver callback: media attachments", () => {
  it("loads and sends image via loadWebMedia from mediaUrls", async () => {
    const runtime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(runtime);
    mockLoadWebMedia.mockResolvedValue({
      buffer: Buffer.from("img data"),
      kind: "image",
      fileName: "photo.jpg",
    });

    createReplyDispatcher(makeParams());

    const { sendImageMessage } = await import("./api.js");

    await capturedDeliver?.({
      text: "",
      mediaUrls: ["/tmp/photo.jpg"],
    });

    expect(mockLoadWebMedia).toHaveBeenCalledWith("/tmp/photo.jpg", { optimizeImages: false });
    expect(mockUploadMedia).toHaveBeenCalledWith("corp1", "secret1", "image", expect.any(Buffer), "photo.jpg");
    expect(sendImageMessage).toHaveBeenCalled();
  });

  it("logs error and continues when loadWebMedia fails", async () => {
    const runtime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(runtime);
    mockLoadWebMedia.mockRejectedValue(new Error("ENOENT"));

    const params = makeParams();
    createReplyDispatcher(params);

    await capturedDeliver?.({
      text: "text after failed media",
      mediaUrls: ["/tmp/missing.jpg"],
    });

    // Error should be logged
    expect(params.runtime.error).toHaveBeenCalledWith(expect.stringContaining("failed to send"));

    // Text should still be sent despite media failure
    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
  });
});

describe("deliver callback: missing credentials", () => {
  it("throws when corpId is missing", async () => {
    const runtime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(runtime);
    mockResolveAccount.mockReturnValue({ ...defaultAccount, corpId: undefined });

    createReplyDispatcher(makeParams());

    await expect(capturedDeliver?.({ text: "test" })).rejects.toThrow("missing corpId/appSecret for send");
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

// ══════════════════════════════════════════════
// deliver callback: new directive types
// ══════════════════════════════════════════════

describe("deliver callback: location directive", () => {
  it("sends location message from directive", async () => {
    const runtime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(runtime);

    createReplyDispatcher(makeParams());
    await capturedDeliver?.({
      text: "[[wechat_location: 故宫 | 北京市东城区 | 39.9 | 116.3]]",
    });

    expect(mockSendLocationMessage).toHaveBeenCalledWith("corp1", "secret1", "ext_user_1", "kf_test", {
      name: "故宫",
      address: "北京市东城区",
      latitude: 39.9,
      longitude: 116.3,
    });
    expect(mockSendTextMessage).not.toHaveBeenCalled();
  });

  it("sends location and remaining text", async () => {
    const runtime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(runtime);

    createReplyDispatcher(makeParams());
    await capturedDeliver?.({
      text: "我在这里\n[[wechat_location: 故宫 | 39.9 | 116.3]]",
    });

    expect(mockSendLocationMessage).toHaveBeenCalledTimes(1);
    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
    expect(mockSendTextMessage.mock.calls[0][4]).toContain("我在这里");
  });

  it("logs error and continues when location send fails", async () => {
    const runtime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(runtime);
    mockSendLocationMessage.mockRejectedValue(new Error("API error"));

    const params = makeParams();
    createReplyDispatcher(params);
    await capturedDeliver?.({
      text: "[[wechat_location: Place | 39.9 | 116.3]]",
    });

    expect(params.runtime.error).toHaveBeenCalledWith(expect.stringContaining("failed to send location"));
  });
});

describe("deliver callback: miniprogram directive", () => {
  it("sends miniprogram with thumbUrl", async () => {
    const runtime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(runtime);
    mockDownloadMediaFromUrl.mockResolvedValue({
      buffer: Buffer.from("thumb"),
      filename: "thumb.jpg",
      ext: ".jpg",
    });

    createReplyDispatcher(makeParams());
    await capturedDeliver?.({
      text: "[[wechat_miniprogram: wx123 | My App | pages/index | https://example.com/thumb.jpg]]",
    });

    expect(mockDownloadMediaFromUrl).toHaveBeenCalledWith("https://example.com/thumb.jpg");
    expect(mockSendMiniprogramMessage).toHaveBeenCalledWith("corp1", "secret1", "ext_user_1", "kf_test", {
      appid: "wx123",
      title: "My App",
      pagepath: "pages/index",
      thumb_media_id: "mid_disp",
    });
    expect(mockSendTextMessage).not.toHaveBeenCalled();
  });

  it("falls back to text when miniprogram has no thumbUrl", async () => {
    const runtime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(runtime);

    createReplyDispatcher(makeParams());
    await capturedDeliver?.({
      text: "[[wechat_miniprogram: wx123 | My App | pages/index]]",
    });

    expect(mockSendMiniprogramMessage).not.toHaveBeenCalled();
    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
    expect(mockSendTextMessage.mock.calls[0][4]).toContain("My App");
  });
});

describe("deliver callback: menu directive", () => {
  it("sends menu message from directive", async () => {
    const runtime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(runtime);

    createReplyDispatcher(makeParams());
    await capturedDeliver?.({
      text: "[[wechat_menu: 请选择 | A, B, C | 谢谢]]",
    });

    expect(mockSendMsgMenuMessage).toHaveBeenCalledWith("corp1", "secret1", "ext_user_1", "kf_test", {
      head_content: "请选择",
      list: [
        { type: "click", click: { id: "1", content: "A" } },
        { type: "click", click: { id: "2", content: "B" } },
        { type: "click", click: { id: "3", content: "C" } },
      ],
      tail_content: "谢谢",
    });
    expect(mockSendTextMessage).not.toHaveBeenCalled();
  });

  it("logs error and continues when menu send fails", async () => {
    const runtime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(runtime);
    mockSendMsgMenuMessage.mockRejectedValue(new Error("API error"));

    const params = makeParams();
    createReplyDispatcher(params);
    await capturedDeliver?.({
      text: "[[wechat_menu: Q | A, B]]",
    });

    expect(params.runtime.error).toHaveBeenCalledWith(expect.stringContaining("failed to send menu"));
  });
});

describe("deliver callback: business_card directive", () => {
  it("sends business card from directive", async () => {
    const runtime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(runtime);

    createReplyDispatcher(makeParams());
    await capturedDeliver?.({
      text: "[[wechat_business_card: servicer_001]]",
    });

    expect(mockSendBusinessCardMessage).toHaveBeenCalledWith("corp1", "secret1", "ext_user_1", "kf_test", {
      userid: "servicer_001",
    });
    expect(mockSendTextMessage).not.toHaveBeenCalled();
  });

  it("sends remaining text alongside business card", async () => {
    const runtime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(runtime);

    createReplyDispatcher(makeParams());
    await capturedDeliver?.({
      text: "联系他\n[[wechat_business_card: servicer_001]]",
    });

    expect(mockSendBusinessCardMessage).toHaveBeenCalledTimes(1);
    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
    expect(mockSendTextMessage.mock.calls[0][4]).toContain("联系他");
  });
});

describe("deliver callback: ca_link directive", () => {
  it("sends ca_link from directive", async () => {
    const runtime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(runtime);

    createReplyDispatcher(makeParams());
    await capturedDeliver?.({
      text: "[[wechat_ca_link: https://work.weixin.qq.com/ca/abc123]]",
    });

    expect(mockSendCaLinkMessage).toHaveBeenCalledWith("corp1", "secret1", "ext_user_1", "kf_test", {
      link_url: "https://work.weixin.qq.com/ca/abc123",
    });
    expect(mockSendTextMessage).not.toHaveBeenCalled();
  });

  it("logs error and continues when ca_link send fails", async () => {
    const runtime = makeMockRuntime();
    mockGetRuntime.mockReturnValue(runtime);
    mockSendCaLinkMessage.mockRejectedValue(new Error("API error"));

    const params = makeParams();
    createReplyDispatcher(params);
    await capturedDeliver?.({
      text: "[[wechat_ca_link: https://work.weixin.qq.com/ca/abc]]",
    });

    expect(params.runtime.error).toHaveBeenCalledWith(expect.stringContaining("failed to send ca_link"));
  });
});
