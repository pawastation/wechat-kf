import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API_POST_TIMEOUT_MS, MEDIA_TIMEOUT_MS, TOKEN_EXPIRED_CODES, TOKEN_FETCH_TIMEOUT_MS } from "./constants.js";

// ── Mock token module ──

const mockGetAccessToken = vi.fn<(...args: any[]) => Promise<string>>();
const mockClearAccessToken = vi.fn();
vi.mock("./token.js", () => ({
  getAccessToken: (...args: any[]) => mockGetAccessToken(...args),
  clearAccessToken: (...args: any[]) => mockClearAccessToken(...args),
}));

// ── Import after mocks ──

import {
  downloadMedia,
  sendFileMessage,
  sendImageMessage,
  sendLinkMessage,
  sendTextMessage,
  sendVideoMessage,
  sendVoiceMessage,
  syncMessages,
  uploadMedia,
} from "./api.js";

// ── Helpers ──

const CORP_ID = "corp_test";
const APP_SECRET = "secret_test";

/** Build a mock Response with JSON body */
function jsonResponse(data: unknown, headers?: Record<string, string>): Response {
  const body = JSON.stringify(data);
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** Build a mock Response with binary body */
function binaryResponse(data: Buffer, contentType = "image/jpeg"): Response {
  return new Response(new Uint8Array(data), {
    status: 200,
    headers: { "content-type": contentType },
  });
}

// ── Save / restore global fetch ──

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.resetAllMocks();
  mockGetAccessToken.mockResolvedValue("token_v1");
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ══════════════════════════════════════════════
// P1-04: Token expiry auto-retry
// ══════════════════════════════════════════════

describe("P1-04: token expiry auto-retry", () => {
  it("should retry once when API returns errcode 42001 (token expired)", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        // First call: gettoken (from getAccessToken mock, but fetch is for apiPost)
        return jsonResponse({ errcode: 42001, errmsg: "access_token expired" });
      }
      // Retry call
      return jsonResponse({ errcode: 0, errmsg: "ok", next_cursor: "c2", has_more: 0, msg_list: [] });
    }) as typeof fetch;

    // After the first 42001, token module should be called again
    mockGetAccessToken.mockResolvedValueOnce("token_v1").mockResolvedValueOnce("token_v2");

    const result = await syncMessages(CORP_ID, APP_SECRET, { cursor: "c1" });
    expect(result.errcode).toBe(0);
    expect(mockClearAccessToken).toHaveBeenCalledWith(CORP_ID, APP_SECRET);
    expect(mockGetAccessToken).toHaveBeenCalledTimes(2);
  });

  it("should retry once when API returns errcode 40014 (invalid token)", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return jsonResponse({ errcode: 40014, errmsg: "invalid access_token" });
      }
      return jsonResponse({ errcode: 0, errmsg: "ok", msgid: "msg_1" });
    }) as typeof fetch;

    mockGetAccessToken.mockResolvedValueOnce("token_v1").mockResolvedValueOnce("token_v2");

    const result = await sendTextMessage(CORP_ID, APP_SECRET, "user1", "kf_1", "hello");
    expect(result.errcode).toBe(0);
    expect(mockClearAccessToken).toHaveBeenCalledWith(CORP_ID, APP_SECRET);
  });

  it("should throw after retry if still returning token error", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ errcode: 42001, errmsg: "access_token expired" }),
    ) as typeof fetch;

    mockGetAccessToken.mockResolvedValueOnce("token_v1").mockResolvedValueOnce("token_v2");

    // syncMessages checks errcode !== 0 after the retry wrapper returns,
    // so it should throw with the errcode from the second attempt
    await expect(syncMessages(CORP_ID, APP_SECRET, { cursor: "c1" })).rejects.toThrow("sync_msg failed: 42001");
    expect(mockClearAccessToken).toHaveBeenCalledTimes(1);
  });

  it("should NOT retry on non-token errcodes", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ errcode: 44001, errmsg: "empty media data" })) as typeof fetch;

    await expect(sendTextMessage(CORP_ID, APP_SECRET, "user1", "kf_1", "hello")).rejects.toThrow(
      "send_msg failed: 44001",
    );
    expect(mockClearAccessToken).not.toHaveBeenCalled();
    expect(mockGetAccessToken).toHaveBeenCalledTimes(1);
  });

  it("should pass on success without retry", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ errcode: 0, errmsg: "ok", next_cursor: "c2", has_more: 0, msg_list: [] }),
    ) as typeof fetch;

    const result = await syncMessages(CORP_ID, APP_SECRET, { cursor: "c1" });
    expect(result.errcode).toBe(0);
    expect(mockClearAccessToken).not.toHaveBeenCalled();
    expect(mockGetAccessToken).toHaveBeenCalledTimes(1);
  });
});

