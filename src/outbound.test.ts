import { beforeEach, describe, expect, it, vi } from "vitest";
import { WECHAT_TEXT_CHUNK_LIMIT } from "./constants.js";

// ── Mock dependencies before importing outbound ──

const mockResolveAccount = vi.fn();
vi.mock("./accounts.js", () => ({
  resolveAccount: (...args: any[]) => mockResolveAccount(...args),
}));

const mockSendTextMessage = vi.fn();
const mockSendLinkMessage = vi.fn();
const mockSendLocationMessage = vi.fn();
const mockSendMiniprogramMessage = vi.fn();
const mockSendMsgMenuMessage = vi.fn();
const mockSendBusinessCardMessage = vi.fn();
const mockSendCaLinkMessage = vi.fn();
const mockSendRawMessage = vi.fn();
const mockUploadMedia = vi.fn();
vi.mock("./api.js", () => ({
  sendTextMessage: (...args: any[]) => mockSendTextMessage(...args),
  sendLinkMessage: (...args: any[]) => mockSendLinkMessage(...args),
  sendLocationMessage: (...args: any[]) => mockSendLocationMessage(...args),
  sendMiniprogramMessage: (...args: any[]) => mockSendMiniprogramMessage(...args),
  sendMsgMenuMessage: (...args: any[]) => mockSendMsgMenuMessage(...args),
  sendBusinessCardMessage: (...args: any[]) => mockSendBusinessCardMessage(...args),
  sendCaLinkMessage: (...args: any[]) => mockSendCaLinkMessage(...args),
  sendRawMessage: (...args: any[]) => mockSendRawMessage(...args),
  uploadMedia: (...args: any[]) => mockUploadMedia(...args),
  sendImageMessage: vi.fn().mockResolvedValue({ errcode: 0, errmsg: "ok", msgid: "img_msg_1" }),
  sendVoiceMessage: vi.fn().mockResolvedValue({ errcode: 0, errmsg: "ok", msgid: "voice_msg_1" }),
  sendVideoMessage: vi.fn().mockResolvedValue({ errcode: 0, errmsg: "ok", msgid: "video_msg_1" }),
  sendFileMessage: vi.fn().mockResolvedValue({ errcode: 0, errmsg: "ok", msgid: "file_msg_1" }),
}));

const mockResolveThumbMediaId = vi.fn();
vi.mock("./send-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./send-utils.js")>();
  return {
    ...actual,
    resolveThumbMediaId: (...args: any[]) => mockResolveThumbMediaId(...args),
  };
});

const mockChunkTextWithMode = vi.fn();
const mockResolveTextChunkLimit = vi.fn().mockReturnValue(2000);
const mockResolveChunkMode = vi.fn().mockReturnValue("length");
const mockLoadWebMedia = vi.fn();
vi.mock("./runtime.js", () => ({
  getRuntime: () => ({
    channel: {
      text: {
        resolveTextChunkLimit: (...args: any[]) => mockResolveTextChunkLimit(...args),
        resolveChunkMode: (...args: any[]) => mockResolveChunkMode(...args),
        chunkTextWithMode: (...args: any[]) => mockChunkTextWithMode(...args),
      },
    },
    media: {
      loadWebMedia: (...args: any[]) => mockLoadWebMedia(...args),
    },
  }),
}));

const mockLogWarn = vi.fn();
vi.mock("./monitor.js", () => ({
  getSharedContext: () => ({
    botCtx: { log: { warn: (...args: any[]) => mockLogWarn(...args) } },
  }),
}));

// Import after mocks
import { wechatKfOutbound } from "./outbound.js";

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

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveAccount.mockReturnValue(defaultAccount);
  mockSendTextMessage.mockResolvedValue({ errcode: 0, errmsg: "ok", msgid: "msg_001" });
  mockSendLinkMessage.mockResolvedValue({ errcode: 0, errmsg: "ok", msgid: "link_msg_1" });
  mockSendLocationMessage.mockResolvedValue({ errcode: 0, errmsg: "ok", msgid: "loc_msg_1" });
  mockSendMiniprogramMessage.mockResolvedValue({ errcode: 0, errmsg: "ok", msgid: "mp_msg_1" });
  mockSendMsgMenuMessage.mockResolvedValue({ errcode: 0, errmsg: "ok", msgid: "menu_msg_1" });
  mockSendBusinessCardMessage.mockResolvedValue({ errcode: 0, errmsg: "ok", msgid: "card_msg_1" });
  mockSendCaLinkMessage.mockResolvedValue({ errcode: 0, errmsg: "ok", msgid: "ca_msg_1" });
  mockSendRawMessage.mockResolvedValue({ errcode: 0, errmsg: "ok", msgid: "raw_msg_1" });
  mockUploadMedia.mockResolvedValue({
    errcode: 0,
    errmsg: "ok",
    type: "image",
    media_id: "mid_123",
    created_at: 123,
  });
  // Default: simple length-based splitting (mirrors chunkText for test purposes)
  mockChunkTextWithMode.mockImplementation((text: string, limit: number) => {
    if (limit <= 0) return [];
    const t = text.trim();
    if (t.length === 0) return [];
    if (t.length <= limit) return [t];
    const chunks: string[] = [];
    for (let i = 0; i < t.length; i += limit) {
      const c = t.slice(i, i + limit).trim();
      if (c) chunks.push(c);
    }
    return chunks;
  });
  mockResolveTextChunkLimit.mockReturnValue(2000);
  mockResolveChunkMode.mockReturnValue("length");
});

// ══════════════════════════════════════════════
// Structural / declarative tests
// ══════════════════════════════════════════════

