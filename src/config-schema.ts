/**
 * JSON Schema for wechat-kf channel config
 *
 * Authoritative source: openclaw.plugin.json → configSchema.
 * This runtime copy must stay in sync with the manifest.
 *
 * Flat enterprise-level credentials. No per-account config needed —
 * kfids are discovered dynamically from webhook callbacks.
 */

import { DEFAULT_WEBHOOK_PATH } from "./constants.js";

export const wechatKfConfigSchema = {
  type: "object" as const,
  properties: {
    enabled: { type: "boolean" as const },
    corpId: { type: "string" as const, description: "WeCom Corp ID (企业ID)" },
    appSecret: { type: "string" as const, description: "Self-built app secret (应用密钥)" },
    token: { type: "string" as const, description: "Webhook callback token" },
    encodingAESKey: {
      type: "string" as const,
      description: "43-character base64 AES key",
      minLength: 43,
      maxLength: 43,
    },
    webhookPath: { type: "string" as const, default: DEFAULT_WEBHOOK_PATH },
    dmPolicy: {
      type: "string" as const,
      enum: ["open", "pairing", "allowlist", "disabled"] as const,
      default: "open",
    },
    allowFrom: { type: "array" as const, items: { type: "string" as const } },
    debounceMs: {
      type: "number" as const,
      description: "Inbound message debounce window in milliseconds (0 = disabled)",
      minimum: 0,
      maximum: 10000,
    },
  },
};