// ══════════════════════════════════════════════
// P1-05: downloadMedia error detection
// ══════════════════════════════════════════════

describe("P1-05: downloadMedia error detection", () => {
  it("should throw when response Content-Type is application/json (business error)", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ errcode: 40007, errmsg: "invalid media_id" })) as typeof fetch;

    await expect(downloadMedia(CORP_ID, APP_SECRET, "bad_media_id")).rejects.toThrow(
      "[wechat-kf] download media failed: 40007 invalid media_id",
    );
  });

  it("should return { buffer, contentType } for binary responses (image/jpeg)", async () => {
    const imageData = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes
    globalThis.fetch = vi.fn(async () => binaryResponse(imageData)) as typeof fetch;

    const result = await downloadMedia(CORP_ID, APP_SECRET, "valid_media_id");
    expect(Buffer.isBuffer(result.buffer)).toBe(true);
    expect(result.buffer.length).toBe(4);
    expect(result.buffer[0]).toBe(0x89);
    expect(result.contentType).toBe("image/jpeg");
  });

  it("should return correct contentType for GIF response", async () => {
    const gifData = Buffer.from([0x47, 0x49, 0x46, 0x38]); // GIF magic bytes
    globalThis.fetch = vi.fn(async () => binaryResponse(gifData, "image/gif")) as typeof fetch;

    const result = await downloadMedia(CORP_ID, APP_SECRET, "gif_media_id");
    expect(Buffer.isBuffer(result.buffer)).toBe(true);
    expect(result.contentType).toBe("image/gif");
  });

  it("should return correct contentType for PNG response", async () => {
    const pngData = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes
    globalThis.fetch = vi.fn(async () => binaryResponse(pngData, "image/png")) as typeof fetch;

    const result = await downloadMedia(CORP_ID, APP_SECRET, "png_media_id");
    expect(Buffer.isBuffer(result.buffer)).toBe(true);
    expect(result.contentType).toBe("image/png");
  });

  it("should throw on HTTP error status", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("Not Found", { status: 404, statusText: "Not Found" }),
    ) as typeof fetch;

    await expect(downloadMedia(CORP_ID, APP_SECRET, "media_404")).rejects.toThrow(
      "[wechat-kf] download media failed: 404 Not Found",
    );
  });

  it("should retry on token-expired JSON error during download", async () => {
    let callCount = 0;
    const imageData = Buffer.from([0xff, 0xd8, 0xff, 0xe0]); // JPEG magic bytes
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return jsonResponse({ errcode: 42001, errmsg: "access_token expired" });
      }
      return binaryResponse(imageData);
    }) as typeof fetch;

    mockGetAccessToken.mockResolvedValueOnce("token_v1").mockResolvedValueOnce("token_v2");

    const result = await downloadMedia(CORP_ID, APP_SECRET, "media_retry");
    expect(Buffer.isBuffer(result.buffer)).toBe(true);
    expect(result.buffer.length).toBe(4);
    expect(result.contentType).toBe("image/jpeg");
    expect(mockClearAccessToken).toHaveBeenCalledWith(CORP_ID, APP_SECRET);
  });

  it("should throw after download retry still returns JSON error", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ errcode: 42001, errmsg: "access_token expired" }),
    ) as typeof fetch;

    mockGetAccessToken.mockResolvedValueOnce("token_v1").mockResolvedValueOnce("token_v2");

    await expect(downloadMedia(CORP_ID, APP_SECRET, "media_fail")).rejects.toThrow(
      "[wechat-kf] download media failed: 42001",
    );
    expect(mockClearAccessToken).toHaveBeenCalledTimes(1);
  });
});