describe("wechatKfOutbound declarations", () => {
  it("disables framework chunking (chunker is null)", () => {
    expect(wechatKfOutbound.chunker).toBeNull();
    expect(wechatKfOutbound.textChunkLimit).toBe(WECHAT_TEXT_CHUNK_LIMIT);
  });

  it("textChunkLimit equals WECHAT_TEXT_CHUNK_LIMIT constant (2000)", () => {
    expect(wechatKfOutbound.textChunkLimit).toBe(2000);
  });

  it("deliveryMode is direct", () => {
    expect(wechatKfOutbound.deliveryMode).toBe("direct");
  });
});

// ══════════════════════════════════════════════
// sendText
// ══════════════════════════════════════════════

describe("wechatKfOutbound.sendText", () => {
  it("sends a text message to the correct user and returns messageId", async () => {
    const result = await wechatKfOutbound.sendText({
      cfg: { channels: { "wechat-kf": {} } },
      to: "ext_user_123",
      text: "hello world",
      accountId: "kf_test",
    });

    expect(mockSendTextMessage).toHaveBeenCalledWith("corp1", "secret1", "ext_user_123", "kf_test", "hello world");
    expect(result).toEqual({
      channel: "wechat-kf",
      messageId: "msg_001",
      chatId: "ext_user_123",
    });
  });

  it("strips 'user:' prefix from the to field", async () => {
    await wechatKfOutbound.sendText({
      cfg: {},
      to: "user:ext_user_456",
      text: "test",
      accountId: "kf_test",
    });

    expect(mockSendTextMessage).toHaveBeenCalledWith("corp1", "secret1", "ext_user_456", "kf_test", expect.any(String));
  });

  it("applies formatText (markdown to unicode) before sending", async () => {
    await wechatKfOutbound.sendText({
      cfg: {},
      to: "ext_user",
      text: "**bold text**",
      accountId: "kf_test",
    });

    const sentText = mockSendTextMessage.mock.calls[0][4];
    // formatText converts **bold** to Unicode bold; should not contain raw **
    expect(sentText).not.toContain("**");
  });

  it("throws when corpId is missing", async () => {
    mockResolveAccount.mockReturnValue({ ...defaultAccount, corpId: undefined });

    await expect(wechatKfOutbound.sendText({ cfg: {}, to: "u", text: "t", accountId: "kf" })).rejects.toThrow(
      "missing corpId/appSecret/openKfId",
    );
  });

  it("throws when appSecret is missing", async () => {
    mockResolveAccount.mockReturnValue({ ...defaultAccount, appSecret: undefined });

    await expect(wechatKfOutbound.sendText({ cfg: {}, to: "u", text: "t", accountId: "kf" })).rejects.toThrow(
      "missing corpId/appSecret/openKfId",
    );
  });

  it("falls back to accountId when openKfId is not set", async () => {
    mockResolveAccount.mockReturnValue({ ...defaultAccount, openKfId: undefined });

    await wechatKfOutbound.sendText({
      cfg: {},
      to: "ext_user",
      text: "hello",
      accountId: "kf_fallback",
    });

    // Should use accountId as openKfId
    expect(mockSendTextMessage).toHaveBeenCalledWith("corp1", "secret1", "ext_user", "kf_fallback", expect.any(String));
  });
});

// ══════════════════════════════════════════════
// sendText — internal format-then-chunk
// ══════════════════════════════════════════════

describe("wechatKfOutbound.sendText format-then-chunk", () => {
  it("chunks long formatted text into multiple sendTextMessage calls", async () => {
    // Build a string that, after formatText, exceeds WECHAT_TEXT_CHUNK_LIMIT (2000).
    // Use **bold** which formatText converts to Unicode math-bold (2 code units each).
    const segment = "**abcdefghij** "; // 15 chars raw → ~25 chars formatted
    const longText = segment.repeat(200); // well over 2000 formatted chars

    await wechatKfOutbound.sendText({
      cfg: {},
      to: "ext_user_1",
      text: longText,
      accountId: "kf_test",
    });

    // Should have called sendTextMessage more than once
    expect(mockSendTextMessage.mock.calls.length).toBeGreaterThan(1);

    // Every chunk should already be formatted (no raw ** remaining)
    for (const call of mockSendTextMessage.mock.calls) {
      const sentText = call[4] as string;
      expect(sentText).not.toContain("**");
      expect(sentText.length).toBeLessThanOrEqual(WECHAT_TEXT_CHUNK_LIMIT);
    }
  });

  it("sends short text in a single call without unnecessary chunking", async () => {
    await wechatKfOutbound.sendText({
      cfg: {},
      to: "ext_user_1",
      text: "short message",
      accountId: "kf_test",
    });

    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
  });

  it("returns messageId from the last chunk", async () => {
    let callCount = 0;
    mockSendTextMessage.mockImplementation(() => {
      callCount++;
      return Promise.resolve({ errcode: 0, errmsg: "ok", msgid: `msg_${callCount}` });
    });

    const segment = "**abcdefghij** ";
    const longText = segment.repeat(200);

    const result = await wechatKfOutbound.sendText({
      cfg: {},
      to: "ext_user_1",
      text: longText,
      accountId: "kf_test",
    });

    // messageId should be from the last call
    expect(result.messageId).toBe(`msg_${callCount}`);
  });

  it("uses runtime chunkTextWithMode for chunking", async () => {
    await wechatKfOutbound.sendText({
      cfg: { channels: { "wechat-kf": {} } },
      to: "ext_user_1",
      text: "hello",
      accountId: "kf_test",
    });

    expect(mockChunkTextWithMode).toHaveBeenCalledWith(expect.any(String), 2000, "length");
  });

  it("respects runtime-resolved chunk limit and mode", async () => {
    mockResolveTextChunkLimit.mockReturnValue(500);
    mockResolveChunkMode.mockReturnValue("newline");
    mockChunkTextWithMode.mockImplementation((text: string) => [text]);

    await wechatKfOutbound.sendText({
      cfg: {},
      to: "ext_user_1",
      text: "hello",
      accountId: "kf_test",
    });

    expect(mockResolveTextChunkLimit).toHaveBeenCalledWith(expect.anything(), "wechat-kf", "kf_test", {
      fallbackLimit: WECHAT_TEXT_CHUNK_LIMIT,
    });
    expect(mockResolveChunkMode).toHaveBeenCalledWith(expect.anything(), "wechat-kf");
    expect(mockChunkTextWithMode).toHaveBeenCalledWith(expect.any(String), 500, "newline");
  });
});

