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

export type WechatMenuItemDirective =
  | { type: "click"; id?: string; content: string }
  | { type: "view"; url: string; content: string }
  | { type: "miniprogram"; appid: string; pagepath: string; content: string }
  | { type: "text"; content: string; noNewline?: boolean };

export type WechatMenuDirective = {
  headContent?: string;
  items: WechatMenuItemDirective[];
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

export type WechatRawDirective = {
  msgtype: string;
  payload: Record<string, unknown>;
};

export type WechatDirectiveResult = {
  text: string;
  link?: WechatLinkDirective;
  location?: WechatLocationDirective;
  miniprogram?: WechatMiniprogramDirective;
  menu?: WechatMenuDirective;
  businessCard?: WechatBusinessCardDirective;
  caLink?: WechatCaLinkDirective;
  raw?: WechatRawDirective;
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

/**
 * Split a string on commas, but ignore commas inside parentheses.
 * E.g. `"满意, view(https://example.com, 查看)"` → `["满意", "view(https://example.com, 查看)"]`
 */
function splitCommaOutsideParens(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === "," && depth === 0) {
      parts.push(input.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(input.slice(start));
  return parts;
}

/**
 * Parse a single menu item from directive syntax.
 *
 * Supported forms:
 *   `满意`                       → click (auto ID)
 *   `click(id, content)`        → click with explicit ID
 *   `view(url, content)`        → URL link
 *   `mini(appid, pagepath, content)` → mini program
 *   `text(content)`             → plain text row
 *   `text(content, noline)`     → plain text without newline
 */
function parseMenuItemDirective(raw: string): WechatMenuItemDirective | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Try typed syntax: type(args...)
  const match = trimmed.match(/^(\w+)\((.+)\)$/s);
  if (match) {
    const typeName = match[1].toLowerCase();
    const argsStr = match[2];
    // Split args on commas (no nested parens expected inside)
    const args = argsStr.split(",").map((s) => s.trim());

    switch (typeName) {
      case "click": {
        // click(id, content)
        if (args.length >= 2) {
          return { type: "click", id: args[0], content: args.slice(1).join(", ") };
        }
        // click(content) — treated as click with no explicit id
        if (args.length === 1 && args[0]) {
          return { type: "click", content: args[0] };
        }
        return null;
      }
      case "view": {
        // view(url, content)
        if (args.length >= 2 && args[0]) {
          return { type: "view", url: args[0], content: args.slice(1).join(", ") };
        }
        return null;
      }
      case "mini": {
        // mini(appid, pagepath, content)
        if (args.length >= 3 && args[0] && args[1]) {
          return { type: "miniprogram", appid: args[0], pagepath: args[1], content: args.slice(2).join(", ") };
        }
        return null;
      }
      case "text": {
        // text(content) or text(content, noline)
        if (args.length >= 1 && args[0]) {
          const noNewline = args.length >= 2 && args[args.length - 1].toLowerCase() === "noline";
          const content = noNewline ? args.slice(0, -1).join(", ") : args.join(", ");
          return { type: "text", content, ...(noNewline ? { noNewline: true } : {}) };
        }
        return null;
      }
      default:
        // Unknown type — treat as plain click text (entire raw string)
        return { type: "click", content: trimmed };
    }
  }

  // Plain text → click item (auto ID assigned later)
  return { type: "click", content: trimmed };
}

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

  const rawItems = splitCommaOutsideParens(itemsStr);
  const items: WechatMenuItemDirective[] = [];
  for (const raw of rawItems) {
    const parsed = parseMenuItemDirective(raw);
    if (parsed) items.push(parsed);
  }
  if (items.length === 0) return { text };

  return {
    text: stripDirective(text, found.startIdx, found.endIdx),
    menu: { headContent, items, tailContent },
  };
}

/**
 * Convert a parsed WechatMenuDirective into the API `msgmenu` payload.
 *
 * Click items get auto-incrementing IDs (only among click items that lack
 * an explicit `id`). Explicit IDs are preserved as-is.
 */
export function buildMsgMenuPayload(menu: WechatMenuDirective): {
  head_content?: string;
  list: Array<
    | { type: "click"; click: { id: string; content: string } }
    | { type: "view"; view: { url: string; content: string } }
    | { type: "miniprogram"; miniprogram: { appid: string; pagepath: string; content: string } }
    | { type: "text"; text: { content: string; no_newline?: number } }
  >;
  tail_content?: string;
} {
  let clickAutoId = 0;
  const list = menu.items.map((item) => {
    switch (item.type) {
      case "click": {
        clickAutoId++;
        return { type: "click" as const, click: { id: item.id ?? String(clickAutoId), content: item.content } };
      }
      case "view":
        return { type: "view" as const, view: { url: item.url, content: item.content } };
      case "miniprogram":
        return {
          type: "miniprogram" as const,
          miniprogram: { appid: item.appid, pagepath: item.pagepath, content: item.content },
        };
      default:
        return {
          type: "text" as const,
          text: { content: item.content, ...(item.noNewline ? { no_newline: 1 } : {}) },
        };
    }
  });

  return {
    head_content: menu.headContent,
    list,
    tail_content: menu.tailContent,
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

// ── Raw message directive ──

const RAW_PREFIX = "[[wechat_raw:";

export function parseWechatRawDirective(text: string): WechatDirectiveResult {
  const found = findDirective(text, RAW_PREFIX);
  if (!found) return { text };
  const jsonStr = found.inner.trim();
  if (!jsonStr) return { text };
  try {
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    const msgtype = parsed.msgtype;
    if (typeof msgtype !== "string" || !msgtype) return { text };
    const { msgtype: _, ...payload } = parsed;
    return {
      text: stripDirective(text, found.startIdx, found.endIdx),
      raw: { msgtype, payload },
    };
  } catch {
    return { text }; // invalid JSON → treat as plain text
  }
}

// ── Unified parser ──

const ALL_PREFIXES = [
  LINK_PREFIX,
  LOCATION_PREFIX,
  MINIPROGRAM_PREFIX,
  MENU_PREFIX,
  BUSINESS_CARD_PREFIX,
  CA_LINK_PREFIX,
  RAW_PREFIX,
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
    parseWechatRawDirective,
  ];
  for (const parser of parsers) {
    const result = parser(text);
    if (
      result.link ||
      result.location ||
      result.miniprogram ||
      result.menu ||
      result.businessCard ||
      result.caLink ||
      result.raw
    ) {
      return result;
    }
  }
  return { text };
}
