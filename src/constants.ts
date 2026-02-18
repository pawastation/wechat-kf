/** WeChat KF text message character limit */
export const WECHAT_TEXT_CHUNK_LIMIT = 2000;

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
