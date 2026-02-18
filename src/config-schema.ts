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
  required: ["corpId", "appSecret", "token", "encodingAESKey"] as const,
  additionalProperties: false,
  properties: {
    enabled: { type: "boolean" as const },
    corpId: { type: "string" as const },
    appSecret: { type: "string" as const },
    token: { type: "string" as const },
    encodingAESKey: { type: "string" as const },
    webhookPort: { type: "integer" as const, minimum: 1 },
    webhookPath: { type: "string" as const },
    dmPolicy: { type: "string" as const, enum: ["open", "pairing", "allowlist"] },
    allowFrom: { type: "array" as const, items: { type: "string" as const } },
  },
};
