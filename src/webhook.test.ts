import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { computeSignature, encrypt } from "./crypto.js";
import { createWebhookServer, type WebhookOptions } from "./webhook.js";

// ── Test constants ──

const CALLBACK_TOKEN = "test_token";
const ENCODING_AES_KEY = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
const CORP_ID = "wx1234567890";
const PATH = "/wechat-kf";

// ── Helpers ──

function makeOpts(overrides: Partial<WebhookOptions> = {}): WebhookOptions {
  return {
    port: 0,
    path: PATH,
    callbackToken: CALLBACK_TOKEN,
    encodingAESKey: ENCODING_AES_KEY,
    corpId: CORP_ID,
    onEvent: vi.fn(),
    log: { info: vi.fn(), error: vi.fn() },
    ...overrides,
  };
}

/** Start the webhook server on a random port and return { server, port } */
function listen(opts: WebhookOptions): Promise<{ server: http.Server; port: number }> {
  const server = createWebhookServer(opts);
  return new Promise((resolve, reject) => {
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, port });
    });
    server.once("error", reject);
  });
}

/** Simple HTTP request helper */
function request(opts: {
  port: number;
  method: string;
  path: string;
  body?: string;
  headers?: Record<string, string>;
}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: opts.port,
        method: opts.method,
        path: opts.path,
        headers: opts.headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

// ── Tests ──

describe("webhook server hardening", () => {
  let server: http.Server | null = null;

  afterEach(() => {
    if (server) {
      server.close();
      server = null;
    }
  });

  // ── Method validation ──

  it("should return 405 for unsupported HTTP methods", async () => {
    const opts = makeOpts();
    const ctx = await listen(opts);
    server = ctx.server;

    const res = await request({
      port: ctx.port,
      method: "PUT",
      path: PATH,
    });

    expect(res.status).toBe(405);
    expect(res.body).toBe("method not allowed");
  });

  it("should return 405 for DELETE method", async () => {
    const opts = makeOpts();
    const ctx = await listen(opts);
    server = ctx.server;

    const res = await request({
      port: ctx.port,
      method: "DELETE",
      path: PATH,
    });

    expect(res.status).toBe(405);
    expect(res.body).toBe("method not allowed");
  });

  // ── Path validation ──

  it("should return 404 for unknown paths", async () => {
    const opts = makeOpts();
    const ctx = await listen(opts);
    server = ctx.server;

    const res = await request({
      port: ctx.port,
      method: "GET",
      path: "/unknown",
    });

    expect(res.status).toBe(404);
    expect(res.body).toBe("not found");
  });

  // ── Body size limit ──

  it("should return 413 for oversized POST body", async () => {
    const opts = makeOpts();
    const ctx = await listen(opts);
    server = ctx.server;

    // 65KB body exceeds the 64KB limit
    const oversizedBody = "X".repeat(65 * 1024);

    const res = await request({
      port: ctx.port,
      method: "POST",
      path: `${PATH}?msg_signature=abc&timestamp=123&nonce=456`,
      body: oversizedBody,
    });

    expect(res.status).toBe(413);
    expect(res.body).toBe("payload too large");
  });

  it("should accept a body just under the size limit", async () => {
    const opts = makeOpts();
    const ctx = await listen(opts);
    server = ctx.server;

    // Body under 64KB — will fail on "bad request" (no valid XML) but NOT on size
    const body = "X".repeat(63 * 1024);

    const res = await request({
      port: ctx.port,
      method: "POST",
      path: `${PATH}?msg_signature=abc&timestamp=123&nonce=456`,
      body,
    });

    // Should get 400 (bad request — no Encrypt tag), NOT 413
    expect(res.status).toBe(400);
    expect(res.body).toBe("bad request");
  });

  // ── GET missing params ──

  it("should return 400 for GET with missing verification params", async () => {
    const opts = makeOpts();
    const ctx = await listen(opts);
    server = ctx.server;

    const res = await request({
      port: ctx.port,
      method: "GET",
      path: `${PATH}?msg_signature=abc`,
    });

    expect(res.status).toBe(400);
    expect(res.body).toBe("missing params");
  });

  // ── GET signature mismatch ──

  it("should return 403 for GET with invalid signature", async () => {
    const opts = makeOpts();
    const ctx = await listen(opts);
    server = ctx.server;

    const res = await request({
      port: ctx.port,
      method: "GET",
      path: `${PATH}?msg_signature=bad&timestamp=123&nonce=456&echostr=abc`,
    });

    expect(res.status).toBe(403);
    expect(res.body).toBe("signature mismatch");
  });

  // ── POST missing params ──

  it("should return 400 for POST with missing signature params", async () => {
    const opts = makeOpts();
    const ctx = await listen(opts);
    server = ctx.server;

    const body = "<xml><Encrypt><![CDATA[abc]]></Encrypt></xml>";

    const res = await request({
      port: ctx.port,
      method: "POST",
      path: PATH, // no query params
      body,
    });

    expect(res.status).toBe(400);
    expect(res.body).toBe("bad request");
  });

  // ── POST signature mismatch ──

  it("should return 403 for POST with invalid signature", async () => {
    const opts = makeOpts();
    const ctx = await listen(opts);
    server = ctx.server;

    const encryptedMsg = encrypt(ENCODING_AES_KEY, "<xml>test</xml>", CORP_ID);
    const body = `<xml><Encrypt><![CDATA[${encryptedMsg}]]></Encrypt></xml>`;

    const res = await request({
      port: ctx.port,
      method: "POST",
      path: `${PATH}?msg_signature=bad&timestamp=123&nonce=456`,
      body,
    });

    expect(res.status).toBe(403);
    expect(res.body).toBe("signature mismatch");
  });

  // ── Structured logging ──

  it("should use log.error instead of console.error for onEvent errors", async () => {
    const logError = vi.fn();
    const onEvent = vi.fn().mockRejectedValue(new Error("boom"));

    const opts = makeOpts({
      onEvent,
      log: { info: vi.fn(), error: logError },
    });
    const ctx = await listen(opts);
    server = ctx.server;

    // Build a valid POST request
    const xmlPayload = `<xml><Token><![CDATA[sync_token]]></Token><OpenKfId><![CDATA[kf_001]]></OpenKfId></xml>`;
    const encryptedMsg = encrypt(ENCODING_AES_KEY, xmlPayload, CORP_ID);
    const timestamp = "1234567890";
    const nonce = "nonce123";
    const sig = computeSignature(CALLBACK_TOKEN, timestamp, nonce, encryptedMsg);

    const body = `<xml><Encrypt><![CDATA[${encryptedMsg}]]></Encrypt></xml>`;

    const res = await request({
      port: ctx.port,
      method: "POST",
      path: `${PATH}?msg_signature=${sig}&timestamp=${timestamp}&nonce=${nonce}`,
      body,
    });

    expect(res.status).toBe(200);
    expect(res.body).toBe("success");

    // Wait for the async onEvent error handling to fire
    await new Promise((r) => setTimeout(r, 50));

    // log.error should have been called with the onEvent error
    expect(logError).toHaveBeenCalledWith("[wechat-kf] onEvent error:", expect.any(Error));
  });

  it("should use log.error for webhook errors in catch block", async () => {
    const logError = vi.fn();

    // Force an error by using an invalid encodingAESKey that will cause decrypt to throw
    const opts = makeOpts({
      log: { info: vi.fn(), error: logError },
    });
    const ctx = await listen(opts);
    server = ctx.server;

    // A valid encrypted msg will fail to decrypt if the key is correct but
    // the signature is valid — let's craft a scenario where the decrypt fails.
    // We'll construct a signature that matches but use bad encrypted data.
    const badEncrypted = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const timestamp = "1234567890";
    const nonce = "nonce123";
    const sig = computeSignature(CALLBACK_TOKEN, timestamp, nonce, badEncrypted);

    const body = `<xml><Encrypt><![CDATA[${badEncrypted}]]></Encrypt></xml>`;

    const res = await request({
      port: ctx.port,
      method: "POST",
      path: `${PATH}?msg_signature=${sig}&timestamp=${timestamp}&nonce=${nonce}`,
      body,
    });

    // decrypt should throw, caught by the outer catch → 500
    expect(res.status).toBe(500);
    expect(res.body).toBe("internal error");

    // log.error should have been called
    expect(logError).toHaveBeenCalledWith("[wechat-kf] webhook error:", expect.any(Error));
  });

  // ── Valid POST flow ──

  it("should process a valid POST and call onEvent", async () => {
    const onEvent = vi.fn().mockResolvedValue(undefined);
    const opts = makeOpts({ onEvent });
    const ctx = await listen(opts);
    server = ctx.server;

    const xmlPayload = `<xml><Token><![CDATA[sync_token]]></Token><OpenKfId><![CDATA[kf_001]]></OpenKfId></xml>`;
    const encryptedMsg = encrypt(ENCODING_AES_KEY, xmlPayload, CORP_ID);
    const timestamp = "1234567890";
    const nonce = "nonce123";
    const sig = computeSignature(CALLBACK_TOKEN, timestamp, nonce, encryptedMsg);

    const body = `<xml><Encrypt><![CDATA[${encryptedMsg}]]></Encrypt></xml>`;

    const res = await request({
      port: ctx.port,
      method: "POST",
      path: `${PATH}?msg_signature=${sig}&timestamp=${timestamp}&nonce=${nonce}`,
      body,
    });

    expect(res.status).toBe(200);
    expect(res.body).toBe("success");

    // Wait for async onEvent
    await new Promise((r) => setTimeout(r, 50));

    expect(onEvent).toHaveBeenCalledWith("kf_001", "sync_token");
  });
});