// ══════════════════════════════════════════════
// sendMedia
// ══════════════════════════════════════════════

describe("wechatKfOutbound.sendMedia", () => {
  it("loads media via loadWebMedia, uploads, and sends for local path", async () => {
    mockLoadWebMedia.mockResolvedValue({
      buffer: Buffer.from("fake image data"),
      kind: "image",
      fileName: "photo.jpg",
    });

    const { sendImageMessage } = await import("./api.js");

    const result = await wechatKfOutbound.sendMedia({
      cfg: {},
      to: "ext_user_1",
      text: "",
      mediaUrl: "/tmp/photo.jpg",
      accountId: "kf_test",
    });

    expect(mockLoadWebMedia).toHaveBeenCalledWith("/tmp/photo.jpg", { optimizeImages: false });
    expect(mockUploadMedia).toHaveBeenCalledWith("corp1", "secret1", "image", expect.any(Buffer), "photo.jpg");
    expect(sendImageMessage).toHaveBeenCalledWith("corp1", "secret1", "ext_user_1", "kf_test", "mid_123");
    expect(result.messageId).toBe("img_msg_1");
  });

  it("sends accompanying text with formatText after media", async () => {
    mockLoadWebMedia.mockResolvedValue({
      buffer: Buffer.from("fake"),
      kind: "image",
      fileName: "photo.jpg",
    });

    await wechatKfOutbound.sendMedia({
      cfg: {},
      to: "ext_user_1",
      text: "**caption here**",
      mediaUrl: "/tmp/photo.jpg",
      accountId: "kf_test",
    });

    // sendTextMessage should be called for accompanying text
    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
    const sentText = mockSendTextMessage.mock.calls[0][4];
    // formatText converts **bold** to Unicode bold
    expect(sentText).not.toContain("**");
  });

  it("does not send text when accompanying text is empty/whitespace", async () => {
    mockLoadWebMedia.mockResolvedValue({
      buffer: Buffer.from("fake"),
      kind: "image",
      fileName: "photo.jpg",
    });

    await wechatKfOutbound.sendMedia({
      cfg: {},
      to: "ext_user_1",
      text: "   ",
      mediaUrl: "/tmp/photo.jpg",
      accountId: "kf_test",
    });

    // Should NOT send text message
    expect(mockSendTextMessage).not.toHaveBeenCalled();
  });

  it("loads media via loadWebMedia for HTTP URL", async () => {
    mockLoadWebMedia.mockResolvedValue({
      buffer: Buffer.from("downloaded image data"),
      kind: "image",
      fileName: "photo.jpg",
    });

    const { sendImageMessage } = await import("./api.js");

    const result = await wechatKfOutbound.sendMedia({
      cfg: {},
      to: "ext_user_1",
      text: "",
      mediaUrl: "https://example.com/photo.jpg",
      accountId: "kf_test",
    });

    expect(mockLoadWebMedia).toHaveBeenCalledWith("https://example.com/photo.jpg", { optimizeImages: false });
    expect(mockUploadMedia).toHaveBeenCalledWith("corp1", "secret1", "image", expect.any(Buffer), "photo.jpg");
    expect(sendImageMessage).toHaveBeenCalledWith("corp1", "secret1", "ext_user_1", "kf_test", "mid_123");
    expect(result.messageId).toBe("img_msg_1");
  });

  it("sends accompanying text alongside HTTP URL media", async () => {
    mockLoadWebMedia.mockResolvedValue({
      buffer: Buffer.from("downloaded image data"),
      kind: "image",
      fileName: "photo.jpg",
    });

    const { sendImageMessage } = await import("./api.js");

    const result = await wechatKfOutbound.sendMedia({
      cfg: {},
      to: "ext_user_1",
      text: "Check this out",
      mediaUrl: "https://example.com/photo.jpg",
      accountId: "kf_test",
    });

    expect(mockLoadWebMedia).toHaveBeenCalledWith("https://example.com/photo.jpg", { optimizeImages: false });
    expect(mockUploadMedia).toHaveBeenCalled();
    expect(sendImageMessage).toHaveBeenCalled();
    // Also sends accompanying text
    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
    expect(result.messageId).toBe("img_msg_1");
  });

  it("maps audio MediaKind to voice WeChat type", async () => {
    mockLoadWebMedia.mockResolvedValue({
      buffer: Buffer.from("audio data"),
      kind: "audio",
      fileName: "recording.mp3",
    });

    const { sendVoiceMessage } = await import("./api.js");

    await wechatKfOutbound.sendMedia({
      cfg: {},
      to: "ext_user_1",
      text: "",
      mediaUrl: "https://cdn.example.com/audio/recording.mp3",
      accountId: "kf_test",
    });

    expect(mockUploadMedia).toHaveBeenCalledWith("corp1", "secret1", "voice", expect.any(Buffer), "recording.mp3");
    expect(sendVoiceMessage).toHaveBeenCalled();
  });

  it("falls back to text when no mediaUrl", async () => {
    await wechatKfOutbound.sendMedia({
      cfg: {},
      to: "ext_user_1",
      text: "just text",
      accountId: "kf_test",
    });

    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
  });

  it("maps video MediaKind to video WeChat type", async () => {
    mockLoadWebMedia.mockResolvedValue({
      buffer: Buffer.from("video data"),
      kind: "video",
      fileName: "clip.mp4",
    });
    const { sendVideoMessage } = await import("./api.js");

    await wechatKfOutbound.sendMedia({
      cfg: {},
      to: "ext_user_1",
      text: "",
      mediaUrl: "/tmp/clip.mp4",
      accountId: "kf_test",
    });

    expect(mockUploadMedia).toHaveBeenCalledWith("corp1", "secret1", "video", expect.any(Buffer), "clip.mp4");
    expect(sendVideoMessage).toHaveBeenCalled();
  });

  it("maps document MediaKind to file WeChat type", async () => {
    mockLoadWebMedia.mockResolvedValue({
      buffer: Buffer.from("pdf data"),
      kind: "document",
      fileName: "doc.pdf",
    });
    const { sendFileMessage } = await import("./api.js");

    await wechatKfOutbound.sendMedia({
      cfg: {},
      to: "ext_user_1",
      text: "",
      mediaUrl: "/tmp/doc.pdf",
      accountId: "kf_test",
    });

    expect(mockUploadMedia).toHaveBeenCalledWith("corp1", "secret1", "file", expect.any(Buffer), "doc.pdf");
    expect(sendFileMessage).toHaveBeenCalled();
  });

  it("uses 'file' as fallback filename when loadWebMedia returns no fileName", async () => {
    mockLoadWebMedia.mockResolvedValue({
      buffer: Buffer.from("data"),
      kind: "unknown",
    });

    await wechatKfOutbound.sendMedia({
      cfg: {},
      to: "ext_user_1",
      text: "",
      mediaUrl: "MEDIA:some-ref",
      accountId: "kf_test",
    });

    expect(mockUploadMedia).toHaveBeenCalledWith("corp1", "secret1", "file", expect.any(Buffer), "file");
  });

  it("throws when corpId is missing", async () => {
    mockResolveAccount.mockReturnValue({ ...defaultAccount, corpId: undefined });

    await expect(
      wechatKfOutbound.sendMedia({
        cfg: {},
        to: "u",
        text: "",
        mediaUrl: "/tmp/x.jpg",
        accountId: "kf",
      }),
    ).rejects.toThrow("missing corpId/appSecret/openKfId");
  });
});

