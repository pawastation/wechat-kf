/**
 * Plugin runtime reference
 * Stores the PluginRuntime provided by OpenClaw gateway at startup.
 */

import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setRuntime(next: PluginRuntime): void {
  runtime = next;
}

export function getRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("[wechat-kf] runtime not initialized — plugin not started via gateway?");
  }
  return runtime;
}

/**
 * Reset the module-level runtime reference to null.
 * @internal Exposed for testing only — allows test isolation between runs.
 */
export function _reset(): void {
  runtime = null;
}
