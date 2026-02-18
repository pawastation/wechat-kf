/**
 * Plugin runtime reference
 * Stores the PluginRuntime provided by OpenClaw gateway at startup.
 */

export interface PluginRuntime {
  channel: {
    media: { saveMediaBuffer: (...args: any[]) => Promise<{ path: string }> };
    routing: { resolveAgentRoute: (opts: any) => { sessionKey: string; agentId: string } };
    reply: {
      resolveEnvelopeFormatOptions: (cfg: any) => any;
      formatAgentEnvelope: (opts: any) => string;
      finalizeInboundContext: (opts: any) => any;
      createReplyDispatcherWithTyping: (opts: any) => any;
      dispatchReplyFromConfig: (opts: any) => Promise<any>;
      resolveHumanDelayConfig: (cfg: any, agentId: string) => any;
    };
    text: {
      resolveTextChunkLimit: (...args: any[]) => number;
      resolveChunkMode: (...args: any[]) => any;
      chunkTextWithMode: (text: string, limit: number, mode: any) => string[];
    };
  };
  system: {
    enqueueSystemEvent: (message: string, opts: any) => void;
  };
  [key: string]: any;
}

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
