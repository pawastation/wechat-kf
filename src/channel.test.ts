import { describe, it, expect } from "vitest";
import { wechatKfPlugin } from "./channel.js";

describe("security adapter", () => {
  const security = wechatKfPlugin.security as any;

  describe("resolveDmPolicy", () => {
    it("returns correct structure with default config (no dmPolicy)", () => {
      const cfg = { channels: { "wechat-kf": {} } };
      const result = security.resolveDmPolicy({ cfg });

      expect(result).toEqual(
        expect.objectContaining({
          policy: "open",
          allowFrom: [],
          allowFromPath: "channels.wechat-kf.allowFrom",
        }),
      );
      expect(typeof result.approveHint).toBe("string");
      expect(typeof result.normalizeEntry).toBe("function");
    });

    it("returns 'open' when dmPolicy is not set", () => {
      const cfg = { channels: { "wechat-kf": {} } };
      const result = security.resolveDmPolicy({ cfg });
      expect(result.policy).toBe("open");
    });

    it("returns 'allowlist' when dmPolicy is set to allowlist", () => {
      const cfg = { channels: { "wechat-kf": { dmPolicy: "allowlist" } } };
      const result = security.resolveDmPolicy({ cfg });
      expect(result.policy).toBe("allowlist");
    });

    it("returns 'pairing' when dmPolicy is set to pairing", () => {
      const cfg = { channels: { "wechat-kf": { dmPolicy: "pairing" } } };
      const result = security.resolveDmPolicy({ cfg });
      expect(result.policy).toBe("pairing");
    });

    it("passes through allowFrom from config", () => {
      const cfg = {
        channels: { "wechat-kf": { allowFrom: ["user1", "user2"] } },
      };
      const result = security.resolveDmPolicy({ cfg });
      expect(result.allowFrom).toEqual(["user1", "user2"]);
    });

    it("defaults allowFrom to empty array when not configured", () => {
      const cfg = { channels: { "wechat-kf": {} } };
      const result = security.resolveDmPolicy({ cfg });
      expect(result.allowFrom).toEqual([]);
    });

    it("normalizeEntry strips 'user:' prefix", () => {
      const cfg = { channels: { "wechat-kf": {} } };
      const result = security.resolveDmPolicy({ cfg });
      expect(result.normalizeEntry("user:abc123")).toBe("abc123");
      expect(result.normalizeEntry("User:ABC")).toBe("ABC");
    });

    it("normalizeEntry trims whitespace", () => {
      const cfg = { channels: { "wechat-kf": {} } };
      const result = security.resolveDmPolicy({ cfg });
      expect(result.normalizeEntry("  abc  ")).toBe("abc");
    });

    it("normalizeEntry passes through plain ids", () => {
      const cfg = { channels: { "wechat-kf": {} } };
      const result = security.resolveDmPolicy({ cfg });
      expect(result.normalizeEntry("ext_userid_123")).toBe("ext_userid_123");
    });

    it("approveHint contains instructions for adding external_userid", () => {
      const cfg = { channels: { "wechat-kf": {} } };
      const result = security.resolveDmPolicy({ cfg });
      expect(result.approveHint).toContain("external_userid");
      expect(result.approveHint).toContain("openclaw config set");
    });

    it("allowFromPath is correct", () => {
      const cfg = { channels: { "wechat-kf": {} } };
      const result = security.resolveDmPolicy({ cfg });
      expect(result.allowFromPath).toBe("channels.wechat-kf.allowFrom");
    });
  });

  describe("collectWarnings", () => {
    it("warns when dmPolicy is 'open' (default)", () => {
      const cfg = { channels: { "wechat-kf": {} } };
      const warnings = security.collectWarnings({ cfg });
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("dmPolicy");
      expect(warnings[0]).toContain("open");
    });

    it("warns when dmPolicy is explicitly 'open'", () => {
      const cfg = { channels: { "wechat-kf": { dmPolicy: "open" } } };
      const warnings = security.collectWarnings({ cfg });
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("open");
    });

    it("returns empty array when dmPolicy is 'allowlist'", () => {
      const cfg = { channels: { "wechat-kf": { dmPolicy: "allowlist" } } };
      const warnings = security.collectWarnings({ cfg });
      expect(warnings).toEqual([]);
    });

    it("returns empty array when dmPolicy is 'pairing'", () => {
      const cfg = { channels: { "wechat-kf": { dmPolicy: "pairing" } } };
      const warnings = security.collectWarnings({ cfg });
      expect(warnings).toEqual([]);
    });
  });
});
