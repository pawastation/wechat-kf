/**
 * HTTP webhook server for WeChat KF callbacks
 *
 * Handles:
 * - GET: URL verification (echostr decrypt)
 * - POST: Event notification (decrypt XML → trigger sync_msg)
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { verifySignature, decrypt } from "./crypto.js";

export type WebhookHandler = (openKfId: string, token: string) => void | Promise<void>;

export type WebhookOptions = {
  port: number;
  path: string;
  callbackToken: string;
  encodingAESKey: string;
  corpId: string;
  onEvent: WebhookHandler;
};

function parseQuery(url: string): Record<string, string> {
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

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Extract a tag value from XML string */
function xmlTag(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}><!\\[CDATA\\[(.+?)\\]\\]></${tag}>|<${tag}>(.+?)</${tag}>`);
  const m = xml.match(re);
  return m?.[1] ?? m?.[2];
}

export function createWebhookServer(opts: WebhookOptions): Server {
  const { path, callbackToken, encodingAESKey, onEvent } = opts;

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "/";
    const pathname = url.split("?")[0];

    if (pathname !== path) {
      res.writeHead(404);
      res.end("not found");
      return;
    }

    const query = parseQuery(url);

    try {
      if (req.method === "GET") {
        // URL verification
        const { msg_signature, timestamp, nonce, echostr } = query;
        if (!msg_signature || !timestamp || !nonce || !echostr) {
          res.writeHead(400);
          res.end("missing params");
          return;
        }

        if (!verifySignature(callbackToken, timestamp, nonce, echostr, msg_signature)) {
          res.writeHead(403);
          res.end("signature mismatch");
          return;
        }

        const { message } = decrypt(encodingAESKey, echostr);
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(message);
        return;
      }

      if (req.method === "POST") {
        const { msg_signature, timestamp, nonce } = query;
        const body = await readBody(req);

        // Extract Encrypt from XML
        const encryptedMsg = xmlTag(body, "Encrypt");
        if (!encryptedMsg || !msg_signature || !timestamp || !nonce) {
          res.writeHead(400);
          res.end("bad request");
          return;
        }

        if (!verifySignature(callbackToken, timestamp, nonce, encryptedMsg, msg_signature)) {
          res.writeHead(403);
          res.end("signature mismatch");
          return;
        }

        const { message } = decrypt(encodingAESKey, encryptedMsg);

        // Parse decrypted XML for Token and OpenKfId
        const eventToken = xmlTag(message, "Token") ?? "";
        const openKfId = xmlTag(message, "OpenKfId") ?? "";

        // Respond immediately, process async
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("success");

        // Trigger message sync
        Promise.resolve(onEvent(openKfId, eventToken)).catch((err: unknown) => {
          console.error("[wechat-kf] onEvent error:", err);
        });
        return;
      }

      res.writeHead(405);
      res.end("method not allowed");
    } catch (err) {
      console.error("[wechat-kf] webhook error:", err);
      res.writeHead(500);
      res.end("internal error");
    }
  });

  return server;
}
