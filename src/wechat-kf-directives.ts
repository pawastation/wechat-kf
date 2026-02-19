/**
 * WeChat KF directive parser
 *
 * Parses [[wechat_link: title | desc | url | thumbUrl]] directives
 * embedded in agent text replies. The framework doesn't recognize these
 * directives, so the text arrives intact for plugin-level interception.
 *
 * Syntax (pipe-separated fields):
 *   [[wechat_link: title | url]]                      → 2 fields
 *   [[wechat_link: title | desc | url]]               → 3 fields
 *   [[wechat_link: title | desc | url | thumbUrl]]    → 4 fields
 */

export type WechatLinkDirective = {
  title: string;
  desc?: string;
  url: string;
  thumbUrl?: string;
};

export type WechatDirectiveResult = {
  text: string;
  link?: WechatLinkDirective;
};

const DIRECTIVE_RE = /\[\[wechat_link:([^\]]+)\]\]/i;

/**
 * Quick check whether text contains a `[[wechat_link:...]]` directive.
 */
export function hasWechatLinkDirective(text: string): boolean {
  return DIRECTIVE_RE.test(text);
}

/**
 * Extract the first `[[wechat_link:...]]` directive from text.
 *
 * Returns the remaining text (with directive stripped and trimmed)
 * plus the parsed link fields. If parsing fails (e.g. invalid URL),
 * returns the original text unchanged with no link.
 */
export function parseWechatLinkDirective(text: string): WechatDirectiveResult {
  const match = DIRECTIVE_RE.exec(text);
  if (!match) {
    return { text };
  }

  const parts = match[1].split("|").map((s) => s.trim());
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

  if (!link) {
    return { text };
  }

  // Strip the directive from text and clean up whitespace
  const stripped = text
    .replace(match[0], "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text: stripped, link };
}

function isValidUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}
