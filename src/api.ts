/**
 * 企业微信客服 API 封装
 */

import { extname } from "node:path";
import type {
  WechatKfSyncMsgRequest,
  WechatKfSyncMsgResponse,
  WechatKfSendMsgRequest,
  WechatKfSendMsgResponse,
  WechatMediaUploadResponse,
} from "./types.js";
import { getAccessToken, clearAccessToken } from "./token.js";
import {
  API_POST_TIMEOUT_MS,
  MEDIA_TIMEOUT_MS,
  TOKEN_EXPIRED_CODES,
} from "./constants.js";

const MIME_MAP: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".gif": "image/gif", ".bmp": "image/bmp", ".webp": "image/webp",
  ".amr": "audio/amr", ".mp3": "audio/mpeg", ".wav": "audio/wav",
  ".ogg": "audio/ogg", ".silk": "audio/silk", ".m4a": "audio/mp4", ".aac": "audio/aac",
  ".mp4": "video/mp4", ".avi": "video/x-msvideo", ".mov": "video/quicktime",
};

const BASE = "https://qyapi.weixin.qq.com/cgi-bin";

async function apiPost<T>(path: string, token: string, body: unknown): Promise<T> {
  const resp = await fetch(`${BASE}${path}?access_token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(API_POST_TIMEOUT_MS),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`[wechat-kf] API ${path} HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }
  return (await resp.json()) as T;
}

/**
 * Call apiPost with automatic token refresh on token-expired errors.
 * Detects errcode 40014/42001/40001, clears the cached token, fetches a
 * new one and retries exactly once.
 */
async function apiPostWithTokenRetry<T>(
  path: string,
  corpId: string,
  appSecret: string,
  body: unknown,
): Promise<T> {
  let token = await getAccessToken(corpId, appSecret);
  const data = await apiPost<T>(path, token, body);

  const result = data as Record<string, unknown>;
  if (typeof result.errcode === "number" && TOKEN_EXPIRED_CODES.has(result.errcode)) {
    clearAccessToken(corpId, appSecret);
    token = await getAccessToken(corpId, appSecret);
    return apiPost<T>(path, token, body);
  }
  return data;
}

/** Pull messages from WeChat KF */
export async function syncMessages(
  corpId: string,
  appSecret: string,
  params: WechatKfSyncMsgRequest,
): Promise<WechatKfSyncMsgResponse> {
  const data = await apiPostWithTokenRetry<WechatKfSyncMsgResponse>("/kf/sync_msg", corpId, appSecret, params);
  if (data.errcode !== 0) {
    throw new Error(`[wechat-kf] sync_msg failed: ${data.errcode} ${data.errmsg}`);
  }
  return data;
}

/** Send a text message to a WeChat user */
export async function sendTextMessage(
  corpId: string,
  appSecret: string,
  toUser: string,
  openKfId: string,
  content: string,
): Promise<WechatKfSendMsgResponse> {
  const body: WechatKfSendMsgRequest = {
    touser: toUser,
    open_kfid: openKfId,
    msgtype: "text",
    text: { content },
  };
  const data = await apiPostWithTokenRetry<WechatKfSendMsgResponse>("/kf/send_msg", corpId, appSecret, body);
  if (data.errcode !== 0) {
    throw new Error(`[wechat-kf] send_msg failed: ${data.errcode} ${data.errmsg}`);
  }
  return data;
}

/** Download media file from WeChat */
export async function downloadMedia(
  corpId: string,
  appSecret: string,
  mediaId: string,
): Promise<Buffer> {
  const attemptDownload = async (token: string): Promise<{ buffer: Buffer; errcode?: number; errmsg?: string }> => {
    const resp = await fetch(`${BASE}/media/get?access_token=${token}&media_id=${mediaId}`, {
      signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
    });
    if (!resp.ok) {
      throw new Error(`[wechat-kf] download media failed: ${resp.status} ${resp.statusText}`);
    }
    const contentType = resp.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const data = (await resp.json()) as { errcode: number; errmsg: string };
      return { buffer: Buffer.alloc(0), errcode: data.errcode, errmsg: data.errmsg };
    }
    return { buffer: Buffer.from(await resp.arrayBuffer()) };
  };

  let token = await getAccessToken(corpId, appSecret);
  const result = await attemptDownload(token);

  if (result.errcode !== undefined) {
    // Token-expired error: clear and retry once
    if (TOKEN_EXPIRED_CODES.has(result.errcode)) {
      clearAccessToken(corpId, appSecret);
      token = await getAccessToken(corpId, appSecret);
      const retry = await attemptDownload(token);
      if (retry.errcode !== undefined) {
        throw new Error(`[wechat-kf] download media failed: ${retry.errcode} ${retry.errmsg}`);
      }
      return retry.buffer;
    }
    throw new Error(`[wechat-kf] download media failed: ${result.errcode} ${result.errmsg}`);
  }
  return result.buffer;
}

