import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock runtime for resolveThumbMediaId tests
const mockLoadWebMedia = vi.fn();
vi.mock("./runtime.js", () => ({
  getRuntime: () => ({
    media: {
      loadWebMedia: (...args: any[]) => mockLoadWebMedia(...args),
    },
  }),
}));

import {
  chunkTextByUtf8Bytes,
  contentTypeToExt,
  detectImageMime,
  detectMediaType,
  downloadMediaFromUrl,
  formatText,
  resolveThumbMediaId,
  uploadAndSendMedia,
} from "./send-utils.js";

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
// contentTypeToExt
// ---------------------------------------------------------------------------
describe("contentTypeToExt", () => {
  it("maps known image content types", () => {
    expect(contentTypeToExt("image/jpeg")).toBe(".jpg");
    expect(contentTypeToExt("image/png")).toBe(".png");
    expect(contentTypeToExt("image/gif")).toBe(".gif");
    expect(contentTypeToExt("image/webp")).toBe(".webp");
    expect(contentTypeToExt("image/bmp")).toBe(".bmp");
  });

  it("maps known audio content types", () => {
    expect(contentTypeToExt("audio/amr")).toBe(".amr");
    expect(contentTypeToExt("audio/mpeg")).toBe(".mp3");
    expect(contentTypeToExt("audio/ogg")).toBe(".ogg");
    expect(contentTypeToExt("audio/wav")).toBe(".wav");
    expect(contentTypeToExt("audio/x-wav")).toBe(".wav");
  });

  it("maps known video and document content types", () => {
    expect(contentTypeToExt("video/mp4")).toBe(".mp4");
    expect(contentTypeToExt("application/pdf")).toBe(".pdf");
  });

  it("returns empty string for unknown content types", () => {
    expect(contentTypeToExt("application/octet-stream")).toBe("");
    expect(contentTypeToExt("text/html")).toBe("");
    expect(contentTypeToExt("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// detectImageMime
// ---------------------------------------------------------------------------
describe("detectImageMime", () => {
  it("detects GIF magic bytes", () => {
    expect(detectImageMime(Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe("image/gif");
    expect(detectImageMime(Buffer.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]))).toBe("image/gif");
  });

  it("detects PNG magic bytes", () => {
    expect(detectImageMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBe("image/png");
  });

  it("detects JPEG magic bytes", () => {
    expect(detectImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
  });

  it("detects BMP magic bytes", () => {
    expect(detectImageMime(Buffer.from([0x42, 0x4d, 0x00, 0x00]))).toBe("image/bmp");
  });

  it("detects WebP magic bytes", () => {
    const webp = Buffer.alloc(12);
    webp.write("RIFF", 0);
    webp.write("WEBP", 8);
    expect(detectImageMime(webp)).toBe("image/webp");
  });

  it("returns null for unknown buffer", () => {
    expect(detectImageMime(Buffer.from([0x00, 0x00, 0x00, 0x00]))).toBeNull();
    expect(detectImageMime(Buffer.from("hello world"))).toBeNull();
  });

  it("returns null for buffer too short", () => {
    expect(detectImageMime(Buffer.from([0x89, 0x50, 0x4e]))).toBeNull();
    expect(detectImageMime(Buffer.alloc(0))).toBeNull();
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

  it("detects .amr as voice (WeChat native format)", () => {
    expect(detectMediaType(".amr")).toBe("voice");
  });

  it("maps other audio extensions to file (not voice)", () => {
    expect(detectMediaType(".mp3")).toBe("file");
    expect(detectMediaType(".wav")).toBe("file");
    expect(detectMediaType(".ogg")).toBe("file");
    expect(detectMediaType(".silk")).toBe("file");
    expect(detectMediaType(".m4a")).toBe("file");
    expect(detectMediaType(".aac")).toBe("file");
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
    expect(detectMediaType(".AMR")).toBe("voice");
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
    uploadMedia: vi
      .fn()
      .mockResolvedValue({ media_id: "mid-123", type: "image", created_at: "1234567890", errcode: 0, errmsg: "ok" }),
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

// ---------------------------------------------------------------------------
// downloadMediaFromUrl
// ---------------------------------------------------------------------------
describe("downloadMediaFromUrl", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeFetchResponse(opts: {
    ok?: boolean;
    status?: number;
    url?: string;
    contentType?: string;
    body?: Buffer;
  }) {
    const body = opts.body ?? Buffer.from("fake data");
    return {
      ok: opts.ok ?? true,
      status: opts.status ?? 200,
      url: opts.url ?? "",
      headers: new Headers(opts.contentType ? { "content-type": opts.contentType } : {}),
      arrayBuffer: () => Promise.resolve(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)),
    };
  }

  it("uses extension from URL when present", async () => {
    mockFetch.mockResolvedValue(makeFetchResponse({ url: "https://example.com/photo.jpg", contentType: "image/png" }));

    const result = await downloadMediaFromUrl("https://example.com/photo.jpg");
    expect(result.ext).toBe(".jpg");
    expect(result.filename).toBe("photo.jpg");
  });

  it("falls back to Content-Type when URL has no extension", async () => {
    mockFetch.mockResolvedValue(makeFetchResponse({ url: "https://picsum.photos/200", contentType: "image/jpeg" }));

    const result = await downloadMediaFromUrl("https://picsum.photos/200");
    expect(result.ext).toBe(".jpg");
    expect(result.filename).toBe("200.jpg");
  });

  it("returns empty ext when URL has no extension and Content-Type is unknown", async () => {
    mockFetch.mockResolvedValue(
      makeFetchResponse({ url: "https://example.com/data", contentType: "application/octet-stream" }),
    );

    const result = await downloadMediaFromUrl("https://example.com/data");
    expect(result.ext).toBe("");
    expect(result.filename).toBe("data");
  });

  it("uses final URL after redirect for pathname extraction", async () => {
    mockFetch.mockResolvedValue(
      makeFetchResponse({
        url: "https://cdn.example.com/images/final-photo.png",
        contentType: "image/png",
      }),
    );

    // Original URL has no extension, but redirect target does
    const result = await downloadMediaFromUrl("https://example.com/redirect/123");
    expect(result.ext).toBe(".png");
    expect(result.filename).toBe("final-photo.png");
  });

  it("throws on non-ok HTTP response", async () => {
    mockFetch.mockResolvedValue(makeFetchResponse({ ok: false, status: 404 }));

    await expect(downloadMediaFromUrl("https://example.com/missing")).rejects.toThrow(
      "failed to download media: HTTP 404",
    );
  });

  it("handles Content-Type with charset parameter", async () => {
    mockFetch.mockResolvedValue(
      makeFetchResponse({ url: "https://example.com/img", contentType: "image/png; charset=utf-8" }),
    );

    const result = await downloadMediaFromUrl("https://example.com/img");
    expect(result.ext).toBe(".png");
    expect(result.filename).toBe("img.png");
  });

  it("uses 'download' as filename when URL path is empty", async () => {
    mockFetch.mockResolvedValue(makeFetchResponse({ url: "https://example.com/", contentType: "image/jpeg" }));

    const result = await downloadMediaFromUrl("https://example.com/");
    expect(result.filename).toBe("download.jpg");
    expect(result.ext).toBe(".jpg");
  });
});

// ---------------------------------------------------------------------------
// resolveThumbMediaId
// ---------------------------------------------------------------------------
describe("resolveThumbMediaId", () => {
  let uploadMedia: typeof import("./api.js")["uploadMedia"];

  beforeEach(async () => {
    const api = await import("./api.js");
    uploadMedia = api.uploadMedia;
    vi.mocked(uploadMedia).mockClear();
    vi.mocked(uploadMedia).mockResolvedValue({
      errcode: 0,
      errmsg: "ok",
      type: "image",
      media_id: "resolved_mid",
      created_at: 123,
    });
    mockLoadWebMedia.mockReset();
  });

  it("resolves HTTP URL via loadWebMedia + uploadMedia", async () => {
    mockLoadWebMedia.mockResolvedValue({
      buffer: Buffer.from("image data"),
      kind: "image",
      fileName: "thumb.jpg",
    });

    const result = await resolveThumbMediaId("https://example.com/thumb.jpg", "corp1", "secret1");

    expect(mockLoadWebMedia).toHaveBeenCalledWith("https://example.com/thumb.jpg", { optimizeImages: false });
    expect(uploadMedia).toHaveBeenCalledWith("corp1", "secret1", "image", expect.any(Buffer), "thumb.jpg");
    expect(result).toBe("resolved_mid");
  });

  it("resolves local absolute path via loadWebMedia + uploadMedia", async () => {
    mockLoadWebMedia.mockResolvedValue({
      buffer: Buffer.from("image data"),
      kind: "image",
      fileName: "photo.png",
    });

    const result = await resolveThumbMediaId("/tmp/photo.png", "corp1", "secret1");

    expect(mockLoadWebMedia).toHaveBeenCalledWith("/tmp/photo.png", { optimizeImages: false });
    expect(uploadMedia).toHaveBeenCalled();
    expect(result).toBe("resolved_mid");
  });

  it("resolves ~/path via loadWebMedia + uploadMedia", async () => {
    mockLoadWebMedia.mockResolvedValue({
      buffer: Buffer.from("image data"),
      kind: "image",
      fileName: "photo.jpg",
    });

    const result = await resolveThumbMediaId("~/photos/thumb.jpg", "corp1", "secret1");

    expect(mockLoadWebMedia).toHaveBeenCalledWith("~/photos/thumb.jpg", { optimizeImages: false });
    expect(result).toBe("resolved_mid");
  });

  it("resolves data: URI via loadWebMedia + uploadMedia", async () => {
    mockLoadWebMedia.mockResolvedValue({
      buffer: Buffer.from("image data"),
      kind: "image",
    });

    const result = await resolveThumbMediaId("data:image/png;base64,abc123", "corp1", "secret1");

    expect(mockLoadWebMedia).toHaveBeenCalledWith("data:image/png;base64,abc123", { optimizeImages: false });
    expect(uploadMedia).toHaveBeenCalledWith("corp1", "secret1", "image", expect.any(Buffer), "thumb.jpg");
    expect(result).toBe("resolved_mid");
  });

  it("resolves file:// URI via loadWebMedia + uploadMedia", async () => {
    mockLoadWebMedia.mockResolvedValue({
      buffer: Buffer.from("image data"),
      kind: "image",
      fileName: "local.png",
    });

    const result = await resolveThumbMediaId("file:///tmp/local.png", "corp1", "secret1");

    expect(mockLoadWebMedia).toHaveBeenCalledWith("file:///tmp/local.png", { optimizeImages: false });
    expect(result).toBe("resolved_mid");
  });

  it("returns media_id string directly without calling loadWebMedia", async () => {
    const result = await resolveThumbMediaId("mid_existing_123", "corp1", "secret1");

    expect(mockLoadWebMedia).not.toHaveBeenCalled();
    expect(uploadMedia).not.toHaveBeenCalled();
    expect(result).toBe("mid_existing_123");
  });

  it("uses fallback filename when loadWebMedia returns no fileName", async () => {
    mockLoadWebMedia.mockResolvedValue({
      buffer: Buffer.from("image data"),
      kind: "image",
    });

    await resolveThumbMediaId("https://example.com/img", "corp1", "secret1");

    expect(uploadMedia).toHaveBeenCalledWith("corp1", "secret1", "image", expect.any(Buffer), "thumb.jpg");
  });
});

// ---------------------------------------------------------------------------
// chunkTextByUtf8Bytes
// ---------------------------------------------------------------------------

/** Helper: return UTF-8 byte length of a string */
function utf8Len(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

describe("chunkTextByUtf8Bytes", () => {
  it("returns empty array for empty/whitespace input", () => {
    expect(chunkTextByUtf8Bytes("", 100)).toEqual([]);
    expect(chunkTextByUtf8Bytes("   ", 100)).toEqual([]);
    expect(chunkTextByUtf8Bytes("\n\n", 100)).toEqual([]);
  });

  it("returns empty array when byteLimit <= 0", () => {
    expect(chunkTextByUtf8Bytes("hello", 0)).toEqual([]);
    expect(chunkTextByUtf8Bytes("hello", -1)).toEqual([]);
  });

  it("returns single chunk when text fits within limit", () => {
    const result = chunkTextByUtf8Bytes("hello world", 100);
    expect(result).toEqual(["hello world"]);
  });

  it("splits pure ASCII text at byte boundary", () => {
    const text = "a".repeat(30);
    const chunks = chunkTextByUtf8Bytes(text, 10);
    expect(chunks.length).toBe(3);
    for (const chunk of chunks) {
      expect(utf8Len(chunk)).toBeLessThanOrEqual(10);
    }
    expect(chunks.join("")).toBe(text);
  });

  it("splits pure Chinese text respecting 3-byte chars", () => {
    // Each Chinese char = 3 bytes. With limit=9, we fit 3 chars per chunk.
    const text = "你好世界测试六七八";
    const chunks = chunkTextByUtf8Bytes(text, 9);
    for (const chunk of chunks) {
      expect(utf8Len(chunk)).toBeLessThanOrEqual(9);
    }
    expect(chunks.join("")).toBe(text);
  });

  it("splits 4-byte emoji/Unicode characters correctly", () => {
    // 😀 = U+1F600, 4 bytes in UTF-8
    const text = "😀😀😀😀😀";
    const chunks = chunkTextByUtf8Bytes(text, 8);
    // 8 bytes = 2 emoji per chunk
    expect(chunks.length).toBe(3); // 2+2+1
    for (const chunk of chunks) {
      expect(utf8Len(chunk)).toBeLessThanOrEqual(8);
    }
    expect(chunks.join("")).toBe(text);
  });

  it("never splits a surrogate pair", () => {
    // 𝐇𝐞𝐥𝐥𝐨 — Unicode math bold, each char is 4 bytes and 2 JS code units
    const text = "𝐇𝐞𝐥𝐥𝐨";
    const chunks = chunkTextByUtf8Bytes(text, 8);
    for (const chunk of chunks) {
      // Each chunk should be valid — no lone surrogates
      expect(utf8Len(chunk)).toBeLessThanOrEqual(8);
      // Verify no broken surrogates by round-tripping through Buffer
      expect(Buffer.from(chunk, "utf8").toString("utf8")).toBe(chunk);
    }
    expect(chunks.join("")).toBe(text);
  });

  it("prefers breaking at newlines", () => {
    const text = "line one\nline two\nline three";
    // "line one\n" = 9 bytes; limit 12 forces break at \n before "line two" overflows
    const chunks = chunkTextByUtf8Bytes(text, 12);
    expect(chunks[0]).toBe("line one");
    expect(chunks[1]).toBe("line two");
    expect(chunks[2]).toBe("line three");
  });

  it("prefers breaking at spaces", () => {
    const text = "hello world foo bar";
    const chunks = chunkTextByUtf8Bytes(text, 12);
    // "hello world " = 12 bytes, should break at space
    expect(chunks[0]).toBe("hello world");
  });

  it("hard-cuts when no break point exists", () => {
    const text = "abcdefghijklmnop"; // 16 chars, no spaces
    const chunks = chunkTextByUtf8Bytes(text, 5);
    expect(chunks).toEqual(["abcde", "fghij", "klmno", "p"]);
  });

  it("handles mixed ASCII + Chinese within byte limit", () => {
    // "hi你" = 2 + 3 = 5 bytes, "好" = 3 bytes
    const text = "hi你好";
    const chunks = chunkTextByUtf8Bytes(text, 5);
    expect(chunks.length).toBe(2);
    expect(utf8Len(chunks[0])).toBeLessThanOrEqual(5);
    expect(utf8Len(chunks[1])).toBeLessThanOrEqual(5);
  });

  it("handles realistic 2000-byte limit with Chinese text", () => {
    // 666 Chinese chars = 1998 bytes, 667 = 2001 bytes
    const text = "中".repeat(700);
    const chunks = chunkTextByUtf8Bytes(text, 2000);
    expect(chunks.length).toBe(2);
    for (const chunk of chunks) {
      expect(utf8Len(chunk)).toBeLessThanOrEqual(2000);
    }
    expect(chunks.join("")).toBe(text);
  });

  it("handles realistic 2000-byte limit with pure ASCII", () => {
    const text = "a".repeat(2000);
    const chunks = chunkTextByUtf8Bytes(text, 2000);
    expect(chunks).toEqual([text]);
  });

  it("trims leading/trailing whitespace from chunks", () => {
    const text = "hello   world";
    const chunks = chunkTextByUtf8Bytes(text, 8);
    for (const chunk of chunks) {
      expect(chunk).toBe(chunk.trim());
    }
  });
});
