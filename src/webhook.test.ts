import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeSignature, encrypt } from "./crypto.js";
import { _reset as resetMonitor, type SharedContext, setSharedContext } from "./monitor.js";
import { handleWechatKfWebhook, parseQuery, readBody, xmlTag } from "./webhook.js";

// ── Mock dependencies ──

const mockRegisterKfId = vi.fn().mockResolvedValue(undefined);
vi.mock("./accounts.js", async (importOriginal) => {
  const mod = (await importOriginal()) as Record<string, unknown>;
  return {
    ...mod,
    registerKfId: (...args: unknown[]) => mockRegisterKfId(...args),
  };
});

const mockHandleWebhookEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("./bot.js", () => ({
  handleWebhookEvent: (...args: unknown[]) => mockHandleWebhookEvent(...args),
}));

// ── Test constants ──

const CALLBACK_TOKEN = "test_token";
const ENCODING_AES_KEY = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
const CORP_ID = "wx1234567890";
const WEBHOOK_PATH = "/wechat-kf";

// ── Helpers ──

function makeSharedCtx(overrides: Partial<SharedContext> = {}): SharedContext {
  return {
    callbackToken: CALLBACK_TOKEN,
    encodingAESKey: ENCODING_AES_KEY,
    corpId: CORP_ID,
    appSecret: "secret",
    webhookPath: WEBHOOK_PATH,
    botCtx: { cfg: {}, stateDir: "/tmp/test", log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } },
    ...overrides,
  };
}

type MockReqOpts = {
  method?: string;
  url?: string;
  body?: string;
};

function createMockReq(opts: MockReqOpts = {}): import("node:http").IncomingMessage {
  const readable = new Readable({
    read() {
      if (opts.body !== undefined) {
        this.push(Buffer.from(opts.body));
      }
      this.push(null);
    },
  });
  (readable as any).method = opts.method ?? "GET";
  (readable as any).url = opts.url ?? "/";
  (readable as any).headers = {};
  return readable as unknown as import("node:http").IncomingMessage;
}

function createMockRes(): import("node:http").ServerResponse & {
  _statusCode: number;
  _headers: Record<string, string>;
  _body: string;
  _headersSent: boolean;
} {
  let body = "";
  let statusCode = 200;
  const headers: Record<string, string> = {};
  let headersSent = false;

  const res = {
    writeHead(code: number, hdrs?: Record<string, string>) {
      statusCode = code;
      headersSent = true;
      if (hdrs) Object.assign(headers, hdrs);
      return res;
    },
    end(data?: string) {
      if (data) body += data;
      headersSent = true;
      return res;
    },
    get headersSent() {
      return headersSent;
    },
    get _statusCode() {
      return statusCode;
    },
    get _headers() {
      return headers;
    },
    get _body() {
      return body;
    },
    get _headersSent() {
      return headersSent;
    },
  };

  return res as any;
}

// ── Unit tests for helpers ──

describe("parseQuery", () => {
  it("parses query string parameters", () => {
    expect(parseQuery("/path?a=1&b=2")).toEqual({ a: "1", b: "2" });
  });

  it("returns empty object for no query string", () => {
    expect(parseQuery("/path")).toEqual({});
  });

  it("decodes URI components", () => {
    expect(parseQuery("/path?msg=hello%20world")).toEqual({ msg: "hello world" });
  });
});

describe("xmlTag", () => {
  it("extracts CDATA content", () => {
    expect(xmlTag("<xml><Token><![CDATA[abc]]></Token></xml>", "Token")).toBe("abc");
  });

  it("extracts plain content", () => {
    expect(xmlTag("<xml><Token>abc</Token></xml>", "Token")).toBe("abc");
  });

  it("returns undefined for missing tag", () => {
    expect(xmlTag("<xml></xml>", "Token")).toBeUndefined();
  });
});

describe("readBody", () => {
  it("reads body content", async () => {
    const req = createMockReq({ body: "hello" });
    const result = await readBody(req);
    expect(result).toBe("hello");
  });

  it("rejects when body exceeds max size", async () => {
    const bigBody = "X".repeat(65 * 1024);
    const req = createMockReq({ body: bigBody });
    await expect(readBody(req)).rejects.toThrow("body too large");
  });
});

// ── Handler tests ──

