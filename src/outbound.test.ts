import { describe, it, expect } from "vitest";
import { wechatKfOutbound } from "./outbound.js";
import { WECHAT_TEXT_CHUNK_LIMIT } from "./constants.js";

describe("wechatKfOutbound", () => {
  it("declares chunker for framework auto-chunking", () => {
    expect(typeof wechatKfOutbound.chunker).toBe("function");
    expect(wechatKfOutbound.chunkerMode).toBe("text");
    expect(wechatKfOutbound.textChunkLimit).toBe(WECHAT_TEXT_CHUNK_LIMIT);
  });

  it("chunker returns array of strings", () => {
    const result = wechatKfOutbound.chunker("hello world", 5);
    expect(Array.isArray(result)).toBe(true);
    result.forEach((chunk) => expect(typeof chunk).toBe("string"));
  });

  it("textChunkLimit equals WECHAT_TEXT_CHUNK_LIMIT constant (2000)", () => {
    expect(wechatKfOutbound.textChunkLimit).toBe(2000);
  });

  it("deliveryMode is direct", () => {
    expect(wechatKfOutbound.deliveryMode).toBe("direct");
  });

  it.todo("sendMedia converts accompanying text with formatText", () => {
    // Requires mocking resolveAccount, uploadMedia, sendTextMessage, readFile, etc.
    // The implementation calls formatText(text) before passing to sendTextMessage,
    // which converts markdown to Unicode styled text for the accompanying caption.
  });
});