// ══════════════════════════════════════════════
// 48h / 5-message session limit (errcode 95026)
// ══════════════════════════════════════════════

describe("wechatKfOutbound 48h/5-msg session limit", () => {
  it("sendText logs and re-throws on 95026 error", async () => {
    mockLogWarn.mockClear();
    mockSendTextMessage.mockRejectedValue(new Error("WeChat API error 95026: session limit"));

    await expect(
      wechatKfOutbound.sendText({
        cfg: {},
        to: "ext_user_1",
        text: "hello",
        accountId: "kf_test",
      }),
    ).rejects.toThrow("95026");

    expect(mockLogWarn).toHaveBeenCalledWith(expect.stringContaining("session limit exceeded (48h/5-msg)"));
  });

  it("sendText does not log session limit warning for other errors", async () => {
    mockLogWarn.mockClear();
    mockSendTextMessage.mockRejectedValue(new Error("network error"));

    await expect(
      wechatKfOutbound.sendText({
        cfg: {},
        to: "ext_user_1",
        text: "hello",
        accountId: "kf_test",
      }),
    ).rejects.toThrow("network error");

    expect(mockLogWarn).not.toHaveBeenCalled();
  });

  it("sendMedia logs and re-throws on 95026 error", async () => {
    mockLogWarn.mockClear();
    mockLoadWebMedia.mockResolvedValue({
      buffer: Buffer.from("data"),
      kind: "image",
      fileName: "photo.jpg",
    });

    mockUploadMedia.mockRejectedValueOnce(new Error("WeChat API error 95026: session limit"));

    await expect(
      wechatKfOutbound.sendMedia({
        cfg: {},
        to: "ext_user_1",
        text: "",
        mediaUrl: "https://example.com/photo.jpg",
        accountId: "kf_test",
      }),
    ).rejects.toThrow("95026");

    expect(mockLogWarn).toHaveBeenCalledWith(expect.stringContaining("session limit exceeded (48h/5-msg)"));
  });
});

// ══════════════════════════════════════════════
// sendPayload
// ══════════════════════════════════════════════

