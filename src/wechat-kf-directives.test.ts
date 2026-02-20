import { describe, expect, it } from "vitest";
import {
  hasWechatDirective,
  hasWechatLinkDirective,
  parseWechatBusinessCardDirective,
  parseWechatCaLinkDirective,
  parseWechatDirective,
  parseWechatLinkDirective,
  parseWechatLocationDirective,
  parseWechatMenuDirective,
  parseWechatMiniprogramDirective,
} from "./wechat-kf-directives.js";

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

// ══════════════════════════════════════════════
// parseWechatLocationDirective
// ══════════════════════════════════════════════

describe("parseWechatLocationDirective", () => {
  it("parses 3-field format: name | lat | lng", () => {
    const result = parseWechatLocationDirective("[[wechat_location: 故宫 | 39.9 | 116.3]]");
    expect(result.location).toEqual({ name: "故宫", latitude: 39.9, longitude: 116.3 });
    expect(result.text).toBe("");
  });

  it("parses 4-field format: name | address | lat | lng", () => {
    const result = parseWechatLocationDirective("[[wechat_location: 故宫 | 北京市东城区 | 39.9 | 116.3]]");
    expect(result.location).toEqual({ name: "故宫", address: "北京市东城区", latitude: 39.9, longitude: 116.3 });
    expect(result.text).toBe("");
  });

  it("treats empty address as undefined", () => {
    const result = parseWechatLocationDirective("[[wechat_location: Place |  | 39.9 | 116.3]]");
    expect(result.location?.address).toBeUndefined();
  });

  it("preserves surrounding text", () => {
    const result = parseWechatLocationDirective("我在这里\n[[wechat_location: 故宫 | 39.9 | 116.3]]\n快来");
    expect(result.location).toBeDefined();
    expect(result.text).toBe("我在这里\n\n快来");
  });

  it("returns no location when lat is not a number", () => {
    const result = parseWechatLocationDirective("[[wechat_location: Place | abc | 116.3]]");
    expect(result.location).toBeUndefined();
  });

  it("returns no location when name is empty", () => {
    const result = parseWechatLocationDirective("[[wechat_location:  | 39.9 | 116.3]]");
    expect(result.location).toBeUndefined();
  });

  it("returns text unchanged when no directive", () => {
    const result = parseWechatLocationDirective("no directive");
    expect(result.location).toBeUndefined();
    expect(result.text).toBe("no directive");
  });

  it("is case-insensitive", () => {
    const result = parseWechatLocationDirective("[[WECHAT_LOCATION: Place | 39.9 | 116.3]]");
    expect(result.location).toBeDefined();
  });
});

// ══════════════════════════════════════════════
// parseWechatMiniprogramDirective
// ══════════════════════════════════════════════

describe("parseWechatMiniprogramDirective", () => {
  it("parses 3-field format: appid | title | pagepath", () => {
    const result = parseWechatMiniprogramDirective("[[wechat_miniprogram: wx123 | My App | pages/index]]");
    expect(result.miniprogram).toEqual({ appid: "wx123", title: "My App", pagepath: "pages/index" });
    expect(result.text).toBe("");
  });

  it("parses 4-field format: appid | title | pagepath | thumbUrl", () => {
    const result = parseWechatMiniprogramDirective(
      "[[wechat_miniprogram: wx123 | My App | pages/index | https://example.com/thumb.jpg]]",
    );
    expect(result.miniprogram).toEqual({
      appid: "wx123",
      title: "My App",
      pagepath: "pages/index",
      thumbUrl: "https://example.com/thumb.jpg",
    });
  });

  it("treats empty thumbUrl as undefined", () => {
    const result = parseWechatMiniprogramDirective("[[wechat_miniprogram: wx123 | My App | pages/index |  ]]");
    expect(result.miniprogram?.thumbUrl).toBeUndefined();
  });

  it("returns no miniprogram when appid is empty", () => {
    const result = parseWechatMiniprogramDirective("[[wechat_miniprogram:  | My App | pages/index]]");
    expect(result.miniprogram).toBeUndefined();
  });

  it("returns text unchanged when no directive", () => {
    const result = parseWechatMiniprogramDirective("no directive");
    expect(result.miniprogram).toBeUndefined();
    expect(result.text).toBe("no directive");
  });
});

