/**
 * Shared context manager for WeChat KF plugin
 *
 * Provides a rendezvous point between the "default" account (which sets up
 * enterprise-level shared infrastructure) and per-kfId accounts (which need
 * the shared crypto config and BotContext to start polling).
 */

import type { BotContext } from "./bot.js";

export type SharedContext = {
  callbackToken: string;
  encodingAESKey: string;
  corpId: string;
  appSecret: string;
  webhookPath: string;
  botCtx: BotContext;
};

// ── Module-level state ──

let sharedCtx: SharedContext | null = null;
let readyResolve: (() => void) | null = null;
let readyPromise: Promise<void> | null = null;

function ensureReadyPromise(): Promise<void> {
  if (!readyPromise) {
    readyPromise = new Promise<void>((resolve) => {
      readyResolve = resolve;
    });
  }
  return readyPromise;
}

/** Set the shared context. Resolves any pending waitForSharedContext calls. */
export function setSharedContext(ctx: SharedContext): void {
  sharedCtx = ctx;
  // Resolve waiting callers
  if (readyResolve) {
    readyResolve();
    readyResolve = null;
  }
}

/** Get the shared context, or null if not yet set. */
export function getSharedContext(): SharedContext | null {
  return sharedCtx;
}

/**
 * Wait until the shared context is set.
 * Rejects if the signal aborts before the context is ready.
 */
export function waitForSharedContext(signal?: AbortSignal): Promise<SharedContext> {
  // Already available — fast path
  if (sharedCtx) return Promise.resolve(sharedCtx);

  // Already aborted
  if (signal?.aborted) {
    return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
  }

  const ready = ensureReadyPromise();

  return new Promise<SharedContext>((resolve, reject) => {
    const onReady = () => {
      signal?.removeEventListener("abort", onAbort);
      resolve(sharedCtx!);
    };
    const onAbort = () => {
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    ready.then(onReady);
  });
}

/** Clear the shared context (used during shutdown). */
export function clearSharedContext(): void {
  sharedCtx = null;
}

/** Reset all module-level state. @internal For testing only. */
export function _reset(): void {
  sharedCtx = null;
  readyResolve = null;
  readyPromise = null;
}