// ══════════════════════════════════════════════
// P1-09: fetch timeout
// ══════════════════════════════════════════════

describe("P1-09: fetch timeout", () => {
  it("should pass AbortSignal.timeout to apiPost fetch calls", async () => {
    const signals: (AbortSignal | undefined)[] = [];
    globalThis.fetch = vi.fn(async (_url: any, init?: any) => {
      signals.push(init?.signal);
      return jsonResponse({ errcode: 0, errmsg: "ok", next_cursor: "c2", has_more: 0, msg_list: [] });
    }) as typeof fetch;

    await syncMessages(CORP_ID, APP_SECRET, { cursor: "c1" });
    expect(signals.length).toBe(1);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
  });

  it("should pass AbortSignal.timeout to downloadMedia fetch calls", async () => {
    const signals: (AbortSignal | undefined)[] = [];
    const imageData = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    globalThis.fetch = vi.fn(async (_url: any, init?: any) => {
      signals.push(init?.signal);
      return binaryResponse(imageData);
    }) as typeof fetch;

    await downloadMedia(CORP_ID, APP_SECRET, "media_1");
    expect(signals.length).toBe(1);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
  });

  it("should pass AbortSignal.timeout to uploadMedia fetch calls", async () => {
    const signals: (AbortSignal | undefined)[] = [];
    globalThis.fetch = vi.fn(async (_url: any, init?: any) => {
      signals.push(init?.signal);
      return jsonResponse({
        errcode: 0,
        errmsg: "ok",
        type: "image",
        media_id: "mid_1",
        created_at: 1234567890,
      });
    }) as typeof fetch;

    await uploadMedia(CORP_ID, APP_SECRET, "image", Buffer.from("fake"), "test.jpg");
    expect(signals.length).toBe(1);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
  });

  it("should propagate AbortError when fetch times out", async () => {
    globalThis.fetch = vi.fn(async (_url: any, init?: any) => {
      // Simulate a timeout by checking the signal and aborting
      const signal = init?.signal as AbortSignal | undefined;
      if (signal) {
        const err = new DOMException("The operation was aborted", "AbortError");
        throw err;
      }
      return jsonResponse({ errcode: 0, errmsg: "ok" });
    }) as typeof fetch;

    await expect(syncMessages(CORP_ID, APP_SECRET, { cursor: "c1" })).rejects.toThrow("aborted");
  });
});

// ══════════════════════════════════════════════
// P1-04 + P1-09: uploadMedia token retry + timeout
// ══════════════════════════════════════════════

describe("uploadMedia: token retry and timeout", () => {
  it("should retry upload on token-expired error", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return jsonResponse({ errcode: 42001, errmsg: "access_token expired", type: "", media_id: "", created_at: 0 });
      }
      return jsonResponse({ errcode: 0, errmsg: "ok", type: "image", media_id: "mid_2", created_at: 123 });
    }) as typeof fetch;

    mockGetAccessToken.mockResolvedValueOnce("token_v1").mockResolvedValueOnce("token_v2");

    const result = await uploadMedia(CORP_ID, APP_SECRET, "image", Buffer.from("data"), "test.png");
    expect(result.errcode).toBe(0);
    expect(result.media_id).toBe("mid_2");
    expect(mockClearAccessToken).toHaveBeenCalledWith(CORP_ID, APP_SECRET);
  });

  it("should throw on non-token upload error", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ errcode: 44001, errmsg: "empty media data", type: "", media_id: "", created_at: 0 }),
    ) as typeof fetch;

    await expect(uploadMedia(CORP_ID, APP_SECRET, "image", Buffer.from("data"), "test.png")).rejects.toThrow(
      "upload media failed: 44001",
    );
    expect(mockClearAccessToken).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════
// Constants sanity checks
// ══════════════════════════════════════════════

describe("timeout and token constants", () => {
  it("TOKEN_EXPIRED_CODES should contain 40014, 42001, 40001", () => {
    expect(TOKEN_EXPIRED_CODES.has(40014)).toBe(true);
    expect(TOKEN_EXPIRED_CODES.has(42001)).toBe(true);
    expect(TOKEN_EXPIRED_CODES.has(40001)).toBe(true);
    expect(TOKEN_EXPIRED_CODES.size).toBe(3);
  });

  it("timeout values should be positive numbers", () => {
    expect(TOKEN_FETCH_TIMEOUT_MS).toBe(15_000);
    expect(API_POST_TIMEOUT_MS).toBe(30_000);
    expect(MEDIA_TIMEOUT_MS).toBe(60_000);
  });
});

