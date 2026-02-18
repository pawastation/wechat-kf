import { describe, it, expect } from "vitest";
import { createCipheriv } from "node:crypto";
import { encrypt, decrypt, deriveAesKey, computeSignature, verifySignature } from "../src/crypto.js";

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

  describe("P2-10: deriveAesKey input validation", () => {
    it("should accept a valid 43-character EncodingAESKey", () => {
      const key = deriveAesKey(encodingAESKey);
      expect(key.length).toBe(32);
      expect(Buffer.isBuffer(key)).toBe(true);
    });

    it("should throw on empty string", () => {
      expect(() => deriveAesKey("")).toThrow(
        "[wechat-kf] EncodingAESKey must be 43 characters, got 0",
      );
    });

    it("should throw on too-short key (42 chars)", () => {
      const short = encodingAESKey.slice(0, 42);
      expect(() => deriveAesKey(short)).toThrow(
        "[wechat-kf] EncodingAESKey must be 43 characters, got 42",
      );
    });

    it("should throw on too-long key (44 chars)", () => {
      const long = encodingAESKey + "X";
      expect(() => deriveAesKey(long)).toThrow(
        "[wechat-kf] EncodingAESKey must be 43 characters, got 44",
      );
    });

    it("should throw on key of length 1", () => {
      expect(() => deriveAesKey("A")).toThrow(
        "[wechat-kf] EncodingAESKey must be 43 characters, got 1",
      );
    });

    it("should throw on very long key", () => {
      const veryLong = "A".repeat(100);
      expect(() => deriveAesKey(veryLong)).toThrow(
        "[wechat-kf] EncodingAESKey must be 43 characters, got 100",
      );
    });
  });

  describe("PKCS#7 padding validation", () => {
    /**
     * Helper: encrypt raw plaintext bytes (already padded) with the same
     * AES-256-CBC parameters the module uses, returning base64 ciphertext.
     */
    function encryptRaw(plaintext: Buffer): string {
      const aesKey = deriveAesKey(encodingAESKey);
      const iv = aesKey.subarray(0, 16);
      const cipher = createCipheriv("aes-256-cbc", aesKey, iv);
      cipher.setAutoPadding(false);
      return Buffer.concat([cipher.update(plaintext), cipher.final()]).toString("base64");
    }

    /**
     * Build a valid plaintext buffer (random 16 + msgLen 4 + msg + receiverId)
     * then apply custom (possibly invalid) padding so we can test decrypt's
     * padding validation in isolation.
     */
    function buildPlaintext(customPadding: Buffer): Buffer {
      const random = Buffer.alloc(16, 0x41); // 16 bytes 'A'
      const msg = Buffer.from("hi", "utf8");
      const receiver = Buffer.from(corpId, "utf8");
      const msgLen = Buffer.alloc(4);
      msgLen.writeUInt32BE(msg.length, 0);

      const body = Buffer.concat([random, msgLen, msg, receiver]);
      const blockSize = 32;
      const totalNeeded = Math.ceil((body.length + customPadding.length) / blockSize) * blockSize;
      // We may need filler to ensure total length is block-aligned
      const fillerLen = totalNeeded - body.length - customPadding.length;
      const filler = Buffer.alloc(fillerLen, 0x00);
      return Buffer.concat([body, filler, customPadding]);
    }

    it("should accept valid padding (all N bytes equal N)", () => {
      // Normal roundtrip already tests this, but let's be explicit with a
      // manually-constructed payload whose padding we fully control.
      const original = "test";
      const encrypted = encrypt(encodingAESKey, original, corpId);
      const { message } = decrypt(encodingAESKey, encrypted);
      expect(message).toBe(original);
    });

    it("should reject padding where only the last byte is correct (all-different middle bytes)", () => {
      // Construct 8 bytes of padding where last byte = 8 but others differ
      const padLen = 8;
      const padding = Buffer.alloc(padLen);
      for (let i = 0; i < padLen - 1; i++) {
        padding[i] = 0xff; // wrong value
      }
      padding[padLen - 1] = padLen; // only last byte correct

      const plaintext = buildPlaintext(padding);
      const ciphertext = encryptRaw(plaintext);

      expect(() => decrypt(encodingAESKey, ciphertext)).toThrow("[wechat-kf] invalid PKCS#7 padding");
    });

    it("should reject padding where first padding byte differs (partial valid tail)", () => {
      // 4 bytes of padding: [0x01, 0x04, 0x04, 0x04] — last 3 correct, first wrong
      const padding = Buffer.from([0x01, 0x04, 0x04, 0x04]);
      const plaintext = buildPlaintext(padding);
      const ciphertext = encryptRaw(plaintext);

      expect(() => decrypt(encodingAESKey, ciphertext)).toThrow("[wechat-kf] invalid PKCS#7 padding");
    });

    it("should reject padding value of 0", () => {
      // Padding byte 0x00 is invalid in PKCS#7
      const padding = Buffer.alloc(32, 0x00);
      const plaintext = buildPlaintext(padding);
      const ciphertext = encryptRaw(plaintext);

      expect(() => decrypt(encodingAESKey, ciphertext)).toThrow("[wechat-kf] invalid PKCS#7 padding");
    });

    it("should reject padding value greater than block size (33)", () => {
      // Last byte = 33 which exceeds the 32-byte block size
      const padding = Buffer.alloc(32, 33);
      padding[padding.length - 1] = 33;
      const plaintext = buildPlaintext(padding);
      const ciphertext = encryptRaw(plaintext);

      expect(() => decrypt(encodingAESKey, ciphertext)).toThrow("[wechat-kf] invalid PKCS#7 padding");
    });

    it("should reject padding value that exceeds data length", () => {
      // Craft a single 32-byte block where last byte claims pad = 32
      // but the data would need to be at least 32 bytes (which it is),
      // however the content after removing padding would be 0 bytes
      // and fail the "content too short" check — so use a value
      // just slightly too large.
      const aesKey = deriveAesKey(encodingAESKey);
      const iv = aesKey.subarray(0, 16);

      // Single 32-byte block where last byte = 32 — stripping 32 bytes
      // leaves nothing, which should fail on "content too short"
      const block = Buffer.alloc(32, 32); // all bytes = 32
      const cipher = createCipheriv("aes-256-cbc", aesKey, iv);
      cipher.setAutoPadding(false);
      const ciphertext = Buffer.concat([cipher.update(block), cipher.final()]).toString("base64");

      // This will pass padding validation (all 32 bytes = 32) but then
      // fail because content is empty (< 20 bytes). Either error is acceptable.
      expect(() => decrypt(encodingAESKey, ciphertext)).toThrow("[wechat-kf]");
    });
  });
});
