/**
 * access_token 获取和缓存
 */

import type { WechatAccessTokenResponse } from "./types.js";

type CachedToken = {
  token: string;
  expiresAt: number;
};

const cache = new Map<string, CachedToken>();
const pending = new Map<string, Promise<string>>();

const REFRESH_MARGIN_MS = 5 * 60 * 1000; // refresh 5 minutes before expiry

export async function getAccessToken(corpId: string, appSecret: string): Promise<string> {
  const cacheKey = `${corpId}:${appSecret}`;
  const cached = cache.get(cacheKey);

  if (cached && Date.now() < cached.expiresAt - REFRESH_MARGIN_MS) {
    return cached.token;
  }

  // Deduplicate concurrent requests for the same credentials
  const inflight = pending.get(cacheKey);
  if (inflight) return inflight;

  const promise = fetchAccessToken(corpId, appSecret, cacheKey);
  pending.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    pending.delete(cacheKey);
  }
}

async function fetchAccessToken(corpId: string, appSecret: string, cacheKey: string): Promise<string> {
  // WeChat API requires credentials in URL query parameters
  const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(appSecret)}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`[wechat-kf] gettoken HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }
  const data = (await resp.json()) as WechatAccessTokenResponse;

  if (data.errcode !== 0) {
    throw new Error(`[wechat-kf] gettoken failed: ${data.errcode} ${data.errmsg}`);
  }

  cache.set(cacheKey, {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  });

  return data.access_token;
}

/** Clear cached token (e.g. on auth error) */
export function clearAccessToken(corpId: string, appSecret: string): void {
  cache.delete(`${corpId}:${appSecret}`);
}
