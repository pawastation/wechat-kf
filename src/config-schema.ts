/**
 * JSON Schema for wechat-kf channel config
 *
 * Authoritative source: openclaw.plugin.json → configSchema.
 * This runtime copy must stay in sync with the manifest.
 *
 * Flat enterprise-level credentials. No per-account config needed —
 * kfids are discovered dynamically from webhook callbacks.
 */

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
    webhookPath: { type: "string" as const, default: "/wechat-kf" },
    dmPolicy: {
      type: "string" as const,
      enum: ["open", "pairing", "allowlist", "disabled"] as const,
      default: "open",
    },
    allowFrom: { type: "array" as const, items: { type: "string" as const } },
  },
};