describe("handleWechatKfWebhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetMonitor();
  });

  it("returns false when shared context is not set", async () => {
    const req = createMockReq({ url: WEBHOOK_PATH });
    const res = createMockRes();
    const handled = await handleWechatKfWebhook(req, res);
    expect(handled).toBe(false);
  });

  it("returns false when path does not match", async () => {
    setSharedContext(makeSharedCtx());
    const req = createMockReq({ url: "/other-path" });
    const res = createMockRes();
    const handled = await handleWechatKfWebhook(req, res);
    expect(handled).toBe(false);
  });

  // ── GET: URL verification ──

  it("GET: returns 400 for missing verification params", async () => {
    setSharedContext(makeSharedCtx());
    const req = createMockReq({ method: "GET", url: `${WEBHOOK_PATH}?msg_signature=abc` });
    const res = createMockRes();

    const handled = await handleWechatKfWebhook(req, res);
    expect(handled).toBe(true);
    expect(res._statusCode).toBe(400);
    expect(res._body).toBe("missing params");
  });

  it("GET: returns 403 for invalid signature and logs warning", async () => {
    const logWarn = vi.fn();
    setSharedContext(
      makeSharedCtx({
        botCtx: { cfg: {}, stateDir: "/tmp/test", log: { info: vi.fn(), error: vi.fn(), warn: logWarn } },
      }),
    );
    const req = createMockReq({
      method: "GET",
      url: `${WEBHOOK_PATH}?msg_signature=bad&timestamp=123&nonce=456&echostr=abc`,
    });
    const res = createMockRes();

    const handled = await handleWechatKfWebhook(req, res);
    expect(handled).toBe(true);
    expect(res._statusCode).toBe(403);
    expect(res._body).toBe("signature mismatch");
    expect(logWarn).toHaveBeenCalledWith(expect.stringContaining("signature verification failed (GET)"));
  });

  it("GET: decrypts echostr and responds with plaintext on valid signature", async () => {
    setSharedContext(makeSharedCtx());

    const echoMessage = "test_echostr_content";
    const echostr = encrypt(ENCODING_AES_KEY, echoMessage, CORP_ID);
    const timestamp = "1234567890";
    const nonce = "nonce123";
    const sig = computeSignature(CALLBACK_TOKEN, timestamp, nonce, echostr);

    const req = createMockReq({
      method: "GET",
      url: `${WEBHOOK_PATH}?msg_signature=${encodeURIComponent(sig)}&timestamp=${timestamp}&nonce=${nonce}&echostr=${encodeURIComponent(echostr)}`,
    });
    const res = createMockRes();

    const handled = await handleWechatKfWebhook(req, res);
    expect(handled).toBe(true);
    expect(res._statusCode).toBe(200);
    expect(res._body).toBe(echoMessage);
  });

  // ── POST: Event notification ──

  it("POST: returns 400 for missing signature params", async () => {
    setSharedContext(makeSharedCtx());
    const body = "<xml><Encrypt><![CDATA[abc]]></Encrypt></xml>";
    const req = createMockReq({ method: "POST", url: WEBHOOK_PATH, body });
    const res = createMockRes();

    const handled = await handleWechatKfWebhook(req, res);
    expect(handled).toBe(true);
    expect(res._statusCode).toBe(400);
    expect(res._body).toBe("bad request");
  });

  it("POST: returns 403 for invalid signature and logs warning", async () => {
    const logWarn = vi.fn();
    setSharedContext(
      makeSharedCtx({
        botCtx: { cfg: {}, stateDir: "/tmp/test", log: { info: vi.fn(), error: vi.fn(), warn: logWarn } },
      }),
    );
    const encryptedMsg = encrypt(ENCODING_AES_KEY, "<xml>test</xml>", CORP_ID);
    const body = `<xml><Encrypt><![CDATA[${encryptedMsg}]]></Encrypt></xml>`;
    const req = createMockReq({
      method: "POST",
      url: `${WEBHOOK_PATH}?msg_signature=bad&timestamp=123&nonce=456`,
      body,
    });
    const res = createMockRes();

    const handled = await handleWechatKfWebhook(req, res);
    expect(handled).toBe(true);
    expect(res._statusCode).toBe(403);
    expect(res._body).toBe("signature mismatch");
    expect(logWarn).toHaveBeenCalledWith(expect.stringContaining("signature verification failed (POST)"));
  });

  it("POST: processes valid event, responds 200, fires async handler", async () => {
    setSharedContext(makeSharedCtx());

    const xmlPayload = `<xml><Token><![CDATA[sync_token]]></Token><OpenKfId><![CDATA[kf_001]]></OpenKfId></xml>`;
    const encryptedMsg = encrypt(ENCODING_AES_KEY, xmlPayload, CORP_ID);
    const timestamp = "1234567890";
    const nonce = "nonce123";
    const sig = computeSignature(CALLBACK_TOKEN, timestamp, nonce, encryptedMsg);

    const body = `<xml><Encrypt><![CDATA[${encryptedMsg}]]></Encrypt></xml>`;
    const req = createMockReq({
      method: "POST",
      url: `${WEBHOOK_PATH}?msg_signature=${sig}&timestamp=${timestamp}&nonce=${nonce}`,
      body,
    });
    const res = createMockRes();

    const handled = await handleWechatKfWebhook(req, res);
    expect(handled).toBe(true);
    expect(res._statusCode).toBe(200);
    expect(res._body).toBe("success");

    // Wait for async fire-and-forget to complete
    await new Promise((r) => setTimeout(r, 50));

    expect(mockRegisterKfId).toHaveBeenCalledWith("kf_001");
    expect(mockHandleWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ stateDir: "/tmp/test" }),
      "kf_001",
      "sync_token",
    );
  });

  it("POST: logs error when async handler throws", async () => {
    const logError = vi.fn();
    setSharedContext(
      makeSharedCtx({
        botCtx: { cfg: {}, stateDir: "/tmp/test", log: { info: vi.fn(), error: logError, warn: vi.fn() } },
      }),
    );

    mockHandleWebhookEvent.mockRejectedValueOnce(new Error("boom"));

    const xmlPayload = `<xml><Token><![CDATA[sync_token]]></Token><OpenKfId><![CDATA[kf_001]]></OpenKfId></xml>`;
    const encryptedMsg = encrypt(ENCODING_AES_KEY, xmlPayload, CORP_ID);
    const timestamp = "1234567890";
    const nonce = "nonce123";
    const sig = computeSignature(CALLBACK_TOKEN, timestamp, nonce, encryptedMsg);

    const body = `<xml><Encrypt><![CDATA[${encryptedMsg}]]></Encrypt></xml>`;
    const req = createMockReq({
      method: "POST",
      url: `${WEBHOOK_PATH}?msg_signature=${sig}&timestamp=${timestamp}&nonce=${nonce}`,
      body,
    });
    const res = createMockRes();

    const handled = await handleWechatKfWebhook(req, res);
    expect(handled).toBe(true);
    expect(res._statusCode).toBe(200);

    await new Promise((r) => setTimeout(r, 50));
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("webhook event processing error"));
  });

  // ── Method validation ──

  it("returns 405 for unsupported HTTP methods", async () => {
    setSharedContext(makeSharedCtx());
    const req = createMockReq({ method: "PUT", url: WEBHOOK_PATH });
    const res = createMockRes();

    const handled = await handleWechatKfWebhook(req, res);
    expect(handled).toBe(true);
    expect(res._statusCode).toBe(405);
    expect(res._body).toBe("method not allowed");
  });

  it("returns 405 for DELETE method", async () => {
    setSharedContext(makeSharedCtx());
    const req = createMockReq({ method: "DELETE", url: WEBHOOK_PATH });
    const res = createMockRes();

    const handled = await handleWechatKfWebhook(req, res);
    expect(handled).toBe(true);
    expect(res._statusCode).toBe(405);
  });

  // ── Body size limit ──

  it("returns 413 for oversized POST body", async () => {
    setSharedContext(makeSharedCtx());
    const oversizedBody = "X".repeat(65 * 1024);
    const req = createMockReq({
      method: "POST",
      url: `${WEBHOOK_PATH}?msg_signature=abc&timestamp=123&nonce=456`,
      body: oversizedBody,
    });
    const res = createMockRes();

    const handled = await handleWechatKfWebhook(req, res);
    expect(handled).toBe(true);
    expect(res._statusCode).toBe(413);
    expect(res._body).toBe("payload too large");
  });

  // ── Decrypt error → 500 ──

  it("returns 500 when decrypt fails with valid signature", async () => {
    setSharedContext(makeSharedCtx());

    const badEncrypted = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const timestamp = "1234567890";
    const nonce = "nonce123";
    const sig = computeSignature(CALLBACK_TOKEN, timestamp, nonce, badEncrypted);

    const body = `<xml><Encrypt><![CDATA[${badEncrypted}]]></Encrypt></xml>`;
    const req = createMockReq({
      method: "POST",
      url: `${WEBHOOK_PATH}?msg_signature=${sig}&timestamp=${timestamp}&nonce=${nonce}`,
      body,
    });
    const res = createMockRes();

    const handled = await handleWechatKfWebhook(req, res);
    expect(handled).toBe(true);
    expect(res._statusCode).toBe(500);
    expect(res._body).toBe("internal error");
  });
});