describe("wechatKfOutbound.sendPayload", () => {
  it("sends link card with thumb_media_id", async () => {
    const result = await wechatKfOutbound.sendPayload({
      cfg: {},
      to: "ext_user_1",
      accountId: "kf_test",
      payload: {
        channelData: {
          wechatKf: {
            link: {
              title: "Hello",
              desc: "World",
              url: "https://example.com",
              thumb_media_id: "thumb_mid_1",
            },
          },
        },
      },
    });

    expect(mockSendLinkMessage).toHaveBeenCalledWith("corp1", "secret1", "ext_user_1", "kf_test", {
      title: "Hello",
      desc: "World",
      url: "https://example.com",
      thumb_media_id: "thumb_mid_1",
    });
    expect(result).toEqual({
      channel: "wechat-kf",
      messageId: "link_msg_1",
      chatId: "ext_user_1",
    });
  });

  it("resolves thumbnail when thumbUrl provided", async () => {
    mockResolveThumbMediaId.mockResolvedValue("mid_123");

    const result = await wechatKfOutbound.sendPayload({
      cfg: {},
      to: "ext_user_1",
      accountId: "kf_test",
      payload: {
        channelData: {
          wechatKf: {
            link: {
              title: "Article",
              url: "https://example.com/article",
              thumbUrl: "https://example.com/thumb.jpg",
            },
          },
        },
      },
    });

    expect(mockResolveThumbMediaId).toHaveBeenCalledWith("https://example.com/thumb.jpg", "corp1", "secret1");
    expect(mockSendLinkMessage).toHaveBeenCalledWith("corp1", "secret1", "ext_user_1", "kf_test", {
      title: "Article",
      desc: undefined,
      url: "https://example.com/article",
      thumb_media_id: "mid_123",
    });
    expect(result.messageId).toBe("link_msg_1");
  });

  it("sends text alongside link card", async () => {
    await wechatKfOutbound.sendPayload({
      cfg: {},
      to: "ext_user_1",
      text: "Check this out",
      accountId: "kf_test",
      payload: {
        channelData: {
          wechatKf: {
            link: {
              title: "Article",
              url: "https://example.com",
              thumb_media_id: "thumb_mid_1",
            },
          },
        },
      },
    });

    expect(mockSendLinkMessage).toHaveBeenCalledTimes(1);
    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
    expect(mockSendTextMessage).toHaveBeenCalledWith("corp1", "secret1", "ext_user_1", "kf_test", expect.any(String));
  });

  it("falls back to sendText when no channelData.wechatKf.link", async () => {
    const result = await wechatKfOutbound.sendPayload({
      cfg: {},
      to: "ext_user_1",
      text: "plain text",
      accountId: "kf_test",
      payload: { text: "plain text" },
    });

    expect(mockSendLinkMessage).not.toHaveBeenCalled();
    expect(mockSendTextMessage).toHaveBeenCalledWith("corp1", "secret1", "ext_user_1", "kf_test", expect.any(String));
    expect(result).toEqual({
      channel: "wechat-kf",
      messageId: "msg_001",
      chatId: "ext_user_1",
    });
  });

  it("throws when link has neither thumb_media_id nor thumbUrl", async () => {
    await expect(
      wechatKfOutbound.sendPayload({
        cfg: {},
        to: "ext_user_1",
        accountId: "kf_test",
        payload: {
          channelData: {
            wechatKf: {
              link: {
                title: "No Thumb",
                url: "https://example.com",
              },
            },
          },
        },
      }),
    ).rejects.toThrow("thumb_media_id or thumbUrl");
  });

  it("strips user: prefix from to field", async () => {
    await wechatKfOutbound.sendPayload({
      cfg: {},
      to: "user:ext_user_789",
      accountId: "kf_test",
      payload: {
        channelData: {
          wechatKf: {
            link: {
              title: "Test",
              url: "https://example.com",
              thumb_media_id: "thumb_mid_1",
            },
          },
        },
      },
    });

    expect(mockSendLinkMessage).toHaveBeenCalledWith(
      "corp1",
      "secret1",
      "ext_user_789",
      "kf_test",
      expect.objectContaining({ title: "Test" }),
    );
  });

  it("throws when corpId is missing", async () => {
    mockResolveAccount.mockReturnValue({ ...defaultAccount, corpId: undefined });

    await expect(
      wechatKfOutbound.sendPayload({
        cfg: {},
        to: "u",
        accountId: "kf",
        payload: {
          channelData: {
            wechatKf: { link: { title: "t", url: "u", thumb_media_id: "m" } },
          },
        },
      }),
    ).rejects.toThrow("missing corpId/appSecret/openKfId");
  });
});

// ══════════════════════════════════════════════
// sendPayload 48h/5-msg session limit
// ══════════════════════════════════════════════

describe("wechatKfOutbound.sendPayload session limit", () => {
  it("logs and re-throws on 95026 error for link message", async () => {
    mockLogWarn.mockClear();
    mockSendLinkMessage.mockRejectedValue(new Error("WeChat API error 95026: session limit"));

    await expect(
      wechatKfOutbound.sendPayload({
        cfg: {},
        to: "ext_user_1",
        accountId: "kf_test",
        payload: {
          channelData: {
            wechatKf: {
              link: {
                title: "Test",
                url: "https://example.com",
                thumb_media_id: "thumb_mid_1",
              },
            },
          },
        },
      }),
    ).rejects.toThrow("95026");

    expect(mockLogWarn).toHaveBeenCalledWith(expect.stringContaining("session limit exceeded (48h/5-msg)"));
  });

  it("logs and re-throws on 95026 error for text fallback", async () => {
    mockLogWarn.mockClear();
    mockSendTextMessage.mockRejectedValue(new Error("WeChat API error 95026: session limit"));

    await expect(
      wechatKfOutbound.sendPayload({
        cfg: {},
        to: "ext_user_1",
        text: "hello",
        accountId: "kf_test",
        payload: { text: "hello" },
      }),
    ).rejects.toThrow("95026");

    expect(mockLogWarn).toHaveBeenCalledWith(expect.stringContaining("session limit exceeded (48h/5-msg)"));
  });
});

// ══════════════════════════════════════════════
// sendText [[wechat_link:...]] directive interception
// ══════════════════════════════════════════════

