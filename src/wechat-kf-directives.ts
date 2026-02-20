/**
 * WeChat KF directive parser
 *
 * Parses [[wechat_*: ...]] directives embedded in agent text replies.
 * The framework doesn't recognize these directives, so the text arrives
 * intact for plugin-level interception.
 *
 * Supported directives:
 *   [[wechat_link: title | desc | url | thumbUrl]]
 *   [[wechat_location: name | address | lat | lng]]
 *   [[wechat_miniprogram: appid | title | pagepath | thumbUrl]]
 *   [[wechat_menu: header | Option1, Option2, Option3 | footer]]
 *   [[wechat_business_card: USERID]]
 *   [[wechat_ca_link: https://work.weixin.qq.com/ca/...]]
 */

export type WechatLinkDirective = {
  title: string;
  desc?: string;
  url: string;
  thumbUrl?: string;
};

export type WechatLocationDirective = {
  name: string;
  address?: string;
  latitude: number;
  longitude: number;
};

export type WechatMenuDirective = {
  headContent?: string;
  items: string[];
  tailContent?: string;
};

export type WechatMiniprogramDirective = {
  appid: string;
  title: string;
  pagepath: string;
  thumbUrl?: string;
};

export type WechatBusinessCardDirective = {
  userid: string;
};

export type WechatCaLinkDirective = {
  link_url: string;
};

export type WechatDirectiveResult = {
  text: string;
  link?: WechatLinkDirective;
  location?: WechatLocationDirective;
  miniprogram?: WechatMiniprogramDirective;
  menu?: WechatMenuDirective;
  businessCard?: WechatBusinessCardDirective;
  caLink?: WechatCaLinkDirective;
};

const DIRECTIVE_END = "]]";

// ── Generic directive finder ──

function findDirective(text: string, prefix: string): { inner: string; startIdx: number; endIdx: number } | null {
  const lower = text.toLowerCase();
  const startIdx = lower.indexOf(prefix);
  if (startIdx === -1) return null;
  const contentStart = startIdx + prefix.length;
  const endIdx = lower.indexOf(DIRECTIVE_END, contentStart);
  if (endIdx === -1) return null;
  return { inner: text.slice(contentStart, endIdx), startIdx, endIdx };
}

function stripDirective(text: string, startIdx: number, endIdx: number): string {
  return (text.slice(0, startIdx) + text.slice(endIdx + DIRECTIVE_END.length)).replace(/\n{3,}/g, "\n\n").trim();
}

function isValidUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

// ── Link directive (unchanged API) ──

const LINK_PREFIX = "[[wechat_link:";

/**
 * Quick check whether text contains a `[[wechat_link:...]]` directive.
 */
export function hasWechatLinkDirective(text: string): boolean {
  const lower = text.toLowerCase();
  const start = lower.indexOf(LINK_PREFIX);
  return start !== -1 && lower.indexOf(DIRECTIVE_END, start + LINK_PREFIX.length) !== -1;
}

/**
 * Extract the first `[[wechat_link:...]]` directive from text.
 *
 * Returns the remaining text (with directive stripped and trimmed)
 * plus the parsed link fields. If parsing fails (e.g. invalid URL),
 * returns the original text unchanged with no link.
 */
export function parseWechatLinkDirective(text: string): WechatDirectiveResult {
  const found = findDirective(text, LINK_PREFIX);
  if (!found) return { text };

  const parts = found.inner.split("|").map((s) => s.trim());
  let link: WechatLinkDirective | undefined;

  if (parts.length === 2) {
    const [title, url] = parts;
    if (isValidUrl(url)) {
      link = { title, url };
    }
  } else if (parts.length === 3) {
    const [title, desc, url] = parts;
    if (isValidUrl(url)) {
      link = { title, desc, url };
    }
  } else if (parts.length >= 4) {
    const [title, desc, url, thumbUrl] = parts;
    if (isValidUrl(url)) {
      link = { title, desc, url, thumbUrl: thumbUrl || undefined };
    }
  }

  if (!link) return { text };
  return { text: stripDirective(text, found.startIdx, found.endIdx), link };
}

// ── Location directive ──

const LOCATION_PREFIX = "[[wechat_location:";

export function parseWechatLocationDirective(text: string): WechatDirectiveResult {
  const found = findDirective(text, LOCATION_PREFIX);
  if (!found) return { text };

  const parts = found.inner.split("|").map((s) => s.trim());
  // 3 fields: name | lat | lng
  // 4 fields: name | address | lat | lng
  if (parts.length === 3) {
    const [name, latStr, lngStr] = parts;
    const latitude = Number(latStr);
    const longitude = Number(lngStr);
    if (name && !Number.isNaN(latitude) && !Number.isNaN(longitude)) {
      return {
        text: stripDirective(text, found.startIdx, found.endIdx),
        location: { name, latitude, longitude },
      };
    }
  } else if (parts.length >= 4) {
    const [name, address, latStr, lngStr] = parts;
    const latitude = Number(latStr);
    const longitude = Number(lngStr);
    if (name && !Number.isNaN(latitude) && !Number.isNaN(longitude)) {
      return {
        text: stripDirective(text, found.startIdx, found.endIdx),
        location: { name, address: address || undefined, latitude, longitude },
      };
    }
  }
  return { text };
}

