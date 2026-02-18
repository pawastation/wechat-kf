import { describe, it, expect } from "vitest";
import { encrypt, decrypt, computeSignature, verifySignature } from "../src/crypto.js";

// Use a valid 43-char base64 EncodingAESKey (standard for WeChat)
const encodingAESKey = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
const corpId = "wx1234567890";

describe("crypto", () => {
  describe("encrypt / decrypt roundtrip", () => {
    it("should encrypt and decrypt a simple message", () => {
      const original = "Hello, 微信客服!";
      const encrypted = encrypt(encodingAESKey, original, corpId);
      expect(typeof encrypted).toBe("string");
      expect(encrypted.length).toBeGreaterThan(0);

      const { message, receiverId } = decrypt(encodingAESKey, encrypted);
      expect(message).toBe(original);
      expect(receiverId).toBe(corpId);
    });

    it("should handle empty message", () => {
      const encrypted = encrypt(encodingAESKey, "", corpId);
      const { message, receiverId } = decrypt(encodingAESKey, encrypted);
      expect(message).toBe("");
      expect(receiverId).toBe(corpId);
    });

    it("should handle long message", () => {
      const original = "这是一条很长的消息。".repeat(200);
      const encrypted = encrypt(encodingAESKey, original, corpId);
      const { message, receiverId } = decrypt(encodingAESKey, encrypted);
      expect(message).toBe(original);
      expect(receiverId).toBe(corpId);
    });

    it("should handle XML message", () => {
      const xml = `<xml><ToUserName><![CDATA[ww1234]]></ToUserName><MsgType><![CDATA[event]]></MsgType></xml>`;
      const encrypted = encrypt(encodingAESKey, xml, corpId);
      const { message } = decrypt(encodingAESKey, encrypted);
      expect(message).toBe(xml);
    });
  });

  describe("signature", () => {
    it("should compute deterministic signature", () => {
      const sig1 = computeSignature("mytoken", "1234567890", "nonce123", "encrypted_data");
      const sig2 = computeSignature("mytoken", "1234567890", "nonce123", "encrypted_data");
      expect(sig1).toBe(sig2);
      expect(sig1).toMatch(/^[a-f0-9]{40}$/); // SHA1 hex
    });

    it("should verify correct signature", () => {
      const sig = computeSignature("token", "ts", "nc", "enc");
      expect(verifySignature("token", "ts", "nc", "enc", sig)).toBe(true);
    });

    it("should reject wrong signature", () => {
      expect(verifySignature("token", "ts", "nc", "enc", "wrong")).toBe(false);
    });

    it("should sort parameters before hashing", async () => {
      const sig = computeSignature("d", "a", "c", "b");
      const { createHash } = await import("node:crypto");
      const expected = createHash("sha1").update("abcd").digest("hex");
      expect(sig).toBe(expected);
    });

    it("should reject signature with different length via timing-safe compare", () => {
      expect(verifySignature("token", "ts", "nc", "enc", "a")).toBe(false);
      expect(verifySignature("token", "ts", "nc", "enc", "")).toBe(false);
    });
  });

  describe("decrypt error handling", () => {
    it("should throw on corrupted base64 data", () => {
      expect(() => decrypt(encodingAESKey, "not_valid_base64!!!")).toThrow();
    });

    it("should throw on truncated encrypted data", () => {
      // A valid base64 string but too short to contain a real message
      expect(() => decrypt(encodingAESKey, "AAAA")).toThrow();
    });

    it("should handle unicode/emoji in message", () => {
      const original = "Hello 世界 🌍 مرحبا 🎉";
      const encrypted = encrypt(encodingAESKey, original, corpId);
      const { message } = decrypt(encodingAESKey, encrypted);
      expect(message).toBe(original);
    });
  });
});
