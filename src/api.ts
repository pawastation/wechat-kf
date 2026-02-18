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
import { getAccessToken } from "./token.js";

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
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`[wechat-kf] API ${path} HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }
  return (await resp.json()) as T;
}

/** Pull messages from WeChat KF */
export async function syncMessages(
  corpId: string,
  appSecret: string,
  params: WechatKfSyncMsgRequest,
): Promise<WechatKfSyncMsgResponse> {
  const token = await getAccessToken(corpId, appSecret);
  const data = await apiPost<WechatKfSyncMsgResponse>("/kf/sync_msg", token, params);
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
  const token = await getAccessToken(corpId, appSecret);
  const body: WechatKfSendMsgRequest = {
    touser: toUser,
    open_kfid: openKfId,
    msgtype: "text",
    text: { content },
  };
  const data = await apiPost<WechatKfSendMsgResponse>("/kf/send_msg", token, body);
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
  const token = await getAccessToken(corpId, appSecret);
  const resp = await fetch(`${BASE}/media/get?access_token=${token}&media_id=${mediaId}`);
  if (!resp.ok) {
    throw new Error(`[wechat-kf] download media failed: ${resp.status} ${resp.statusText}`);
  }
  return Buffer.from(await resp.arrayBuffer());
}

/** Upload media file to WeChat */
export async function uploadMedia(
  corpId: string,
  appSecret: string,
  type: string,
  buffer: Buffer,
  filename: string,
): Promise<WechatMediaUploadResponse> {
  const token = await getAccessToken(corpId, appSecret);
  const formData = new FormData();
  const mime = MIME_MAP[extname(filename).toLowerCase()] ?? "application/octet-stream";
  const blob = new Blob([new Uint8Array(buffer)], { type: mime });
  formData.append("media", blob, filename);
  
  const resp = await fetch(`${BASE}/media/upload?access_token=${token}&type=${type}`, {
    method: "POST",
    body: formData,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`[wechat-kf] upload media HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }

  const data = await resp.json() as WechatMediaUploadResponse;
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
  const token = await getAccessToken(corpId, appSecret);
  const body: WechatKfSendMsgRequest = {
    touser: toUser,
    open_kfid: openKfId,
    msgtype: "image",
    image: { media_id: mediaId },
  };
  const data = await apiPost<WechatKfSendMsgResponse>("/kf/send_msg", token, body);
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
  const token = await getAccessToken(corpId, appSecret);
  const body: WechatKfSendMsgRequest = {
    touser: toUser,
    open_kfid: openKfId,
    msgtype: "voice",
    voice: { media_id: mediaId },
  };
  const data = await apiPost<WechatKfSendMsgResponse>("/kf/send_msg", token, body);
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
  const token = await getAccessToken(corpId, appSecret);
  const body: WechatKfSendMsgRequest = {
    touser: toUser,
    open_kfid: openKfId,
    msgtype: "video",
    video: { media_id: mediaId },
  };
  const data = await apiPost<WechatKfSendMsgResponse>("/kf/send_msg", token, body);
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
  const token = await getAccessToken(corpId, appSecret);
  const body: WechatKfSendMsgRequest = {
    touser: toUser,
    open_kfid: openKfId,
    msgtype: "file",
    file: { media_id: mediaId },
  };
  const data = await apiPost<WechatKfSendMsgResponse>("/kf/send_msg", token, body);
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
  const token = await getAccessToken(corpId, appSecret);
  const body: WechatKfSendMsgRequest = {
    touser: toUser,
    open_kfid: openKfId,
    msgtype: "link",
    link,
  };
  const data = await apiPost<WechatKfSendMsgResponse>("/kf/send_msg", token, body);
  if (data.errcode !== 0) {
    throw new Error(`[wechat-kf] send link failed: ${data.errcode} ${data.errmsg}`);
  }
  return data;
}