// ══════════════════════════════════════════════
// parseWechatMenuDirective
// ══════════════════════════════════════════════

describe("parseWechatMenuDirective", () => {
  it("parses 3-field format: header | items | footer", () => {
    const result = parseWechatMenuDirective("[[wechat_menu: 请选择 | 选项A, 选项B, 选项C | 谢谢]]");
    expect(result.menu).toEqual({
      headContent: "请选择",
      items: ["选项A", "选项B", "选项C"],
      tailContent: "谢谢",
    });
    expect(result.text).toBe("");
  });

  it("parses 2-field format: header | items", () => {
    const result = parseWechatMenuDirective("[[wechat_menu: 请选择 | A, B]]");
    expect(result.menu).toEqual({ headContent: "请选择", items: ["A", "B"], tailContent: undefined });
  });

  it("parses 1-field format: items only", () => {
    const result = parseWechatMenuDirective("[[wechat_menu: A, B, C]]");
    expect(result.menu).toEqual({ headContent: undefined, items: ["A", "B", "C"], tailContent: undefined });
  });

  it("treats empty header as undefined", () => {
    const result = parseWechatMenuDirective("[[wechat_menu:  | A, B]]");
    expect(result.menu?.headContent).toBeUndefined();
  });

  it("treats empty footer as undefined", () => {
    const result = parseWechatMenuDirective("[[wechat_menu: Header | A, B | ]]");
    expect(result.menu?.tailContent).toBeUndefined();
  });

  it("returns no menu when items are empty", () => {
    const result = parseWechatMenuDirective("[[wechat_menu: Header | ]]");
    expect(result.menu).toBeUndefined();
  });

  it("preserves surrounding text", () => {
    const result = parseWechatMenuDirective("你好\n[[wechat_menu: Q | A, B]]\n再见");
    expect(result.menu).toBeDefined();
    expect(result.text).toBe("你好\n\n再见");
  });

  it("returns text unchanged when no directive", () => {
    const result = parseWechatMenuDirective("no directive");
    expect(result.menu).toBeUndefined();
    expect(result.text).toBe("no directive");
  });
});

// ══════════════════════════════════════════════
// parseWechatBusinessCardDirective
// ══════════════════════════════════════════════

describe("parseWechatBusinessCardDirective", () => {
  it("parses userid", () => {
    const result = parseWechatBusinessCardDirective("[[wechat_business_card: servicer_001]]");
    expect(result.businessCard).toEqual({ userid: "servicer_001" });
    expect(result.text).toBe("");
  });

  it("trims whitespace", () => {
    const result = parseWechatBusinessCardDirective("[[wechat_business_card:   user_abc   ]]");
    expect(result.businessCard?.userid).toBe("user_abc");
  });

  it("returns no businessCard when userid is empty", () => {
    const result = parseWechatBusinessCardDirective("[[wechat_business_card:   ]]");
    expect(result.businessCard).toBeUndefined();
  });

  it("preserves surrounding text", () => {
    const result = parseWechatBusinessCardDirective("联系他\n[[wechat_business_card: user_1]]\n谢谢");
    expect(result.businessCard).toBeDefined();
    expect(result.text).toBe("联系他\n\n谢谢");
  });

  it("returns text unchanged when no directive", () => {
    const result = parseWechatBusinessCardDirective("no directive");
    expect(result.businessCard).toBeUndefined();
  });
});

// ══════════════════════════════════════════════
// parseWechatCaLinkDirective
// ══════════════════════════════════════════════

