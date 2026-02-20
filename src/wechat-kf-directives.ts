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

// ── Markdown-aware protection ranges ──

export type ProtectedRange = { start: number; end: number }; // [start, end)

/**
 * Scan text left-to-right and collect ranges that should be treated as
 * "protected" — i.e. directive syntax inside them must be ignored.
 *
 * Three zone types (checked in priority order):
 *  1. Fenced code blocks (``` or ~~~, with optional 0-3 leading spaces + lang tag)
 *  2. Inline code spans (backtick sequences, matching equal-length closer)
 *  3. Blockquote lines (line starting with optional whitespace + `>`)
 */
export function findProtectedRanges(text: string): ProtectedRange[] {
  const ranges: ProtectedRange[] = [];
  let i = 0;
  const len = text.length;

  // Helper: are we at the start of a line (i === 0 or text[i-1] === '\n')?
  const atLineStart = (pos: number): boolean => pos === 0 || text[pos - 1] === "\n";

  while (i < len) {
    // ── 1. Fenced code block ──
    // Must be at line start; 0-3 leading spaces allowed before ``` or ~~~
    if (atLineStart(i)) {
      let spaces = 0;
      let si = i;
      while (si < len && text[si] === " " && spaces < 4) {
        spaces++;
        si++;
      }
      if (spaces < 4 && si < len) {
        const fenceChar = text[si];
        if (fenceChar === "`" || fenceChar === "~") {
          let fenceLen = 0;
          const fenceStart = si;
          while (si < len && text[si] === fenceChar) {
            fenceLen++;
            si++;
          }
          if (fenceLen >= 3) {
            // Skip optional language tag — rest of the opening line
            while (si < len && text[si] !== "\n") si++;
            if (si < len) si++; // skip the \n

            // Find closing fence: same char, >= same length, at line start with 0-3 spaces
            const blockStart = i;
            let closed = false;
            while (si < len) {
              if (atLineStart(si)) {
                let cs = 0;
                let ci = si;
                while (ci < len && text[ci] === " " && cs < 4) {
                  cs++;
                  ci++;
                }
                if (cs < 4 && ci < len && text[ci] === fenceChar) {
                  let cl = 0;
                  while (ci < len && text[ci] === fenceChar) {
                    cl++;
                    ci++;
                  }
                  // Closing fence: >= opening length, rest of line is only whitespace
                  if (cl >= fenceLen) {
                    let trailing = true;
                    while (ci < len && text[ci] !== "\n") {
                      if (text[ci] !== " " && text[ci] !== "\t") {
                        trailing = false;
                        break;
                      }
                      ci++;
                    }
                    if (trailing) {
                      // Include the closing fence line
                      if (ci < len) ci++; // include \n
                      ranges.push({ start: blockStart, end: ci });
                      i = ci;
                      closed = true;
                      break;
                    }
                  }
                }
              }
              // Advance to next line
              while (si < len && text[si] !== "\n") si++;
              if (si < len) si++;
            }
            if (!closed) {
              // Unclosed fenced block → protect to end
              ranges.push({ start: blockStart, end: len });
              i = len;
            }
            continue;
          }
          // Less than 3 fence chars — not a fenced block, fall through
          i = fenceStart; // reset to the fence char position for further checks
        }
      }

      // ── 3. Blockquote line (checked at line start, after fenced block check) ──
      // Leading spaces/tabs + `>`
      let qi = i;
      while (qi < len && (text[qi] === " " || text[qi] === "\t")) qi++;
      if (qi < len && text[qi] === ">") {
        const lineStart = i;
        // Protect entire line
        let lineEnd = qi + 1;
        while (lineEnd < len && text[lineEnd] !== "\n") lineEnd++;
        if (lineEnd < len) lineEnd++; // include \n
        ranges.push({ start: lineStart, end: lineEnd });
        i = lineEnd;
        continue;
      }
    }

    // ── 2. Inline code span ──
    if (text[i] === "`") {
      // Count opening backticks
      let openLen = 0;
      const spanStart = i;
      while (i < len && text[i] === "`") {
        openLen++;
        i++;
      }
      // Search for matching equal-length closing backtick sequence
      let found = false;
      while (i < len) {
        if (text[i] === "`") {
          let closeLen = 0;
          while (i < len && text[i] === "`") {
            closeLen++;
            i++;
          }
          if (closeLen === openLen) {
            ranges.push({ start: spanStart, end: i });
            found = true;
            break;
          }
          // Not matching length — continue searching
        } else {
          i++;
        }
      }
      if (!found) {
        // Unclosed inline code → not protected (CommonMark behavior)
        i = spanStart + openLen;
      }
      continue;
    }

    i++;
  }
  return ranges;
}

