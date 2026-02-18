import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TOKEN_FETCH_TIMEOUT_MS } from "./constants.js";

// ── Isolate module state between tests ──
// token.ts uses module-level Maps for cache/pending, so we need to
// re-import a fresh copy for each describe block via dynamic import.
// We mock global fetch to avoid real HTTP calls.

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

// ── Helpers ──

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function tokenResponse(token: string, expiresIn = 7200) {
  return jsonResponse({
    errcode: 0,
    errmsg: "ok",
    access_token: token,
    expires_in: expiresIn,
  });
}

describe("token: getAccessToken", () => {
  // We reset the module cache between tests to get clean Maps
  let getAccessToken: typeof import("./token.js").getAccessToken;
  let clearAccessToken: typeof import("./token.js").clearAccessToken;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("./token.js");
    getAccessToken = mod.getAccessToken;
    clearAccessToken = mod.clearAccessToken;
  });

  it("fetches a fresh token on first call", async () => {
    globalThis.fetch = vi.fn(async () => tokenResponse("fresh_token_1")) as typeof fetch;

    const token = await getAccessToken("corp1", "secret1");
    expect(token).toBe("fresh_token_1");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    // URL should contain corpid and corpsecret
    const url = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(url).toContain("corpid=corp1");
    expect(url).toContain("corpsecret=secret1");
  });

  it("returns cached token on second call (no fetch)", async () => {
    globalThis.fetch = vi.fn(async () => tokenResponse("cached_token")) as typeof fetch;

    const t1 = await getAccessToken("corp1", "secret1");
    const t2 = await getAccessToken("corp1", "secret1");

    expect(t1).toBe("cached_token");
    expect(t2).toBe("cached_token");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1); // only one fetch
  });

  it("uses separate caches for different credentials", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      return tokenResponse(`token_${callCount}`);
    }) as typeof fetch;

    const t1 = await getAccessToken("corpA", "secretA");
    const t2 = await getAccessToken("corpB", "secretB");

    expect(t1).toBe("token_1");
    expect(t2).toBe("token_2");
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("refreshes token when cache expires (5min margin)", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      return tokenResponse(`token_v${callCount}`, 300); // 300s = 5 min = exactly at margin
    }) as typeof fetch;

    const t1 = await getAccessToken("corp1", "secret1");
    expect(t1).toBe("token_v1");

    // expiresAt = Date.now() + 300*1000, margin = 5*60*1000 = 300_000
    // Date.now() < expiresAt - 300_000 is false (0 < 0), so cache is considered expired
    const t2 = await getAccessToken("corp1", "secret1");
    expect(t2).toBe("token_v2");
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("deduplicates concurrent requests for the same credentials", async () => {
    let resolvePromise: (v: Response) => void;
    globalThis.fetch = vi.fn(
      () => new Promise<Response>((r) => { resolvePromise = r; }),
    ) as typeof fetch;

    // Fire 3 concurrent requests
    const p1 = getAccessToken("corp1", "secret1");
    const p2 = getAccessToken("corp1", "secret1");
    const p3 = getAccessToken("corp1", "secret1");

    // All should be waiting on the same inflight promise
    resolvePromise!(tokenResponse("dedup_token"));

    const [t1, t2, t3] = await Promise.all([p1, p2, p3]);
    expect(t1).toBe("dedup_token");
    expect(t2).toBe("dedup_token");
    expect(t3).toBe("dedup_token");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("clears pending after failure, allowing retry", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return jsonResponse({ errcode: 40013, errmsg: "invalid corpid" });
      }
      return tokenResponse("retry_token");
    }) as typeof fetch;

    // First call fails with business error
    await expect(getAccessToken("corp1", "secret1")).rejects.toThrow("gettoken failed: 40013");

    // Pending should be cleared, so second call issues a new fetch
    const token = await getAccessToken("corp1", "secret1");
    expect(token).toBe("retry_token");
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("throws on HTTP non-200 response", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("Internal Server Error", { status: 500 }),
    ) as typeof fetch;

    await expect(getAccessToken("corp1", "secret1")).rejects.toThrow("gettoken HTTP 500");
  });

  it("throws on errcode non-0 (business error)", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ errcode: 40001, errmsg: "invalid credential", access_token: "", expires_in: 0 }),
    ) as typeof fetch;

    await expect(getAccessToken("corp1", "secret1")).rejects.toThrow("gettoken failed: 40001 invalid credential");
  });

  it("passes AbortSignal.timeout to fetch", async () => {
    const signals: (AbortSignal | undefined)[] = [];
    globalThis.fetch = vi.fn(async (_url: any, init?: any) => {
      signals.push(init?.signal);
      return tokenResponse("sig_token");
    }) as typeof fetch;

    await getAccessToken("corp1", "secret1");
    expect(signals).toHaveLength(1);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
  });
});

describe("token: makeCacheKey", () => {
  let makeCacheKey: typeof import("./token.js").makeCacheKey;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("./token.js");
    makeCacheKey = mod.makeCacheKey;
  });

  it("does not contain the raw appSecret", () => {
    const secret = "my-super-secret-app-key";
    const key = makeCacheKey("corpX", secret);
    expect(key).not.toContain(secret);
  });

  it("includes corpId as a prefix", () => {
    const key = makeCacheKey("corpX", "secretX");
    expect(key.startsWith("corpX:")).toBe(true);
  });

  it("produces different keys for different secrets", () => {
    const k1 = makeCacheKey("corp1", "secretA");
    const k2 = makeCacheKey("corp1", "secretB");
    expect(k1).not.toBe(k2);
  });

  it("produces the same key for the same inputs (deterministic)", () => {
    const k1 = makeCacheKey("corp1", "secret1");
    const k2 = makeCacheKey("corp1", "secret1");
    expect(k1).toBe(k2);
  });
});

describe("token: clearAccessToken", () => {
  let getAccessToken: typeof import("./token.js").getAccessToken;
  let clearAccessToken: typeof import("./token.js").clearAccessToken;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("./token.js");
    getAccessToken = mod.getAccessToken;
    clearAccessToken = mod.clearAccessToken;
  });

  it("forces a fresh fetch after clearing", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      return tokenResponse(`token_v${callCount}`);
    }) as typeof fetch;

    const t1 = await getAccessToken("corp1", "secret1");
    expect(t1).toBe("token_v1");

    clearAccessToken("corp1", "secret1");

    const t2 = await getAccessToken("corp1", "secret1");
    expect(t2).toBe("token_v2");
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("does not affect other credential pairs", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      return tokenResponse(`token_${callCount}`);
    }) as typeof fetch;

    await getAccessToken("corpA", "secretA"); // token_1
    await getAccessToken("corpB", "secretB"); // token_2

    clearAccessToken("corpA", "secretA");

    // corpB should still be cached
    const tB = await getAccessToken("corpB", "secretB");
    expect(tB).toBe("token_2");
    expect(globalThis.fetch).toHaveBeenCalledTimes(2); // no new fetch for corpB

    // corpA needs a new fetch
    const tA = await getAccessToken("corpA", "secretA");
    expect(tA).toBe("token_3");
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });
});