describe("parseWechatCaLinkDirective", () => {
  it("parses valid ca_link URL", () => {
    const result = parseWechatCaLinkDirective("[[wechat_ca_link: https://work.weixin.qq.com/ca/abc123]]");
    expect(result.caLink).toEqual({ link_url: "https://work.weixin.qq.com/ca/abc123" });
    expect(result.text).toBe("");
  });

  it("returns no caLink when URL is not http/https", () => {
    const result = parseWechatCaLinkDirective("[[wechat_ca_link: ftp://example.com]]");
    expect(result.caLink).toBeUndefined();
  });

  it("returns no caLink when URL is empty", () => {
    const result = parseWechatCaLinkDirective("[[wechat_ca_link:   ]]");
    expect(result.caLink).toBeUndefined();
  });

  it("preserves surrounding text", () => {
    const result = parseWechatCaLinkDirective(
      "点击这里\n[[wechat_ca_link: https://work.weixin.qq.com/ca/abc]]\n了解更多",
    );
    expect(result.caLink).toBeDefined();
    expect(result.text).toBe("点击这里\n\n了解更多");
  });

  it("returns text unchanged when no directive", () => {
    const result = parseWechatCaLinkDirective("no directive");
    expect(result.caLink).toBeUndefined();
  });
});

// ══════════════════════════════════════════════
// hasWechatDirective (unified)
// ══════════════════════════════════════════════

describe("hasWechatDirective", () => {
  it("detects link directive", () => {
    expect(hasWechatDirective("[[wechat_link: Title | https://example.com]]")).toBe(true);
  });

  it("detects location directive", () => {
    expect(hasWechatDirective("[[wechat_location: Place | 39.9 | 116.3]]")).toBe(true);
  });

  it("detects miniprogram directive", () => {
    expect(hasWechatDirective("[[wechat_miniprogram: wx123 | Title | pages/index]]")).toBe(true);
  });

  it("detects menu directive", () => {
    expect(hasWechatDirective("[[wechat_menu: Header | A, B]]")).toBe(true);
  });

  it("detects business_card directive", () => {
    expect(hasWechatDirective("[[wechat_business_card: user_1]]")).toBe(true);
  });

  it("detects ca_link directive", () => {
    expect(hasWechatDirective("[[wechat_ca_link: https://work.weixin.qq.com/ca/abc]]")).toBe(true);
  });

  it("returns false for plain text", () => {
    expect(hasWechatDirective("no directives here")).toBe(false);
  });

  it("returns false for unrelated brackets", () => {
    expect(hasWechatDirective("[[some_other: data]]")).toBe(false);
  });
});

// ══════════════════════════════════════════════
// parseWechatDirective (unified)
// ══════════════════════════════════════════════

describe("parseWechatDirective", () => {
  it("parses link directive", () => {
    const result = parseWechatDirective("[[wechat_link: Title | https://example.com]]");
    expect(result.link).toBeDefined();
    expect(result.location).toBeUndefined();
  });

  it("parses location directive", () => {
    const result = parseWechatDirective("[[wechat_location: Place | 39.9 | 116.3]]");
    expect(result.location).toBeDefined();
    expect(result.link).toBeUndefined();
  });

  it("parses miniprogram directive", () => {
    const result = parseWechatDirective("[[wechat_miniprogram: wx123 | Title | pages/index]]");
    expect(result.miniprogram).toBeDefined();
  });

  it("parses menu directive", () => {
    const result = parseWechatDirective("[[wechat_menu: Q | A, B, C]]");
    expect(result.menu).toBeDefined();
  });

  it("parses business_card directive", () => {
    const result = parseWechatDirective("[[wechat_business_card: user_1]]");
    expect(result.businessCard).toBeDefined();
  });

  it("parses ca_link directive", () => {
    const result = parseWechatDirective("[[wechat_ca_link: https://work.weixin.qq.com/ca/abc]]");
    expect(result.caLink).toBeDefined();
  });

  it("returns text unchanged when no directive", () => {
    const result = parseWechatDirective("just text");
    expect(result.text).toBe("just text");
    expect(result.link).toBeUndefined();
    expect(result.location).toBeUndefined();
    expect(result.miniprogram).toBeUndefined();
    expect(result.menu).toBeUndefined();
    expect(result.businessCard).toBeUndefined();
    expect(result.caLink).toBeUndefined();
  });

  it("prioritizes link over location when both present", () => {
    const text = "[[wechat_link: Title | https://example.com]] [[wechat_location: Place | 39.9 | 116.3]]";
    const result = parseWechatDirective(text);
    expect(result.link).toBeDefined();
    expect(result.location).toBeUndefined();
  });
});
