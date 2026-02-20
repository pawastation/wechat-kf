import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { wechatKfConfigSchema } from "../src/config-schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(__dirname, "..", "openclaw.plugin.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
const manifestSchema = manifest.configSchema;

// Helper to strip fields that only the manifest needs (e.g. description in manifest
// but not necessarily identical wording in runtime). We compare structural constraints.
function pickConstraints(obj: Record<string, unknown>) {
  const {
    type,
    minLength,
    maxLength,
    minimum,
    maximum,
    default: def,
    enum: en,
    items,
  } = obj as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  if (type !== undefined) result.type = type;
  if (minLength !== undefined) result.minLength = minLength;
  if (maxLength !== undefined) result.maxLength = maxLength;
  if (minimum !== undefined) result.minimum = minimum;
  if (maximum !== undefined) result.maximum = maximum;
  if (def !== undefined) result.default = def;
  if (en !== undefined) result.enum = en;
  if (items !== undefined) result.items = items;
  return result;
}

describe("config-schema alignment", () => {
  describe("manifest configSchema", () => {
    it("should have uiHints section", () => {
      expect(manifestSchema.uiHints).toBeDefined();
      expect(typeof manifestSchema.uiHints).toBe("object");
    });

    it("should mark appSecret as sensitive in uiHints", () => {
      expect(manifestSchema.uiHints.appSecret.sensitive).toBe(true);
    });

    it("should mark token as sensitive in uiHints", () => {
      expect(manifestSchema.uiHints.token.sensitive).toBe(true);
    });

    it("should mark encodingAESKey as sensitive in uiHints", () => {
      expect(manifestSchema.uiHints.encodingAESKey.sensitive).toBe(true);
    });

    it("should not mark corpId as sensitive in uiHints", () => {
      expect(manifestSchema.uiHints.corpId.sensitive).toBeUndefined();
    });
  });

  describe("runtime schema sync", () => {
    it("should have the same property keys as the manifest", () => {
      const runtimeKeys = Object.keys(wechatKfConfigSchema.properties).sort();
      const manifestKeys = Object.keys(manifestSchema.properties).sort();
      expect(runtimeKeys).toEqual(manifestKeys);
    });
  });

  describe("field-level constraint sync", () => {
    it("encodingAESKey should have minLength: 43, maxLength: 43", () => {
      const rt = wechatKfConfigSchema.properties.encodingAESKey;
      expect(rt.minLength).toBe(43);
      expect(rt.maxLength).toBe(43);
    });

    it("webhookPath should have default: '/wechat-kf'", () => {
      expect(wechatKfConfigSchema.properties.webhookPath.default).toBe("/wechat-kf");
    });

    it("dmPolicy should have default: 'open'", () => {
      expect(wechatKfConfigSchema.properties.dmPolicy.default).toBe("open");
    });

    it("dmPolicy enum should match manifest", () => {
      const rtEnum = [...wechatKfConfigSchema.properties.dmPolicy.enum].sort();
      const mfEnum = [...manifestSchema.properties.dmPolicy.enum].sort();
      expect(rtEnum).toEqual(mfEnum);
    });

    it("all property constraints should match between runtime and manifest", () => {
      const keys = Object.keys(manifestSchema.properties);
      for (const key of keys) {
        const mfField = manifestSchema.properties[key];
        const rtField = (wechatKfConfigSchema.properties as Record<string, Record<string, unknown>>)[key];
        expect(pickConstraints(rtField)).toEqual(pickConstraints(mfField));
      }
    });
  });
});