describe("wechatKfOutbound.sendText directive interception", () => {
  it("sends link card when directive with thumbUrl is present", async () => {
    mockResolveThumbMediaId.mockResolvedValue("mid_123");

    const result = await wechatKfOutbound.sendText({
      cfg: {},
      to: "ext_user_1",
      text: "[[wechat_link: Deep Learning | A tutorial | https://example.com/dl | https://example.com/thumb.jpg]]",
      accountId: "kf_test",
    });

    expect(mockResolveThumbMediaId).toHaveBeenCalledWith("https://example.com/thumb.jpg", "corp1", "secret1");
    expect(mockSendLinkMessage).toHaveBeenCalledWith("corp1", "secret1", "ext_user_1", "kf_test", {
      title: "Deep Learning",
      desc: "A tutorial",
      url: "https://example.com/dl",
      thumb_media_id: "mid_123",
    });
    expect(result).toEqual({
      channel: "wechat-kf",
      messageId: "link_msg_1",
      chatId: "ext_user_1",
    });
  });

  it("sends both link card and remaining text", async () => {
    mockResolveThumbMediaId.mockResolvedValue("mid_123");

    await wechatKfOutbound.sendText({
      cfg: {},
      to: "ext_user_1",
      text: "推荐这篇文章\n[[wechat_link: Title | Desc | https://example.com | https://example.com/thumb.jpg]]",
      accountId: "kf_test",
    });

    expect(mockSendLinkMessage).toHaveBeenCalledTimes(1);
    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
    // Remaining text is sent via sendTextMessage (after formatText, which is identity for plain Chinese)
    expect(mockSendTextMessage.mock.calls[0][4]).toContain("推荐这篇文章");
  });

  it("falls back to plain text when no thumbUrl is provided", async () => {
    const result = await wechatKfOutbound.sendText({
      cfg: {},
      to: "ext_user_1",
      text: "看看这个\n[[wechat_link: Article | https://example.com/article]]",
      accountId: "kf_test",
    });

    // No thumbUrl → no resolve → graceful degradation to text
    expect(mockResolveThumbMediaId).not.toHaveBeenCalled();
    expect(mockSendLinkMessage).not.toHaveBeenCalled();
    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
    // Fallback text should include title and URL
    const sentText = mockSendTextMessage.mock.calls[0][4];
    expect(sentText).toContain("Article");
    expect(sentText).toContain("https://example.com/article");
    expect(result.messageId).toBe("msg_001");
  });

  it("proceeds normally when no directive is present", async () => {
    await wechatKfOutbound.sendText({
      cfg: {},
      to: "ext_user_1",
      text: "Just a normal message",
      accountId: "kf_test",
    });

    expect(mockSendLinkMessage).not.toHaveBeenCalled();
    expect(mockResolveThumbMediaId).not.toHaveBeenCalled();
    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
    expect(mockSendTextMessage).toHaveBeenCalledWith(
      "corp1",
      "secret1",
      "ext_user_1",
      "kf_test",
      "Just a normal message",
    );
  });

  it("handles 3-field directive with thumbUrl absent", async () => {
    await wechatKfOutbound.sendText({
      cfg: {},
      to: "ext_user_1",
      text: "[[wechat_link: Title | Description | https://example.com]]",
      accountId: "kf_test",
    });

    // No thumbUrl → fallback to text
    expect(mockSendLinkMessage).not.toHaveBeenCalled();
    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
    const sentText = mockSendTextMessage.mock.calls[0][4];
    expect(sentText).toContain("Title");
    expect(sentText).toContain("https://example.com");
  });

  it("logs session limit error for directive link message", async () => {
    mockLogWarn.mockClear();
    mockResolveThumbMediaId.mockResolvedValue("mid_123");
    mockSendLinkMessage.mockRejectedValue(new Error("WeChat API error 95026: session limit"));

    await expect(
      wechatKfOutbound.sendText({
        cfg: {},
        to: "ext_user_1",
        text: "[[wechat_link: Title | Desc | https://example.com | https://example.com/thumb.jpg]]",
        accountId: "kf_test",
      }),
    ).rejects.toThrow("95026");

    expect(mockLogWarn).toHaveBeenCalledWith(expect.stringContaining("session limit exceeded (48h/5-msg)"));
  });
});

// ══════════════════════════════════════════════
// sendText — new directive types
// ══════════════════════════════════════════════

