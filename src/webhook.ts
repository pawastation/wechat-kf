/**
 * HTTP webhook handler for WeChat KF callbacks
 *
 * Handles:
 * - GET: URL verification (echostr decrypt)
 * - POST: Event notification (decrypt XML → trigger sync_msg)
 *
 * Designed to be registered on the framework's shared gateway server
 * via api.registerHttpHandler(handleWechatKfWebhook).
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { registerKfId } from "./accounts.js";
import { handleWebhookEvent } from "./bot.js";
import { decrypt, verifySignature } from "./crypto.js";
import { getSharedContext } from "./monitor.js";

export function parseQuery(url: string): Record<string, string> {
  const idx = url.indexOf("?");
  if (idx < 0) return {};
  const params: Record<string, string> = {};
  for (const pair of url.slice(idx + 1).split("&")) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx < 0) continue;
    const k = pair.slice(0, eqIdx);
    const v = pair.slice(eqIdx + 1);
    if (k) params[decodeURIComponent(k)] = decodeURIComponent(v);
  }
  return params;
}

export function readBody(req: IncomingMessage, maxSize = 64 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let rejected = false;
    req.on("data", (c: Buffer) => {
      if (rejected) return;
      size += c.length;
      if (size > maxSize) {
        rejected = true;
        // Stop buffering but keep the connection alive so the server
        // can still write a response (413). Resume drains remaining data.
        req.removeAllListeners("data");
        req.resume();
        reject(new Error("[wechat-kf] request body too large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!rejected) resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", (err) => {
      if (!rejected) reject(err);
    });
  });
}

/** Extract a tag value from XML string */
export function xmlTag(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}><!\\[CDATA\\[(.+?)\\]\\]></${tag}>|<${tag}>(.+?)</${tag}>`);
  const m = xml.match(re);
  return m?.[1] ?? m?.[2];
}

/**
 * Framework-compatible HTTP handler for WeChat KF webhooks.
 *
 * Returns `true` if the request was handled, `false` if the path doesn't
 * match (so the framework can try other plugins).
 */
export async function handleWechatKfWebhook(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const ctx = getSharedContext();
  if (!ctx) return false;

  const url = req.url ?? "/";
  const pathname = url.split("?")[0];

  if (pathname !== ctx.webhookPath) return false;

  const query = parseQuery(url);

  try {
    if (req.method === "GET") {
      // URL verification
      const { msg_signature, timestamp, nonce, echostr } = query;
      if (!msg_signature || !timestamp || !nonce || !echostr) {
        res.writeHead(400);
        res.end("missing params");
        return true;
      }

      if (!verifySignature(ctx.callbackToken, timestamp, nonce, echostr, msg_signature)) {
        res.writeHead(403);
        res.end("signature mismatch");
        return true;
      }

      const { message } = decrypt(ctx.encodingAESKey, echostr);
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(message);
      return true;
    }

    if (req.method === "POST") {
      const { msg_signature, timestamp, nonce } = query;
      const body = await readBody(req);

      // Extract Encrypt from XML
      const encryptedMsg = xmlTag(body, "Encrypt");
      if (!encryptedMsg || !msg_signature || !timestamp || !nonce) {
        res.writeHead(400);
        res.end("bad request");
        return true;
      }

      if (!verifySignature(ctx.callbackToken, timestamp, nonce, encryptedMsg, msg_signature)) {
        res.writeHead(403);
        res.end("signature mismatch");
        return true;
      }

      const { message } = decrypt(ctx.encodingAESKey, encryptedMsg);

      // Parse decrypted XML for Token and OpenKfId
      const eventToken = xmlTag(message, "Token") ?? "";
      const openKfId = xmlTag(message, "OpenKfId") ?? "";

      // Respond immediately, process async
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("success");

      // Fire-and-forget: register kfId and trigger message sync
      Promise.resolve(
        (async () => {
          if (openKfId) {
            await registerKfId(openKfId);
          }
          await handleWebhookEvent(ctx.botCtx, openKfId, eventToken);
        })(),
      ).catch((err: unknown) => {
        ctx.botCtx.log?.error("[wechat-kf] webhook event processing error:", err);
      });

      return true;
    }

    res.writeHead(405);
    res.end("method not allowed");
    return true;
  } catch (err) {
    if (err instanceof Error && err.message.includes("body too large")) {
      res.writeHead(413);
      res.end("payload too large");
      return true;
    }
    ctx.botCtx.log?.error("[wechat-kf] webhook error:", err);
    if (!res.headersSent) {
      res.writeHead(500);
      res.end("internal error");
    }
    return true;
  }
}
