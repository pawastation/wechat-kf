/**
 * Monitor — starts webhook server and manages lifecycle
 *
 * Single webhook server for the enterprise. KfIds are discovered dynamically
 * from webhook callbacks. Polling fallback iterates all known kfids.
 */

import type { Server } from "node:http";
import { createWebhookServer } from "./webhook.js";
import { getAccessToken } from "./token.js";
import { handleWebhookEvent, type BotContext } from "./bot.js";
import { getChannelConfig, loadKfIds, getKnownKfIds } from "./accounts.js";

export type MonitorContext = {
  cfg: any;
  runtime?: any;
  abortSignal?: AbortSignal;
  stateDir: string;
  log?: { info: (...a: any[]) => void; error: (...a: any[]) => void; warn?: (...a: any[]) => void };
};

export async function startMonitor(ctx: MonitorContext): Promise<Server> {
  const { cfg, runtime, abortSignal, stateDir, log } = ctx;
  const config = getChannelConfig(cfg);
  const { corpId, appSecret, token, encodingAESKey } = config;
  const webhookPort = config.webhookPort ?? 9999;
  const webhookPath = config.webhookPath ?? "/wechat-kf";

  if (!corpId || !appSecret || !token || !encodingAESKey) {
    throw new Error("[wechat-kf] missing required config fields (corpId, appSecret, token, encodingAESKey)");
  }

  // Load previously discovered kfids
  await loadKfIds(stateDir);

  // Validate access token on startup
  try {
    await getAccessToken(corpId, appSecret);
    log?.info(`[wechat-kf] access_token validated`);
  } catch (err) {
    log?.warn?.(`[wechat-kf] access_token validation failed (will retry on first message): ${err}`);
  }

  const botCtx: BotContext = { cfg, runtime, stateDir, log };

  const server = createWebhookServer({
    port: webhookPort,
    path: webhookPath,
    callbackToken: token,
    encodingAESKey,
    corpId,
    onEvent: async (kfId, syncToken) => {
      if (!kfId) {
        log?.error("[wechat-kf] webhook callback missing OpenKfId, ignoring");
        return;
      }
      try {
        await handleWebhookEvent(botCtx, kfId, syncToken);
      } catch (err) {
        log?.error(`[wechat-kf:${kfId}] event processing error: ${err}`);
      }
    },
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`[wechat-kf] server.listen(:${webhookPort}) timed out`)), 10_000);
    server.listen(webhookPort, () => {
      clearTimeout(timeout);
      log?.info(`[wechat-kf] webhook listening on :${webhookPort}${webhookPath}`);
      resolve();
    });
    server.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  // ── Polling fallback ──
  // Poll sync_msg for each known kfid as fallback
  const POLL_INTERVAL_MS = 30000;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let polling = false;

  pollTimer = setInterval(async () => {
    if (polling) return;
    polling = true;
    try {
      const kfIds = getKnownKfIds();
      if (kfIds.length === 0) {
        // No kfids discovered yet, nothing to poll
        return;
      }
      for (const kfId of kfIds) {
        try {
          log?.info(`[wechat-kf:${kfId}] polling sync_msg...`);
          await handleWebhookEvent(botCtx, kfId, "");
        } catch (err) {
          log?.error(`[wechat-kf:${kfId}] poll error: ${err instanceof Error ? err.stack || err.message : err}`);
        }
      }
    } finally {
      polling = false;
    }
  }, POLL_INTERVAL_MS);

  log?.info(`[wechat-kf] polling fallback enabled (every ${POLL_INTERVAL_MS}ms)`);

  if (abortSignal) {
    abortSignal.addEventListener("abort", () => {
      if (pollTimer) clearInterval(pollTimer);
      server.close();
      log?.info("[wechat-kf] webhook server + polling stopped");
    }, { once: true });
  }

  return server;
}
