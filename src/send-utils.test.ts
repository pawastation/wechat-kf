import { describe, it, expect, vi } from "vitest";
import { formatText, detectMediaType, uploadAndSendMedia } from "./send-utils.js";

// ---------------------------------------------------------------------------
// formatText
// ---------------------------------------------------------------------------
describe("formatText", () => {
  it("converts markdown bold to Unicode bold", () => {
    const result = formatText("**hello**");
    // markdownToUnicode converts bold — just verify it's no longer raw markdown
    expect(result).not.toContain("**");
    expect(result).not.toBe("hello");
  });

  it("returns empty string for empty input", () => {
    expect(formatText("")).toBe("");
  });

  it("passes plain text through unchanged", () => {
    expect(formatText("plain text 123")).toBe("plain text 123");
  });
});

// ---------------------------------------------------------------------------
// detectMediaType
// ---------------------------------------------------------------------------
describe("detectMediaType", () => {
  it("detects image extensions", () => {
    expect(detectMediaType(".jpg")).toBe("image");
    expect(detectMediaType(".jpeg")).toBe("image");
    expect(detectMediaType(".png")).toBe("image");
    expect(detectMediaType(".gif")).toBe("image");
    expect(detectMediaType(".bmp")).toBe("image");
    expect(detectMediaType(".webp")).toBe("image");
  });

  it("detects voice extensions", () => {
    expect(detectMediaType(".amr")).toBe("voice");
    expect(detectMediaType(".mp3")).toBe("voice");
    expect(detectMediaType(".wav")).toBe("voice");
    expect(detectMediaType(".ogg")).toBe("voice");
    expect(detectMediaType(".silk")).toBe("voice");
    expect(detectMediaType(".m4a")).toBe("voice");
    expect(detectMediaType(".aac")).toBe("voice");
  });

  it("detects video extensions", () => {
    expect(detectMediaType(".mp4")).toBe("video");
    expect(detectMediaType(".avi")).toBe("video");
    expect(detectMediaType(".mov")).toBe("video");
    expect(detectMediaType(".mkv")).toBe("video");
    expect(detectMediaType(".wmv")).toBe("video");
  });

  it('returns "file" for unknown or document extensions', () => {
    expect(detectMediaType(".pdf")).toBe("file");
    expect(detectMediaType(".docx")).toBe("file");
    expect(detectMediaType(".unknown")).toBe("file");
    expect(detectMediaType(".zip")).toBe("file");
    expect(detectMediaType(".txt")).toBe("file");
  });

  it("is case insensitive", () => {
    expect(detectMediaType(".JPG")).toBe("image");
    expect(detectMediaType(".PNG")).toBe("image");
    expect(detectMediaType(".Mp3")).toBe("voice");
    expect(detectMediaType(".MP4")).toBe("video");
    expect(detectMediaType(".PDF")).toBe("file");
  });
});

// ---------------------------------------------------------------------------
// uploadAndSendMedia
// ---------------------------------------------------------------------------
describe("uploadAndSendMedia", () => {
  const corpId = "corp1";
  const appSecret = "secret1";
  const toUser = "user1";
  const openKfId = "kf1";
  const buffer = Buffer.from("fake");
  const filename = "test.jpg";

  // We mock the api module to avoid real HTTP calls
  vi.mock("./api.js", () => ({
    uploadMedia: vi.fn().mockResolvedValue({ media_id: "mid-123", type: "image", created_at: "1234567890", errcode: 0, errmsg: "ok" }),
    sendImageMessage: vi.fn().mockResolvedValue({ msgid: "img-msg-1", errcode: 0, errmsg: "ok" }),
    sendVoiceMessage: vi.fn().mockResolvedValue({ msgid: "voice-msg-1", errcode: 0, errmsg: "ok" }),
    sendVideoMessage: vi.fn().mockResolvedValue({ msgid: "video-msg-1", errcode: 0, errmsg: "ok" }),
    sendFileMessage: vi.fn().mockResolvedValue({ msgid: "file-msg-1", errcode: 0, errmsg: "ok" }),
  }));

  it("uploads then sends an image message", async () => {
    const { uploadMedia, sendImageMessage } = await import("./api.js");
    const result = await uploadAndSendMedia(corpId, appSecret, toUser, openKfId, buffer, filename, "image");
    expect(uploadMedia).toHaveBeenCalledWith(corpId, appSecret, "image", buffer, filename);
    expect(sendImageMessage).toHaveBeenCalledWith(corpId, appSecret, toUser, openKfId, "mid-123");
    expect(result.msgid).toBe("img-msg-1");
  });

  it("uploads then sends a voice message", async () => {
    const { uploadMedia, sendVoiceMessage } = await import("./api.js");
    const result = await uploadAndSendMedia(corpId, appSecret, toUser, openKfId, buffer, "test.mp3", "voice");
    expect(uploadMedia).toHaveBeenCalledWith(corpId, appSecret, "voice", buffer, "test.mp3");
    expect(sendVoiceMessage).toHaveBeenCalledWith(corpId, appSecret, toUser, openKfId, "mid-123");
    expect(result.msgid).toBe("voice-msg-1");
  });

  it("uploads then sends a video message", async () => {
    const { uploadMedia, sendVideoMessage } = await import("./api.js");
    const result = await uploadAndSendMedia(corpId, appSecret, toUser, openKfId, buffer, "test.mp4", "video");
    expect(uploadMedia).toHaveBeenCalledWith(corpId, appSecret, "video", buffer, "test.mp4");
    expect(sendVideoMessage).toHaveBeenCalledWith(corpId, appSecret, toUser, openKfId, "mid-123");
    expect(result.msgid).toBe("video-msg-1");
  });

  it("uploads then sends a file message for unknown types", async () => {
    const { uploadMedia, sendFileMessage } = await import("./api.js");
    const result = await uploadAndSendMedia(corpId, appSecret, toUser, openKfId, buffer, "test.pdf", "file");
    expect(uploadMedia).toHaveBeenCalledWith(corpId, appSecret, "file", buffer, "test.pdf");
    expect(sendFileMessage).toHaveBeenCalledWith(corpId, appSecret, toUser, openKfId, "mid-123");
    expect(result.msgid).toBe("file-msg-1");
  });
});
