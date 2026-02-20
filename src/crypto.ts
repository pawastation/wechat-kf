/**
 * WeCom message encryption/decryption
 *
 * - Signature: SHA1(sort([token, timestamp, nonce, encrypt]))
 * - Encryption: AES-256-CBC, key = Base64Decode(EncodingAESKey + "="), iv = key[0:16]
 * - Plaintext format: random(16B) + msg_len(4B network order) + msg + receiveid
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { logTag } from "./constants.js";

export function deriveAesKey(encodingAESKey: string): Buffer {
  if (encodingAESKey.length !== 43) {
    throw new Error(`${logTag()} EncodingAESKey must be 43 characters, got ${encodingAESKey.length}`);
  }
  const key = Buffer.from(`${encodingAESKey}=`, "base64");
  if (key.length !== 32) {
    throw new Error(`${logTag()} derived AES key must be 32 bytes, got ${key.length}`);
  }
  return key;
}

/** SHA1 signature verification */
export function computeSignature(token: string, timestamp: string, nonce: string, encrypt: string): string {
  const items = [token, timestamp, nonce, encrypt].sort();
  return createHash("sha1").update(items.join("")).digest("hex");
}

export function verifySignature(
  token: string,
  timestamp: string,
  nonce: string,
  encrypt: string,
  expectedSignature: string,
): boolean {
  const actual = Buffer.from(computeSignature(token, timestamp, nonce, encrypt), "utf8");
  const expected = Buffer.from(expectedSignature, "utf8");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/** Decrypt an encrypted message from WeChat callback */
export function decrypt(encodingAESKey: string, encrypted: string): { message: string; receiverId: string } {
  const aesKey = deriveAesKey(encodingAESKey);
  const iv = aesKey.subarray(0, 16);

  const decipher = createDecipheriv("aes-256-cbc", aesKey, iv);
  decipher.setAutoPadding(false);

  const decrypted = Buffer.concat([decipher.update(encrypted, "base64"), decipher.final()]);

  // Remove PKCS#7 padding — validate ALL N padding bytes equal N
  const pad = decrypted[decrypted.length - 1];
  if (pad < 1 || pad > 32 || pad > decrypted.length) {
    throw new Error(`${logTag()} invalid PKCS#7 padding`);
  }
  for (let i = 1; i <= pad; i++) {
    if (decrypted[decrypted.length - i] !== pad) {
      throw new Error(`${logTag()} invalid PKCS#7 padding`);
    }
  }
  const content = decrypted.subarray(0, decrypted.length - pad);

  // Parse: random(16) + msg_len(4, big-endian) + msg + receiverId
  if (content.length < 20) {
    throw new Error(`${logTag()} decrypted content too short`);
  }
  const msgLen = content.readUInt32BE(16);
  if (msgLen < 0 || 20 + msgLen > content.length) {
    throw new Error(`${logTag()} invalid message length in decrypted content`);
  }
  const message = content.subarray(20, 20 + msgLen).toString("utf8");
  const receiverId = content.subarray(20 + msgLen).toString("utf8");

  return { message, receiverId };
}

/** Encrypt a message for WeChat callback response */
export function encrypt(encodingAESKey: string, message: string, receiverId: string): string {
  const aesKey = deriveAesKey(encodingAESKey);
  const iv = aesKey.subarray(0, 16);

  const random = randomBytes(16);
  const msgBuf = Buffer.from(message, "utf8");
  const receiverBuf = Buffer.from(receiverId, "utf8");

  const msgLenBuf = Buffer.alloc(4);
  msgLenBuf.writeUInt32BE(msgBuf.length, 0);

  const plaintext = Buffer.concat([random, msgLenBuf, msgBuf, receiverBuf]);

  // PKCS#7 padding to 32-byte blocks
  const blockSize = 32;
  const padLen = blockSize - (plaintext.length % blockSize);
  const padding = Buffer.alloc(padLen, padLen);
  const padded = Buffer.concat([plaintext, padding]);

  const cipher = createCipheriv("aes-256-cbc", aesKey, iv);
  cipher.setAutoPadding(false);

  return Buffer.concat([cipher.update(padded), cipher.final()]).toString("base64");
}
