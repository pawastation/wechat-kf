import { homedir } from "node:os";

/** Channel identifier — single source of truth for the plugin ID string. */
export const CHANNEL_ID = "wechat-kf" as const;

/** Default webhook path registered on the framework's shared gateway. */
export const DEFAULT_WEBHOOK_PATH = `/${CHANNEL_ID}`;

/** Config key prefix for this channel in OpenClaw config. */
export const CONFIG_KEY = `channels.${CHANNEL_ID}`;

/** Build a log-tag prefix: `[wechat-kf]` or `[wechat-kf:kfId]`. */
export function logTag(kfId?: string): string {
  return kfId ? `[${CHANNEL_ID}:${kfId}]` : `[${CHANNEL_ID}]`;
}

/** Default state directory for cursor and kfid persistence. */
export function defaultStateDir(): string {
  return `${homedir()}/.openclaw/state/${CHANNEL_ID}`;
}

/** Cursor file name for a given kfId. */
export function cursorFileName(kfId: string): string {
  return `${CHANNEL_ID}-cursor-${kfId}.txt`;
}

/** Persisted file name for discovered kfids. */
export const KFIDS_FILE = `${CHANNEL_ID}-kfids.json`;

/** Persisted file name for disabled kfids. */
export const DISABLED_KFIDS_FILE = `${CHANNEL_ID}-disabled-kfids.json`;

/** WeChat KF text message byte limit (API enforces 2048 UTF-8 bytes) */
export const WECHAT_TEXT_CHUNK_LIMIT = 2048;

/** Safety margin subtracted from WECHAT_TEXT_CHUNK_LIMIT for chunking */
export const WECHAT_TEXT_CHUNK_BYTE_SAFETY_MARGIN = 48;

/** Timeout for token fetch requests (ms) */
export const TOKEN_FETCH_TIMEOUT_MS = 15_000;

/** Timeout for API POST requests (ms) */
export const API_POST_TIMEOUT_MS = 30_000;

/** Timeout for media download/upload requests (ms) */
export const MEDIA_TIMEOUT_MS = 60_000;

/** WeChat errcode values that indicate an expired or invalid access token */
export const TOKEN_EXPIRED_CODES = new Set([40014, 42001, 40001]);

/**
 * WeChat KF errcode indicating the 48-hour / 5-message session limit has
 * been exceeded. When a customer service session is inactive for 48 hours,
 * or the agent has already sent 5 messages without a customer reply, the
 * API returns this error.
 */
export const WECHAT_MSG_LIMIT_ERRCODE = 95026;

/** Timeout for downloading media from external HTTP URLs (ms) */
export const MEDIA_DOWNLOAD_TIMEOUT_MS = 60_000;

/** Max age (seconds) for inbound messages. Messages older than this are skipped. */
export const MAX_MESSAGE_AGE_S = 300; // 5 minutes

/** Format an unknown caught value for log messages (no stack traces). */
export function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
