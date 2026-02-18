import { describe, it, expect, vi, beforeEach } from "vitest";
import { WECHAT_TEXT_CHUNK_LIMIT } from "./constants.js";

// ── Mock dependencies before importing outbound ──

const mockResolveAccount = vi.fn();
vi.mock("./accounts.js", () => ({
  resolveAccount: (...args: any[]) => mockResolveAccount(...args),
}));

const mockSendTextMessage = vi.fn();
vi.mock("./api.js", () => ({
  sendTextMessage: (...args: any[]) => mockSendTextMessage(...args),
  uploadMedia: vi.fn().mockResolvedValue({
    errcode: 0, errmsg: "ok", type: "image", media_id: "mid_123", created_at: 123,
  }),
  sendImageMessage: vi.fn().mockResolvedValue({ errcode: 0, errmsg: "ok", msgid: "img_msg_1" }),
  sendVoiceMessage: vi.fn().mockResolvedValue({ errcode: 0, errmsg: "ok", msgid: "voice_msg_1" }),
  sendVideoMessage: vi.fn().mockResolvedValue({ errcode: 0, errmsg: "ok", msgid: "video_msg_1" }),
  sendFileMessage: vi.fn().mockResolvedValue({ errcode: 0, errmsg: "ok", msgid: "file_msg_1" }),
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
  webhookPort: 9999,
  webhookPath: "/wechat-kf",
  config: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveAccount.mockReturnValue(defaultAccount);
  mockSendTextMessage.mockResolvedValue({ errcode: 0, errmsg: "ok", msgid: "msg_001" });
});

// ══════════════════════════════════════════════
// Structural / declarative tests
// ══════════════════════════════════════════════

describe("wechatKfOutbound declarations", () => {
  it("declares chunker for framework auto-chunking", () => {
    expect(typeof wechatKfOutbound.chunker).toBe("function");
    expect(wechatKfOutbound.chunkerMode).toBe("text");
    expect(wechatKfOutbound.textChunkLimit).toBe(WECHAT_TEXT_CHUNK_LIMIT);
  });

  it("chunker returns array of strings", () => {
    const result = wechatKfOutbound.chunker("hello world", 5);
    expect(Array.isArray(result)).toBe(true);
    result.forEach((chunk: string) => expect(typeof chunk).toBe("string"));
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

    expect(mockSendTextMessage).toHaveBeenCalledWith(
      "corp1", "secret1", "ext_user_123", "kf_test", "hello world",
    );
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

    expect(mockSendTextMessage).toHaveBeenCalledWith(
      "corp1", "secret1", "ext_user_456", "kf_test", expect.any(String),
    );
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

    await expect(
      wechatKfOutbound.sendText({ cfg: {}, to: "u", text: "t", accountId: "kf" }),
    ).rejects.toThrow("missing corpId/appSecret/openKfId");
  });

  it("throws when appSecret is missing", async () => {
    mockResolveAccount.mockReturnValue({ ...defaultAccount, appSecret: undefined });

    await expect(
      wechatKfOutbound.sendText({ cfg: {}, to: "u", text: "t", accountId: "kf" }),
    ).rejects.toThrow("missing corpId/appSecret/openKfId");
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
    expect(mockSendTextMessage).toHaveBeenCalledWith(
      "corp1", "secret1", "ext_user", "kf_fallback", expect.any(String),
    );
  });
});

// ══════════════════════════════════════════════
// sendMedia
// ══════════════════════════════════════════════

describe("wechatKfOutbound.sendMedia", () => {
  it("reads file, uploads, and sends media for local path", async () => {
    mockReadFile.mockResolvedValue(Buffer.from("fake image data"));

    const { uploadMedia, sendImageMessage } = await import("./api.js");

    const result = await wechatKfOutbound.sendMedia({
      cfg: {},
      to: "ext_user_1",
      text: "",
      mediaPath: "/tmp/photo.jpg",
      accountId: "kf_test",
    });

    expect(mockReadFile).toHaveBeenCalledWith("/tmp/photo.jpg");
    expect(uploadMedia).toHaveBeenCalledWith("corp1", "secret1", "image", expect.any(Buffer), "photo.jpg");
    expect(sendImageMessage).toHaveBeenCalledWith("corp1", "secret1", "ext_user_1", "kf_test", "mid_123");
    expect(result.messageId).toBe("img_msg_1");
  });

  it("sends accompanying text with formatText after media", async () => {
    mockReadFile.mockResolvedValue(Buffer.from("fake"));

    await wechatKfOutbound.sendMedia({
      cfg: {},
      to: "ext_user_1",
      text: "**caption here**",
      mediaPath: "/tmp/photo.jpg",
      accountId: "kf_test",
    });

    // sendTextMessage should be called for accompanying text
    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
    const sentText = mockSendTextMessage.mock.calls[0][4];
    // formatText converts **bold** to Unicode bold
    expect(sentText).not.toContain("**");
  });

  it("does not send text when accompanying text is empty/whitespace", async () => {
    mockReadFile.mockResolvedValue(Buffer.from("fake"));

    await wechatKfOutbound.sendMedia({
      cfg: {},
      to: "ext_user_1",
      text: "   ",
      mediaPath: "/tmp/photo.jpg",
      accountId: "kf_test",
    });

    // Should NOT send text message
    expect(mockSendTextMessage).not.toHaveBeenCalled();
  });

  it("downloads from HTTP URL, uploads, and sends media", async () => {
    mockDownloadMediaFromUrl.mockResolvedValue({
      buffer: Buffer.from("downloaded image data"),
      filename: "photo.jpg",
      ext: ".jpg",
    });

    const { uploadMedia, sendImageMessage } = await import("./api.js");

    const result = await wechatKfOutbound.sendMedia({
      cfg: {},
      to: "ext_user_1",
      text: "",
      mediaUrl: "https://example.com/photo.jpg",
      accountId: "kf_test",
    });

    expect(mockDownloadMediaFromUrl).toHaveBeenCalledWith("https://example.com/photo.jpg");
    expect(mockReadFile).not.toHaveBeenCalled();
    expect(uploadMedia).toHaveBeenCalledWith("corp1", "secret1", "image", expect.any(Buffer), "photo.jpg");
    expect(sendImageMessage).toHaveBeenCalledWith("corp1", "secret1", "ext_user_1", "kf_test", "mid_123");
    expect(result.messageId).toBe("img_msg_1");
  });

  it("downloads from HTTP URL with mediaPath and sends media", async () => {
    mockDownloadMediaFromUrl.mockResolvedValue({
      buffer: Buffer.from("downloaded image data"),
      filename: "photo.jpg",
      ext: ".jpg",
    });

    const { uploadMedia, sendImageMessage } = await import("./api.js");

    const result = await wechatKfOutbound.sendMedia({
      cfg: {},
      to: "ext_user_1",
      text: "Check this out",
      mediaPath: "https://example.com/photo.jpg",
      accountId: "kf_test",
    });

    expect(mockDownloadMediaFromUrl).toHaveBeenCalledWith("https://example.com/photo.jpg");
    expect(mockReadFile).not.toHaveBeenCalled();
    expect(uploadMedia).toHaveBeenCalled();
    expect(sendImageMessage).toHaveBeenCalled();
    // Also sends accompanying text
    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
    expect(result.messageId).toBe("img_msg_1");
  });

  it("detects media type from HTTP URL extension", async () => {
    mockDownloadMediaFromUrl.mockResolvedValue({
      buffer: Buffer.from("audio data"),
      filename: "recording.mp3",
      ext: ".mp3",
    });

    const { uploadMedia, sendVoiceMessage } = await import("./api.js");

    await wechatKfOutbound.sendMedia({
      cfg: {},
      to: "ext_user_1",
      text: "",
      mediaUrl: "https://cdn.example.com/audio/recording.mp3",
      accountId: "kf_test",
    });

    expect(uploadMedia).toHaveBeenCalledWith("corp1", "secret1", "voice", expect.any(Buffer), "recording.mp3");
    expect(sendVoiceMessage).toHaveBeenCalled();
  });

  it("falls back to text when no mediaPath or mediaUrl", async () => {
    await wechatKfOutbound.sendMedia({
      cfg: {},
      to: "ext_user_1",
      text: "just text",
      accountId: "kf_test",
    });

    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
  });

  it("detects voice media type for .mp3 files", async () => {
    mockReadFile.mockResolvedValue(Buffer.from("audio data"));
    const { uploadMedia, sendVoiceMessage } = await import("./api.js");

    await wechatKfOutbound.sendMedia({
      cfg: {},
      to: "ext_user_1",
      text: "",
      mediaPath: "/tmp/recording.mp3",
      accountId: "kf_test",
    });

    expect(uploadMedia).toHaveBeenCalledWith("corp1", "secret1", "voice", expect.any(Buffer), "recording.mp3");
    expect(sendVoiceMessage).toHaveBeenCalled();
  });

  it("detects video media type for .mp4 files", async () => {
    mockReadFile.mockResolvedValue(Buffer.from("video data"));
    const { uploadMedia, sendVideoMessage } = await import("./api.js");

    await wechatKfOutbound.sendMedia({
      cfg: {},
      to: "ext_user_1",
      text: "",
      mediaPath: "/tmp/clip.mp4",
      accountId: "kf_test",
    });

    expect(uploadMedia).toHaveBeenCalledWith("corp1", "secret1", "video", expect.any(Buffer), "clip.mp4");
    expect(sendVideoMessage).toHaveBeenCalled();
  });

  it("detects file media type for .pdf files", async () => {
    mockReadFile.mockResolvedValue(Buffer.from("pdf data"));
    const { uploadMedia, sendFileMessage } = await import("./api.js");

    await wechatKfOutbound.sendMedia({
      cfg: {},
      to: "ext_user_1",
      text: "",
      mediaPath: "/tmp/doc.pdf",
      accountId: "kf_test",
    });

    expect(uploadMedia).toHaveBeenCalledWith("corp1", "secret1", "file", expect.any(Buffer), "doc.pdf");
    expect(sendFileMessage).toHaveBeenCalled();
  });

  it("throws when corpId is missing", async () => {
    mockResolveAccount.mockReturnValue({ ...defaultAccount, corpId: undefined });

    await expect(
      wechatKfOutbound.sendMedia({
        cfg: {},
        to: "u",
        text: "",
        mediaPath: "/tmp/x.jpg",
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
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockSendTextMessage.mockRejectedValue(new Error("WeChat API error 95026: session limit"));

    await expect(
      wechatKfOutbound.sendText({
        cfg: {},
        to: "ext_user_1",
        text: "hello",
        accountId: "kf_test",
      }),
    ).rejects.toThrow("95026");

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("session limit exceeded (48h/5-msg)"),
    );
    consoleSpy.mockRestore();
  });

  it("sendText does not log session limit warning for other errors", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockSendTextMessage.mockRejectedValue(new Error("network error"));

    await expect(
      wechatKfOutbound.sendText({
        cfg: {},
        to: "ext_user_1",
        text: "hello",
        accountId: "kf_test",
      }),
    ).rejects.toThrow("network error");

    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("sendMedia logs and re-throws on 95026 error for HTTP URL", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockDownloadMediaFromUrl.mockResolvedValue({
      buffer: Buffer.from("data"),
      filename: "photo.jpg",
      ext: ".jpg",
    });

    const { uploadMedia } = await import("./api.js");
    (uploadMedia as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("WeChat API error 95026: session limit"),
    );

    await expect(
      wechatKfOutbound.sendMedia({
        cfg: {},
        to: "ext_user_1",
        text: "",
        mediaUrl: "https://example.com/photo.jpg",
        accountId: "kf_test",
      }),
    ).rejects.toThrow("95026");

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("session limit exceeded (48h/5-msg)"),
    );
    consoleSpy.mockRestore();
  });

  it("sendMedia logs and re-throws on 95026 error for local file", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockReadFile.mockResolvedValue(Buffer.from("data"));

    const { uploadMedia } = await import("./api.js");
    (uploadMedia as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("WeChat API error 95026: session limit"),
    );

    await expect(
      wechatKfOutbound.sendMedia({
        cfg: {},
        to: "ext_user_1",
        text: "",
        mediaPath: "/tmp/photo.jpg",
        accountId: "kf_test",
      }),
    ).rejects.toThrow("95026");

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("session limit exceeded (48h/5-msg)"),
    );
    consoleSpy.mockRestore();
  });
});