// ══════════════════════════════════════════════
// P3-02: Unified errcode check pattern
// ══════════════════════════════════════════════

describe("P3-02: unified errcode check pattern", () => {
  it("syncMessages should succeed when errcode is 0", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ errcode: 0, errmsg: "ok", next_cursor: "c2", has_more: 0, msg_list: [] }),
    ) as typeof fetch;

    const result = await syncMessages(CORP_ID, APP_SECRET, { cursor: "c1" });
    expect(result.errcode).toBe(0);
    expect(result.next_cursor).toBe("c2");
  });

  it("syncMessages should succeed when errcode is omitted (undefined)", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ errmsg: "ok", next_cursor: "c3", has_more: 0, msg_list: [] }),
    ) as typeof fetch;

    const result = await syncMessages(CORP_ID, APP_SECRET, { cursor: "c1" });
    expect(result.errcode).toBeUndefined();
    expect(result.next_cursor).toBe("c3");
  });

  it("sendTextMessage should succeed when errcode is omitted (undefined)", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ errmsg: "ok", msgid: "msg_no_errcode" })) as typeof fetch;

    const result = await sendTextMessage(CORP_ID, APP_SECRET, "user1", "kf_1", "hello");
    expect(result.errcode).toBeUndefined();
    expect(result.msgid).toBe("msg_no_errcode");
  });

  it("uploadMedia should succeed when errcode is omitted (undefined)", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ errmsg: "ok", type: "image", media_id: "mid_no_errcode", created_at: 999 }),
    ) as typeof fetch;

    const result = await uploadMedia(CORP_ID, APP_SECRET, "image", Buffer.from("data"), "test.png");
    expect(result.errcode).toBeUndefined();
    expect(result.media_id).toBe("mid_no_errcode");
  });

  it("syncMessages should throw on non-zero errcode", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ errcode: 95000, errmsg: "system error", next_cursor: "", has_more: 0, msg_list: [] }),
    ) as typeof fetch;

    await expect(syncMessages(CORP_ID, APP_SECRET, { cursor: "c1" })).rejects.toThrow("sync_msg failed: 95000");
  });

  it("sendTextMessage should throw on non-zero errcode", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ errcode: 95000, errmsg: "system error", msgid: "" }),
    ) as typeof fetch;

    await expect(sendTextMessage(CORP_ID, APP_SECRET, "user1", "kf_1", "hello")).rejects.toThrow(
      "send_msg failed: 95000",
    );
  });

  it("uploadMedia should throw on non-zero errcode", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ errcode: 44001, errmsg: "empty media data", type: "", media_id: "", created_at: 0 }),
    ) as typeof fetch;

    await expect(uploadMedia(CORP_ID, APP_SECRET, "image", Buffer.from("data"), "test.png")).rejects.toThrow(
      "upload media failed: 44001",
    );
  });
});

// ══════════════════════════════════════════════
// P2-09: Deduplicated send functions
// ══════════════════════════════════════════════