describe("wechatKfOutbound.sendText new directives", () => {
  it("sends location message from directive", async () => {
    const result = await wechatKfOutbound.sendText({
      cfg: {},
      to: "ext_user_1",
      text: "[[wechat_location: 故宫 | 北京市东城区 | 39.9 | 116.3]]",
      accountId: "kf_test",
    });

    expect(mockSendLocationMessage).toHaveBeenCalledWith("corp1", "secret1", "ext_user_1", "kf_test", {
      name: "故宫",
      address: "北京市东城区",
      latitude: 39.9,
      longitude: 116.3,
    });
    expect(result.messageId).toBe("loc_msg_1");
  });

  it("sends location with remaining text", async () => {
    await wechatKfOutbound.sendText({
      cfg: {},
      to: "ext_user_1",
      text: "我在这里\n[[wechat_location: 故宫 | 39.9 | 116.3]]",
      accountId: "kf_test",
    });

    expect(mockSendLocationMessage).toHaveBeenCalledTimes(1);
    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
    expect(mockSendTextMessage.mock.calls[0][4]).toContain("我在这里");
  });

  it("sends miniprogram with thumbUrl", async () => {
    mockResolveThumbMediaId.mockResolvedValue("mid_123");

    const result = await wechatKfOutbound.sendText({
      cfg: {},
      to: "ext_user_1",
      text: "[[wechat_miniprogram: wx123 | My App | pages/index | https://example.com/thumb.jpg]]",
      accountId: "kf_test",
    });

    expect(mockResolveThumbMediaId).toHaveBeenCalledWith("https://example.com/thumb.jpg", "corp1", "secret1");
    expect(mockSendMiniprogramMessage).toHaveBeenCalledWith("corp1", "secret1", "ext_user_1", "kf_test", {
      appid: "wx123",
      title: "My App",
      pagepath: "pages/index",
      thumb_media_id: "mid_123",
    });
    expect(result.messageId).toBe("mp_msg_1");
  });

  it("falls back to text when miniprogram has no thumbUrl", async () => {
    await wechatKfOutbound.sendText({
      cfg: {},
      to: "ext_user_1",
      text: "[[wechat_miniprogram: wx123 | My App | pages/index]]",
      accountId: "kf_test",
    });

    expect(mockSendMiniprogramMessage).not.toHaveBeenCalled();
    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
    expect(mockSendTextMessage.mock.calls[0][4]).toContain("My App");
  });

  it("sends menu message from directive", async () => {
    const result = await wechatKfOutbound.sendText({
      cfg: {},
      to: "ext_user_1",
      text: "[[wechat_menu: 请选择 | 选项A, 选项B | 谢谢]]",
      accountId: "kf_test",
    });

    expect(mockSendMsgMenuMessage).toHaveBeenCalledWith("corp1", "secret1", "ext_user_1", "kf_test", {
      head_content: "请选择",
      list: [
        { type: "click", click: { id: "1", content: "选项A" } },
        { type: "click", click: { id: "2", content: "选项B" } },
      ],
      tail_content: "谢谢",
    });
    expect(result.messageId).toBe("menu_msg_1");
  });

  it("sends mixed-type menu from directive", async () => {
    const result = await wechatKfOutbound.sendText({
      cfg: {},
      to: "ext_user_1",
      text: "[[wechat_menu: 请操作 | click(btn_ok, 确认), view(https://help.com, 帮助), text(或回复文字) | 感谢]]",
      accountId: "kf_test",
    });

    expect(mockSendMsgMenuMessage).toHaveBeenCalledWith("corp1", "secret1", "ext_user_1", "kf_test", {
      head_content: "请操作",
      list: [
        { type: "click", click: { id: "btn_ok", content: "确认" } },
        { type: "view", view: { url: "https://help.com", content: "帮助" } },
        { type: "text", text: { content: "或回复文字" } },
      ],
      tail_content: "感谢",
    });
    expect(result.messageId).toBe("menu_msg_1");
  });

  it("sends business card from directive", async () => {
    const result = await wechatKfOutbound.sendText({
      cfg: {},
      to: "ext_user_1",
      text: "[[wechat_business_card: servicer_001]]",
      accountId: "kf_test",
    });

    expect(mockSendBusinessCardMessage).toHaveBeenCalledWith("corp1", "secret1", "ext_user_1", "kf_test", {
      userid: "servicer_001",
    });
    expect(result.messageId).toBe("card_msg_1");
  });

  it("sends ca_link from directive", async () => {
    const result = await wechatKfOutbound.sendText({
      cfg: {},
      to: "ext_user_1",
      text: "[[wechat_ca_link: https://work.weixin.qq.com/ca/abc123]]",
      accountId: "kf_test",
    });

    expect(mockSendCaLinkMessage).toHaveBeenCalledWith("corp1", "secret1", "ext_user_1", "kf_test", {
      link_url: "https://work.weixin.qq.com/ca/abc123",
    });
    expect(result.messageId).toBe("ca_msg_1");
  });
});

// ══════════════════════════════════════════════
// sendPayload — new message types
// ══════════════════════════════════════════════