// ── Miniprogram directive ──

const MINIPROGRAM_PREFIX = "[[wechat_miniprogram:";

export function parseWechatMiniprogramDirective(text: string): WechatDirectiveResult {
  const found = findDirective(text, MINIPROGRAM_PREFIX);
  if (!found) return { text };

  const parts = found.inner.split("|").map((s) => s.trim());
  // 3 fields: appid | title | pagepath
  // 4 fields: appid | title | pagepath | thumbUrl
  if (parts.length === 3) {
    const [appid, title, pagepath] = parts;
    if (appid && title && pagepath) {
      return {
        text: stripDirective(text, found.startIdx, found.endIdx),
        miniprogram: { appid, title, pagepath },
      };
    }
  } else if (parts.length >= 4) {
    const [appid, title, pagepath, thumbUrl] = parts;
    if (appid && title && pagepath) {
      return {
        text: stripDirective(text, found.startIdx, found.endIdx),
        miniprogram: { appid, title, pagepath, thumbUrl: thumbUrl || undefined },
      };
    }
  }
  return { text };
}

// ── Menu directive ──

const MENU_PREFIX = "[[wechat_menu:";

export function parseWechatMenuDirective(text: string): WechatDirectiveResult {
  const found = findDirective(text, MENU_PREFIX);
  if (!found) return { text };

  const parts = found.inner.split("|").map((s) => s.trim());
  // 1 field: Option1, Option2 (items only — no header/footer)
  // 2 fields: header | Option1, Option2
  // 3 fields: header | Option1, Option2 | footer
  let headContent: string | undefined;
  let itemsStr: string;
  let tailContent: string | undefined;

  if (parts.length === 1) {
    itemsStr = parts[0];
  } else if (parts.length === 2) {
    headContent = parts[0] || undefined;
    itemsStr = parts[1];
  } else if (parts.length >= 3) {
    headContent = parts[0] || undefined;
    itemsStr = parts[1];
    tailContent = parts[2] || undefined;
  } else {
    return { text };
  }

  const items = itemsStr
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (items.length === 0) return { text };

  return {
    text: stripDirective(text, found.startIdx, found.endIdx),
    menu: { headContent, items, tailContent },
  };
}

// ── Business card directive ──

const BUSINESS_CARD_PREFIX = "[[wechat_business_card:";

export function parseWechatBusinessCardDirective(text: string): WechatDirectiveResult {
  const found = findDirective(text, BUSINESS_CARD_PREFIX);
  if (!found) return { text };

  const userid = found.inner.trim();
  if (!userid) return { text };

  return {
    text: stripDirective(text, found.startIdx, found.endIdx),
    businessCard: { userid },
  };
}

// ── CA link directive ──

const CA_LINK_PREFIX = "[[wechat_ca_link:";

export function parseWechatCaLinkDirective(text: string): WechatDirectiveResult {
  const found = findDirective(text, CA_LINK_PREFIX);
  if (!found) return { text };

  const link_url = found.inner.trim();
  if (!link_url || !isValidUrl(link_url)) return { text };

  return {
    text: stripDirective(text, found.startIdx, found.endIdx),
    caLink: { link_url },
  };
}

// ── Unified parser ──

const ALL_PREFIXES = [
  LINK_PREFIX,
  LOCATION_PREFIX,
  MINIPROGRAM_PREFIX,
  MENU_PREFIX,
  BUSINESS_CARD_PREFIX,
  CA_LINK_PREFIX,
];

/**
 * Quick check whether text contains any `[[wechat_*:...]]` directive.
 */
export function hasWechatDirective(text: string): boolean {
  const lower = text.toLowerCase();
  return ALL_PREFIXES.some((prefix) => {
    const start = lower.indexOf(prefix);
    return start !== -1 && lower.indexOf(DIRECTIVE_END, start + prefix.length) !== -1;
  });
}

/**
 * Parse the first matching directive from text.
 * Tries parsers in order: link → location → miniprogram → menu → business_card → ca_link.
 * Returns the first successful parse result.
 */
export function parseWechatDirective(text: string): WechatDirectiveResult {
  const parsers = [
    parseWechatLinkDirective,
    parseWechatLocationDirective,
    parseWechatMiniprogramDirective,
    parseWechatMenuDirective,
    parseWechatBusinessCardDirective,
    parseWechatCaLinkDirective,
  ];
  for (const parser of parsers) {
    const result = parser(text);
    if (result.link || result.location || result.miniprogram || result.menu || result.businessCard || result.caLink) {
      return result;
    }
  }
  return { text };
}
