import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { wechatKfConfigSchema } from "../src/config-schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(__dirname, "..", "openclaw.plugin.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
const manifestSchema = manifest.configSchema;

describe("config-schema alignment", () => {
  describe("manifest configSchema", () => {
    it("should have additionalProperties set to false", () => {
      expect(manifestSchema.additionalProperties).toBe(false);
    });

    it("should have required fields", () => {
      expect(manifestSchema.required).toEqual(
        expect.arrayContaining(["corpId", "appSecret", "token", "encodingAESKey"]),
      );
    });

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
    it("should have the same required fields as the manifest", () => {
      expect([...wechatKfConfigSchema.required].sort()).toEqual(
        [...manifestSchema.required].sort(),
      );
    });

    it("should have additionalProperties set to false", () => {
      expect(wechatKfConfigSchema.additionalProperties).toBe(false);
    });

    it("should have the same property keys as the manifest", () => {
      const runtimeKeys = Object.keys(wechatKfConfigSchema.properties).sort();
      const manifestKeys = Object.keys(manifestSchema.properties).sort();
      expect(runtimeKeys).toEqual(manifestKeys);
    });
  });
});
