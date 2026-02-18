/**
 * Account resolution for WeChat KF
 *
 * Accounts are dynamically discovered from webhook callbacks.
 * Each openKfId becomes an independent accountId (like Telegram chat groups).
 * Enterprise credentials (corpId, appSecret, token, encodingAESKey) are shared.
 */

import type { OpenClawConfig, WechatKfConfig, ResolvedWechatKfAccount } from "./types.js";
import { readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { atomicWriteFile } from "./fs-utils.js";

const DEFAULT_PORT = 9999;
const DEFAULT_PATH = "/wechat-kf";

/** In-memory set of discovered kfids */
const discoveredKfIds = new Set<string>();
/** In-memory set of disabled kfids (persisted to disk) */
const disabledKfIds = new Set<string>();
let stateDir: string | null = null;

export function setStateDir(dir: string): void {
  stateDir = dir;
}

export function getChannelConfig(cfg: OpenClawConfig): WechatKfConfig {
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

/** Get all known kfids that are currently enabled */
export function getEnabledKfIds(): string[] {
  return Array.from(discoveredKfIds).filter((id) => !disabledKfIds.has(id));
}

/** Check whether a kfid is enabled (not in the disabled set) */
export function isKfIdEnabled(kfId: string): boolean {
  return !disabledKfIds.has(resolveKfId(kfId));
}

/** Disable a kfid (add to disabled set). Returns true if the state changed. */
export async function disableKfId(kfId: string): Promise<boolean> {
  if (!kfId) return false;
  const resolved = resolveKfId(kfId);
  if (disabledKfIds.has(resolved)) return false;
  disabledKfIds.add(resolved);
  await persistDisabledKfIds();
  return true;
}

/** Enable a previously disabled kfid. Returns true if the state changed. */
export async function enableKfId(kfId: string): Promise<boolean> {
  if (!kfId) return false;
  const resolved = resolveKfId(kfId);
  if (!disabledKfIds.has(resolved)) return false;
  disabledKfIds.delete(resolved);
  await persistDisabledKfIds();
  return true;
}

/**
 * Delete a kfid entirely — removes from discovered set and adds to disabled set
 * so it won't be re-activated if the webhook delivers it again before restart.
 * Returns true if the kfid was known (and thus actually removed).
 */
export async function deleteKfId(kfId: string): Promise<boolean> {
  if (!kfId) return false;
  const resolved = resolveKfId(kfId);
  const wasKnown = discoveredKfIds.has(resolved);
  discoveredKfIds.delete(resolved);
  disabledKfIds.add(resolved);
  await persistKfIds();
  await persistDisabledKfIds();
  return wasKnown;
}

/**
 * Resolve a potentially lowercased kfId to its original-case form.
 * Falls back to the input if no match is found in the discovered set.
 */
function resolveKfId(kfId: string): string {
  // Direct match — fast path
  if (discoveredKfIds.has(kfId) || disabledKfIds.has(kfId)) return kfId;
  // Case-insensitive lookup in discovered set
  for (const id of discoveredKfIds) {
    if (id.toLowerCase() === kfId.toLowerCase()) return id;
  }
  // Case-insensitive lookup in disabled set
  for (const id of disabledKfIds) {
    if (id.toLowerCase() === kfId.toLowerCase()) return id;
  }
  return kfId;
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
  try {
    const data = await readFile(join(dir, "wechat-kf-disabled-kfids.json"), "utf8");
    const ids = JSON.parse(data);
    if (Array.isArray(ids)) {
      for (const id of ids) disabledKfIds.add(id);
    }
  } catch {
    // No persisted disabled state yet, that's fine
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

/** Persist disabled kfids to state dir */
async function persistDisabledKfIds(): Promise<void> {
  if (!stateDir) return;
  try {
    await mkdir(stateDir, { recursive: true });
    await atomicWriteFile(
      join(stateDir, "wechat-kf-disabled-kfids.json"),
      JSON.stringify(Array.from(disabledKfIds)),
    );
  } catch {
    // Best effort
  }
}

export function listAccountIds(cfg: OpenClawConfig): string[] {
  // Return discovered kfids as account ids, excluding disabled ones
  const ids = getEnabledKfIds();
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
  disabledKfIds.clear();
  stateDir = null;
}

export function resolveAccount(cfg: OpenClawConfig, accountId?: string): ResolvedWechatKfAccount {
  const config = getChannelConfig(cfg);
  const id = accountId ?? "default";

  const corpId = config.corpId;
  const appSecret = config.appSecret;
  const token = config.token;
  const encodingAESKey = config.encodingAESKey;
  const kfIdDisabled = id !== "default" && !isKfIdEnabled(id);
  const enabled = kfIdDisabled ? false : (config.enabled ?? false);
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
