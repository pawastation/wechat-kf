/**
 * Account resolution for WeChat KF
 *
 * Accounts are dynamically discovered from webhook callbacks.
 * Each openKfId becomes an independent accountId (like Telegram chat groups).
 * Enterprise credentials (corpId, appSecret, token, encodingAESKey) are shared.
 */

import type { WechatKfConfig, ResolvedWechatKfAccount } from "./types.js";
import { readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { atomicWriteFile } from "./fs-utils.js";

const DEFAULT_PORT = 9999;
const DEFAULT_PATH = "/wechat-kf";

/** In-memory set of discovered kfids */
const discoveredKfIds = new Set<string>();
let stateDir: string | null = null;

export function setStateDir(dir: string): void {
  stateDir = dir;
}

export function getChannelConfig(cfg: Record<string, any>): WechatKfConfig {
  return (cfg.channels?.["wechat-kf"] ?? {}) as WechatKfConfig;
}

/** Register a dynamically discovered kfid */
export async function registerKfId(kfId: string): Promise<void> {
  if (!kfId || discoveredKfIds.has(kfId)) return;
  discoveredKfIds.add(kfId);
  await persistKfIds();
}

/** Get all known kfids */
export function getKnownKfIds(): string[] {
  return Array.from(discoveredKfIds);
}

/** Load persisted kfids from state dir */
export async function loadKfIds(dir: string): Promise<void> {
  stateDir = dir;
  try {
    const data = await readFile(join(dir, "wechat-kf-kfids.json"), "utf8");
    const ids = JSON.parse(data);
    if (Array.isArray(ids)) {
      for (const id of ids) discoveredKfIds.add(id);
    }
  } catch {
    // No persisted state yet, that's fine
  }
}

/** Persist kfids to state dir */
async function persistKfIds(): Promise<void> {
  if (!stateDir) return;
  try {
    await mkdir(stateDir, { recursive: true });
    await atomicWriteFile(
      join(stateDir, "wechat-kf-kfids.json"),
      JSON.stringify(Array.from(discoveredKfIds)),
    );
  } catch {
    // Best effort
  }
}

export function listAccountIds(cfg: Record<string, any>): string[] {
  // Return discovered kfids as account ids
  const ids = getKnownKfIds();
  return ids.length > 0 ? ids : ["default"];
}

/**
 * Recover the original case-sensitive kfId from the normalized (lowercased) accountId.
 * OpenClaw core normalizes accountIds to lowercase, but WeChat KF API requires
 * the original case-sensitive openKfId.
 */
function recoverOriginalKfId(normalizedId: string): string | undefined {
  if (normalizedId === "default") return undefined;
  // Look up the original-case kfId from our discovered set
  for (const kfId of discoveredKfIds) {
    if (kfId.toLowerCase() === normalizedId.toLowerCase()) return kfId;
  }
  // Fallback: return as-is (may fail if case matters)
  return normalizedId;
}

/**
 * Reset all module-level mutable state.
 * @internal Exposed for testing only — allows test isolation between runs.
 */
export function _reset(): void {
  discoveredKfIds.clear();
  stateDir = null;
}

export function resolveAccount(cfg: Record<string, any>, accountId?: string): ResolvedWechatKfAccount {
  const config = getChannelConfig(cfg);
  const id = accountId ?? "default";

  const corpId = config.corpId;
  const appSecret = config.appSecret;
  const token = config.token;
  const encodingAESKey = config.encodingAESKey;
  const enabled = config.enabled ?? false;
  const configured = !!(corpId && appSecret && token && encodingAESKey);

  return {
    accountId: id,
    enabled,
    configured,
    corpId,
    appSecret,
    token,
    encodingAESKey,
    openKfId: recoverOriginalKfId(id),
    webhookPort: config.webhookPort ?? DEFAULT_PORT,
    webhookPath: config.webhookPath ?? DEFAULT_PATH,
    config,
  };
}