describe("P2-09: deduplicated send functions", () => {
  /** Capture the JSON body posted by fetch */
  function captureSendBody(): { body: () => Record<string, unknown> } {
    let captured: Record<string, unknown> = {};
    globalThis.fetch = vi.fn(async (_url: any, init?: any) => {
      captured = JSON.parse(init?.body ?? "{}");
      return jsonResponse({ errcode: 0, errmsg: "ok", msgid: "msg_ok" });
    }) as typeof fetch;
    return { body: () => captured };
  }

  it("sendTextMessage should send correct msgtype and text payload", async () => {
    const { body } = captureSendBody();
    const result = await sendTextMessage(CORP_ID, APP_SECRET, "user1", "kf_1", "hello");
    expect(result.errcode).toBe(0);
    expect(body()).toMatchObject({
      touser: "user1",
      open_kfid: "kf_1",
      msgtype: "text",
      text: { content: "hello" },
    });
  });

  it("sendImageMessage should send correct msgtype and image payload", async () => {
    const { body } = captureSendBody();
    const result = await sendImageMessage(CORP_ID, APP_SECRET, "user1", "kf_1", "media_img");
    expect(result.errcode).toBe(0);
    expect(body()).toMatchObject({
      touser: "user1",
      open_kfid: "kf_1",
      msgtype: "image",
      image: { media_id: "media_img" },
    });
  });

  it("sendVoiceMessage should send correct msgtype and voice payload", async () => {
    const { body } = captureSendBody();
    const result = await sendVoiceMessage(CORP_ID, APP_SECRET, "user1", "kf_1", "media_voice");
    expect(result.errcode).toBe(0);
    expect(body()).toMatchObject({
      touser: "user1",
      open_kfid: "kf_1",
      msgtype: "voice",
      voice: { media_id: "media_voice" },
    });
  });

  it("sendVideoMessage should send correct msgtype and video payload", async () => {
    const { body } = captureSendBody();
    const result = await sendVideoMessage(CORP_ID, APP_SECRET, "user1", "kf_1", "media_vid");
    expect(result.errcode).toBe(0);
    expect(body()).toMatchObject({
      touser: "user1",
      open_kfid: "kf_1",
      msgtype: "video",
      video: { media_id: "media_vid" },
    });
  });

  it("sendFileMessage should send correct msgtype and file payload", async () => {
    const { body } = captureSendBody();
    const result = await sendFileMessage(CORP_ID, APP_SECRET, "user1", "kf_1", "media_file");
    expect(result.errcode).toBe(0);
    expect(body()).toMatchObject({
      touser: "user1",
      open_kfid: "kf_1",
      msgtype: "file",
      file: { media_id: "media_file" },
    });
  });

  it("sendLinkMessage should send correct msgtype and link payload", async () => {
    const { body } = captureSendBody();
    const link = { title: "Title", desc: "Desc", url: "https://example.com", thumb_media_id: "thumb_1" };
    const result = await sendLinkMessage(CORP_ID, APP_SECRET, "user1", "kf_1", link);
    expect(result.errcode).toBe(0);
    expect(body()).toMatchObject({
      touser: "user1",
      open_kfid: "kf_1",
      msgtype: "link",
      link,
    });
  });

  it("all send functions should throw unified send_msg error on failure", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ errcode: 90001, errmsg: "some error", msgid: "" }),
    ) as typeof fetch;

    // All functions should throw with the same "send_msg failed" prefix
    await expect(sendTextMessage(CORP_ID, APP_SECRET, "u", "kf", "hi")).rejects.toThrow("send_msg failed: 90001");
    await expect(sendImageMessage(CORP_ID, APP_SECRET, "u", "kf", "m")).rejects.toThrow("send_msg failed: 90001");
    await expect(sendVoiceMessage(CORP_ID, APP_SECRET, "u", "kf", "m")).rejects.toThrow("send_msg failed: 90001");
    await expect(sendVideoMessage(CORP_ID, APP_SECRET, "u", "kf", "m")).rejects.toThrow("send_msg failed: 90001");
    await expect(sendFileMessage(CORP_ID, APP_SECRET, "u", "kf", "m")).rejects.toThrow("send_msg failed: 90001");
    await expect(
      sendLinkMessage(CORP_ID, APP_SECRET, "u", "kf", { title: "t", url: "u", thumb_media_id: "t" }),
    ).rejects.toThrow("send_msg failed: 90001");
  });

  it("send functions should support token retry via shared helper", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return jsonResponse({ errcode: 42001, errmsg: "access_token expired", msgid: "" });
      }
      return jsonResponse({ errcode: 0, errmsg: "ok", msgid: "msg_retry" });
    }) as typeof fetch;

    mockGetAccessToken.mockResolvedValueOnce("token_v1").mockResolvedValueOnce("token_v2");

    const result = await sendImageMessage(CORP_ID, APP_SECRET, "user1", "kf_1", "media_1");
    expect(result.errcode).toBe(0);
    expect(mockClearAccessToken).toHaveBeenCalledWith(CORP_ID, APP_SECRET);
    expect(mockGetAccessToken).toHaveBeenCalledTimes(2);
  });
});