describe("wechatKfOutbound.sendPayload new types", () => {
  it("routes wechatKf.location to sendLocationMessage", async () => {
    const result = await wechatKfOutbound.sendPayload({
      cfg: {},
      to: "ext_user_1",
      accountId: "kf_test",
      payload: {
        channelData: {
          wechatKf: {
            location: { name: "故宫", latitude: 39.9, longitude: 116.3 },
          },
        },
      },
    });

    expect(mockSendLocationMessage).toHaveBeenCalledWith("corp1", "secret1", "ext_user_1", "kf_test", {
      name: "故宫",
      latitude: 39.9,
      longitude: 116.3,
    });
    expect(result.messageId).toBe("loc_msg_1");
  });

  it("routes wechatKf.miniprogram with thumb_media_id to sendMiniprogramMessage", async () => {
    const result = await wechatKfOutbound.sendPayload({
      cfg: {},
      to: "ext_user_1",
      accountId: "kf_test",
      payload: {
        channelData: {
          wechatKf: {
            miniprogram: {
              appid: "wx123",
              title: "My App",
              pagepath: "pages/index",
              thumb_media_id: "thumb_mid_1",
            },
          },
        },
      },
    });

    expect(mockSendMiniprogramMessage).toHaveBeenCalledWith("corp1", "secret1", "ext_user_1", "kf_test", {
      appid: "wx123",
      title: "My App",
      pagepath: "pages/index",
      thumb_media_id: "thumb_mid_1",
    });
    expect(result.messageId).toBe("mp_msg_1");
  });

  it("routes wechatKf.miniprogram with thumbUrl (resolveThumbMediaId)", async () => {
    mockResolveThumbMediaId.mockResolvedValue("mid_123");

    await wechatKfOutbound.sendPayload({
      cfg: {},
      to: "ext_user_1",
      accountId: "kf_test",
      payload: {
        channelData: {
          wechatKf: {
            miniprogram: {
              appid: "wx123",
              title: "My App",
              pagepath: "pages/index",
              thumbUrl: "https://example.com/thumb.jpg",
            },
          },
        },
      },
    });

    expect(mockResolveThumbMediaId).toHaveBeenCalledWith("https://example.com/thumb.jpg", "corp1", "secret1");
    expect(mockSendMiniprogramMessage).toHaveBeenCalled();
  });

  it("throws when miniprogram has no thumb", async () => {
    await expect(
      wechatKfOutbound.sendPayload({
        cfg: {},
        to: "ext_user_1",
        accountId: "kf_test",
        payload: {
          channelData: {
            wechatKf: {
              miniprogram: {
                appid: "wx123",
                title: "No Thumb",
                pagepath: "pages/index",
              },
            },
          },
        },
      }),
    ).rejects.toThrow("thumb_media_id or thumbUrl");
  });

  it("routes wechatKf.msgmenu to sendMsgMenuMessage", async () => {
    const msgmenu = {
      head_content: "请选择",
      list: [{ type: "click" as const, click: { id: "1", content: "A" } }],
    };
    const result = await wechatKfOutbound.sendPayload({
      cfg: {},
      to: "ext_user_1",
      accountId: "kf_test",
      payload: {
        channelData: { wechatKf: { msgmenu } },
      },
    });

    expect(mockSendMsgMenuMessage).toHaveBeenCalledWith("corp1", "secret1", "ext_user_1", "kf_test", msgmenu);
    expect(result.messageId).toBe("menu_msg_1");
  });

  it("routes wechatKf.businessCard to sendBusinessCardMessage", async () => {
    const result = await wechatKfOutbound.sendPayload({
      cfg: {},
      to: "ext_user_1",
      accountId: "kf_test",
      payload: {
        channelData: {
          wechatKf: { businessCard: { userid: "servicer_001" } },
        },
      },
    });

    expect(mockSendBusinessCardMessage).toHaveBeenCalledWith("corp1", "secret1", "ext_user_1", "kf_test", {
      userid: "servicer_001",
    });
    expect(result.messageId).toBe("card_msg_1");
  });

  it("routes wechatKf.caLink to sendCaLinkMessage", async () => {
    const result = await wechatKfOutbound.sendPayload({
      cfg: {},
      to: "ext_user_1",
      accountId: "kf_test",
      payload: {
        channelData: {
          wechatKf: { caLink: { link_url: "https://work.weixin.qq.com/ca/abc" } },
        },
      },
    });

    expect(mockSendCaLinkMessage).toHaveBeenCalledWith("corp1", "secret1", "ext_user_1", "kf_test", {
      link_url: "https://work.weixin.qq.com/ca/abc",
    });
    expect(result.messageId).toBe("ca_msg_1");
  });

  it("sends accompanying text with new payload types", async () => {
    await wechatKfOutbound.sendPayload({
      cfg: {},
      to: "ext_user_1",
      text: "Check this location",
      accountId: "kf_test",
      payload: {
        channelData: {
          wechatKf: {
            location: { latitude: 39.9, longitude: 116.3 },
          },
        },
      },
    });

    expect(mockSendLocationMessage).toHaveBeenCalledTimes(1);
    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
  });
});

// ══════════════════════════════════════════════
// sendText — [[wechat_raw:...]] directive
// ══════════════════════════════════════════════

describe("wechatKfOutbound.sendText raw directive", () => {
  it("sends raw message via sendRawMessage", async () => {
    const result = await wechatKfOutbound.sendText({
      cfg: {},
      to: "ext_user_1",
      text: '[[wechat_raw: {"msgtype":"music","music":{"title":"Song","description":"A song"}}]]',
      accountId: "kf_test",
    });

    expect(mockSendRawMessage).toHaveBeenCalledWith("corp1", "secret1", "ext_user_1", "kf_test", "music", {
      music: { title: "Song", description: "A song" },
    });
    expect(result.messageId).toBe("raw_msg_1");
  });

  it("sends remaining text alongside raw message", async () => {
    await wechatKfOutbound.sendText({
      cfg: {},
      to: "ext_user_1",
      text: '试试这个\n[[wechat_raw: {"msgtype":"music","music":{"title":"Song"}}]]',
      accountId: "kf_test",
    });

    expect(mockSendRawMessage).toHaveBeenCalledTimes(1);
    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
    expect(mockSendTextMessage.mock.calls[0][4]).toContain("试试这个");
  });

  it("treats invalid JSON as plain text (no raw parse)", async () => {
    await wechatKfOutbound.sendText({
      cfg: {},
      to: "ext_user_1",
      text: "[[wechat_raw: not valid json]]",
      accountId: "kf_test",
    });

    expect(mockSendRawMessage).not.toHaveBeenCalled();
    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
  });

  it("logs session limit error for raw message", async () => {
    mockLogWarn.mockClear();
    mockSendRawMessage.mockRejectedValue(new Error("WeChat API error 95026: session limit"));

    await expect(
      wechatKfOutbound.sendText({
        cfg: {},
        to: "ext_user_1",
        text: '[[wechat_raw: {"msgtype":"music","music":{}}]]',
        accountId: "kf_test",
      }),
    ).rejects.toThrow("95026");

    expect(mockLogWarn).toHaveBeenCalledWith(expect.stringContaining("session limit exceeded (48h/5-msg)"));
  });
});
