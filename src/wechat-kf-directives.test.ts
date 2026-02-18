import { describe, expect, it } from "vitest";
import { hasWechatLinkDirective, parseWechatLinkDirective } from "./wechat-kf-directives.js";

// ══════════════════════════════════════════════
// hasWechatLinkDirective
// ══════════════════════════════════════════════

describe("hasWechatLinkDirective", () => {
  it("detects [[wechat_link:...]] in text", () => {
    expect(hasWechatLinkDirective("Check this [[wechat_link: Title | https://example.com]]")).toBe(true);
  });

  it("detects directive on its own line", () => {
    expect(hasWechatLinkDirective("Hello\n[[wechat_link: Title | https://example.com]]\nBye")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(hasWechatLinkDirective("[[WECHAT_LINK: Title | https://example.com]]")).toBe(true);
    expect(hasWechatLinkDirective("[[Wechat_Link: Title | https://example.com]]")).toBe(true);
  });

  it("returns false for unrelated [[...]] brackets", () => {
    expect(hasWechatLinkDirective("[[some_other: data]]")).toBe(false);
  });

  it("returns false for plain text", () => {
    expect(hasWechatLinkDirective("no directives here")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(hasWechatLinkDirective("")).toBe(false);
  });
});

// ══════════════════════════════════════════════
// parseWechatLinkDirective — 2-field format
// ══════════════════════════════════════════════

describe("parseWechatLinkDirective 2-field", () => {
  it("parses title | url", () => {
    const result = parseWechatLinkDirective("[[wechat_link: My Article | https://example.com/article]]");
    expect(result.link).toEqual({
      title: "My Article",
      url: "https://example.com/article",
    });
    expect(result.text).toBe("");
  });

  it("preserves surrounding text", () => {
    const result = parseWechatLinkDirective("推荐这篇文章\n[[wechat_link: Title | https://example.com]]\n希望你喜欢");
    expect(result.link).toBeDefined();
    expect(result.text).toBe("推荐这篇文章\n\n希望你喜欢");
  });
});

// ══════════════════════════════════════════════
// parseWechatLinkDirective — 3-field format
// ══════════════════════════════════════════════

describe("parseWechatLinkDirective 3-field", () => {
  it("parses title | desc | url", () => {
    const result = parseWechatLinkDirective(
      "[[wechat_link: Deep Learning | A great tutorial | https://example.com/dl]]",
    );
    expect(result.link).toEqual({
      title: "Deep Learning",
      desc: "A great tutorial",
      url: "https://example.com/dl",
    });
    expect(result.text).toBe("");
  });
});

// ══════════════════════════════════════════════
// parseWechatLinkDirective — 4-field format
// ══════════════════════════════════════════════

describe("parseWechatLinkDirective 4-field", () => {
  it("parses title | desc | url | thumbUrl", () => {
    const result = parseWechatLinkDirective(
      "[[wechat_link: 深度学习入门 | 很好的教程 | https://example.com/dl | https://example.com/thumb.jpg]]",
    );
    expect(result.link).toEqual({
      title: "深度学习入门",
      desc: "很好的教程",
      url: "https://example.com/dl",
      thumbUrl: "https://example.com/thumb.jpg",
    });
    expect(result.text).toBe("");
  });

  it("treats empty thumbUrl as undefined", () => {
    const result = parseWechatLinkDirective("[[wechat_link: Title | Desc | https://example.com |  ]]");
    expect(result.link).toBeDefined();
    expect(result.link?.thumbUrl).toBeUndefined();
  });
});

// ══════════════════════════════════════════════
// parseWechatLinkDirective — edge cases
// ══════════════════════════════════════════════

describe("parseWechatLinkDirective edge cases", () => {
  it("returns no link when URL is invalid (not http/https)", () => {
    const result = parseWechatLinkDirective("[[wechat_link: Title | ftp://example.com]]");
    expect(result.link).toBeUndefined();
    expect(result.text).toBe("[[wechat_link: Title | ftp://example.com]]");
  });

  it("returns no link when URL is missing protocol", () => {
    const result = parseWechatLinkDirective("[[wechat_link: Title | example.com]]");
    expect(result.link).toBeUndefined();
  });

  it("returns text unchanged when no directive present", () => {
    const input = "Just normal text here.";
    const result = parseWechatLinkDirective(input);
    expect(result.text).toBe(input);
    expect(result.link).toBeUndefined();
  });

  it("handles single field gracefully (no link)", () => {
    const result = parseWechatLinkDirective("[[wechat_link: onlytitle]]");
    expect(result.link).toBeUndefined();
  });

  it("trims whitespace from fields", () => {
    const result = parseWechatLinkDirective(
      "[[wechat_link:  Title With Spaces  |  A description  |  https://example.com  ]]",
    );
    expect(result.link?.title).toBe("Title With Spaces");
    expect(result.link?.desc).toBe("A description");
    expect(result.link?.url).toBe("https://example.com");
  });

  it("handles http:// URLs", () => {
    const result = parseWechatLinkDirective("[[wechat_link: Title | http://example.com]]");
    expect(result.link).toBeDefined();
    expect(result.link?.url).toBe("http://example.com");
  });

  it("collapses excess newlines after stripping directive", () => {
    const result = parseWechatLinkDirective("Before\n\n\n[[wechat_link: Title | https://example.com]]\n\n\nAfter");
    expect(result.link).toBeDefined();
    expect(result.text).toBe("Before\n\nAfter");
  });

  it("is case-insensitive for directive name", () => {
    const result = parseWechatLinkDirective("[[WECHAT_LINK: Title | https://example.com]]");
    expect(result.link).toBeDefined();
    expect(result.link?.title).toBe("Title");
  });
});