function isProtected(position: number, ranges: ProtectedRange[]): boolean {
  for (const r of ranges) {
    if (r.start > position) return false; // early break — ranges are sorted
    if (position >= r.start && position < r.end) return true;
  }
  return false;
}

// ── Generic directive finder ──

function findDirective(
  text: string,
  prefix: string,
  protectedRanges?: ProtectedRange[],
): { inner: string; startIdx: number; endIdx: number } | null {
  const lower = text.toLowerCase();
  const ranges = protectedRanges ?? findProtectedRanges(text);
  let searchFrom = 0;
  while (searchFrom < lower.length) {
    const startIdx = lower.indexOf(prefix, searchFrom);
    if (startIdx === -1) return null;
    const contentStart = startIdx + prefix.length;
    const endIdx = lower.indexOf(DIRECTIVE_END, contentStart);
    if (endIdx === -1) return null;
    if (isProtected(startIdx, ranges)) {
      searchFrom = endIdx + DIRECTIVE_END.length;
      continue;
    }
    return { inner: text.slice(contentStart, endIdx), startIdx, endIdx };
  }
  return null;
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
 * Quick check whether text contains a `[[wechat_link:...]]` directive
 * outside of markdown code blocks, inline code, and blockquotes.
 */
export function hasWechatLinkDirective(text: string): boolean {
  return findDirective(text, LINK_PREFIX) !== null;
}

/**
 * Extract the first `[[wechat_link:...]]` directive from text.
 *
 * Returns the remaining text (with directive stripped and trimmed)
 * plus the parsed link fields. If parsing fails (e.g. invalid URL),
 * returns the original text unchanged with no link.
 */
export function parseWechatLinkDirective(text: string, protectedRanges?: ProtectedRange[]): WechatDirectiveResult {
  const found = findDirective(text, LINK_PREFIX, protectedRanges);
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

export function parseWechatLocationDirective(text: string, protectedRanges?: ProtectedRange[]): WechatDirectiveResult {
  const found = findDirective(text, LOCATION_PREFIX, protectedRanges);
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

export function parseWechatMiniprogramDirective(
  text: string,
  protectedRanges?: ProtectedRange[],
): WechatDirectiveResult {
  const found = findDirective(text, MINIPROGRAM_PREFIX, protectedRanges);
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

export function parseWechatMenuDirective(text: string, protectedRanges?: ProtectedRange[]): WechatDirectiveResult {
  const found = findDirective(text, MENU_PREFIX, protectedRanges);
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

export function parseWechatBusinessCardDirective(
  text: string,
  protectedRanges?: ProtectedRange[],
): WechatDirectiveResult {
  const found = findDirective(text, BUSINESS_CARD_PREFIX, protectedRanges);
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

export function parseWechatCaLinkDirective(text: string, protectedRanges?: ProtectedRange[]): WechatDirectiveResult {
  const found = findDirective(text, CA_LINK_PREFIX, protectedRanges);
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

export function parseWechatRawDirective(text: string, protectedRanges?: ProtectedRange[]): WechatDirectiveResult {
  const found = findDirective(text, RAW_PREFIX, protectedRanges);
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
 * Quick check whether text contains any `[[wechat_*:...]]` directive
 * outside of markdown code blocks, inline code, and blockquotes.
 */
export function hasWechatDirective(text: string): boolean {
  const ranges = findProtectedRanges(text);
  return ALL_PREFIXES.some((prefix) => findDirective(text, prefix, ranges) !== null);
}

/**
 * Parse the first matching directive from text.
 * Tries parsers in order: link → location → miniprogram → menu → business_card → ca_link → raw.
 * Returns the first successful parse result.
 * Directives inside markdown code blocks, inline code, or blockquotes are ignored.
 */
export function parseWechatDirective(text: string): WechatDirectiveResult {
  const protectedRanges = findProtectedRanges(text);
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
    const result = parser(text, protectedRanges);
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