/** Upload media file to WeChat */
export async function uploadMedia(
  corpId: string,
  appSecret: string,
  type: string,
  buffer: Buffer,
  filename: string,
): Promise<WechatMediaUploadResponse> {
  const doUpload = async (token: string): Promise<WechatMediaUploadResponse> => {
    const formData = new FormData();
    const mime = MIME_MAP[extname(filename).toLowerCase()] ?? "application/octet-stream";
    const blob = new Blob([new Uint8Array(buffer)], { type: mime });
    formData.append("media", blob, filename);

    const resp = await fetch(`${BASE}/media/upload?access_token=${token}&type=${type}`, {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`[wechat-kf] upload media HTTP ${resp.status}: ${text.slice(0, 200)}`);
    }
    return (await resp.json()) as WechatMediaUploadResponse;
  };

  let token = await getAccessToken(corpId, appSecret);
  let data = await doUpload(token);

  if (TOKEN_EXPIRED_CODES.has(data.errcode)) {
    clearAccessToken(corpId, appSecret);
    token = await getAccessToken(corpId, appSecret);
    data = await doUpload(token);
  }

  if (data.errcode !== 0) {
    throw new Error(`[wechat-kf] upload media failed: ${data.errcode} ${data.errmsg}`);
  }
  return data;
}

/** Send an image message to a WeChat user */
export async function sendImageMessage(
  corpId: string,
  appSecret: string,
  toUser: string,
  openKfId: string,
  mediaId: string,
): Promise<WechatKfSendMsgResponse> {
  const body: WechatKfSendMsgRequest = {
    touser: toUser,
    open_kfid: openKfId,
    msgtype: "image",
    image: { media_id: mediaId },
  };
  const data = await apiPostWithTokenRetry<WechatKfSendMsgResponse>("/kf/send_msg", corpId, appSecret, body);
  if (data.errcode !== 0) {
    throw new Error(`[wechat-kf] send image failed: ${data.errcode} ${data.errmsg}`);
  }
  return data;
}

/** Send a voice message to a WeChat user */
export async function sendVoiceMessage(
  corpId: string,
  appSecret: string,
  toUser: string,
  openKfId: string,
  mediaId: string,
): Promise<WechatKfSendMsgResponse> {
  const body: WechatKfSendMsgRequest = {
    touser: toUser,
    open_kfid: openKfId,
    msgtype: "voice",
    voice: { media_id: mediaId },
  };
  const data = await apiPostWithTokenRetry<WechatKfSendMsgResponse>("/kf/send_msg", corpId, appSecret, body);
  if (data.errcode !== 0) {
    throw new Error(`[wechat-kf] send voice failed: ${data.errcode} ${data.errmsg}`);
  }
  return data;
}

/** Send a video message to a WeChat user */
export async function sendVideoMessage(
  corpId: string,
  appSecret: string,
  toUser: string,
  openKfId: string,
  mediaId: string,
): Promise<WechatKfSendMsgResponse> {
  const body: WechatKfSendMsgRequest = {
    touser: toUser,
    open_kfid: openKfId,
    msgtype: "video",
    video: { media_id: mediaId },
  };
  const data = await apiPostWithTokenRetry<WechatKfSendMsgResponse>("/kf/send_msg", corpId, appSecret, body);
  if (data.errcode !== 0) {
    throw new Error(`[wechat-kf] send video failed: ${data.errcode} ${data.errmsg}`);
  }
  return data;
}

/** Send a file message to a WeChat user */
export async function sendFileMessage(
  corpId: string,
  appSecret: string,
  toUser: string,
  openKfId: string,
  mediaId: string,
): Promise<WechatKfSendMsgResponse> {
  const body: WechatKfSendMsgRequest = {
    touser: toUser,
    open_kfid: openKfId,
    msgtype: "file",
    file: { media_id: mediaId },
  };
  const data = await apiPostWithTokenRetry<WechatKfSendMsgResponse>("/kf/send_msg", corpId, appSecret, body);
  if (data.errcode !== 0) {
    throw new Error(`[wechat-kf] send file failed: ${data.errcode} ${data.errmsg}`);
  }
  return data;
}

/** Send a link message to a WeChat user */
export async function sendLinkMessage(
  corpId: string,
  appSecret: string,
  toUser: string,
  openKfId: string,
  link: { title: string; desc?: string; url: string; thumb_media_id: string },
): Promise<WechatKfSendMsgResponse> {
  const body: WechatKfSendMsgRequest = {
    touser: toUser,
    open_kfid: openKfId,
    msgtype: "link",
    link,
  };
  const data = await apiPostWithTokenRetry<WechatKfSendMsgResponse>("/kf/send_msg", corpId, appSecret, body);
  if (data.errcode !== 0) {
    throw new Error(`[wechat-kf] send link failed: ${data.errcode} ${data.errmsg}`);
  }
  return data;
}