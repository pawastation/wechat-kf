/**
 * Plugin runtime reference
 * Stores the PluginRuntime provided by OpenClaw gateway at startup.
 */

import type { OpenClawConfig } from "./types.js";

// ── Sub-types used by PluginRuntime ──

export type SaveMediaResult = { path: string };

export type AgentRoute = { sessionKey: string; agentId: string };

export type ResolveAgentRouteOpts = {
  cfg: OpenClawConfig;
  channel: string;
  accountId: string;
  peer: { kind: string; id: string };
};

export type EnvelopeFormatOptions = Record<string, unknown>;

export type FormatAgentEnvelopeOpts = {
  channel: string;
  from: string;
  timestamp: Date;
  envelope: EnvelopeFormatOptions;
  body: string;
};

export type InboundContext = Record<string, unknown>;

export type FinalizeInboundContextOpts = {
  Body: string;
  RawBody: string;
  CommandBody: string;
  From: string;
  To: string;
  SessionKey: string;
  AccountId: string;
  ChatType: string;
  SenderName: string;
  SenderId: string;
  Provider: string;
  Surface: string;
  MessageSid: string;
  Timestamp: number;
  WasMentioned: boolean;
  CommandAuthorized: boolean;
  OriginatingChannel: string;
  OriginatingTo: string;
  MediaPaths?: string[];
  MediaTypes?: string[];
};

export type HumanDelayConfig = Record<string, unknown>;

export type ReplyPayload = {
  text?: string;
  attachments?: Array<{ path?: string; type?: string; url?: string }>;
};

export type ReplyErrorInfo = {
  kind?: string;
};

export type ReplyDispatcherResult = {
  dispatcher?: unknown;
  replyOptions?: unknown;
  markDispatchIdle?: () => void;
};

export type DispatchReplyResult = {
  queuedFinal?: boolean;
  counts?: { final?: number };
};

export type SystemEventOpts = {
  sessionKey: string;
  contextKey: string;
};

export type ChunkMode = "length" | "newline";

export interface PluginRuntime {
  channel: {
    media: {
      saveMediaBuffer: (
        buffer: Buffer,
        mimeType: string,
        direction: string,
        opts: unknown | undefined,
        filename: string,
      ) => Promise<SaveMediaResult>;
    };
    routing: {
      resolveAgentRoute: (opts: ResolveAgentRouteOpts) => AgentRoute;
    };
    reply: {
      resolveEnvelopeFormatOptions: (cfg: OpenClawConfig) => EnvelopeFormatOptions;
      formatAgentEnvelope: (opts: FormatAgentEnvelopeOpts) => string;
      finalizeInboundContext: (opts: FinalizeInboundContextOpts) => InboundContext;
      createReplyDispatcherWithTyping: (opts: {
        humanDelay: HumanDelayConfig;
        deliver: (payload: ReplyPayload) => Promise<void>;
        onError: (err: unknown, info: ReplyErrorInfo) => void;
      }) => ReplyDispatcherResult;
      dispatchReplyFromConfig: (opts: {
        ctx: InboundContext;
        cfg: OpenClawConfig;
        dispatcher: unknown;
        replyOptions: unknown;
      }) => Promise<DispatchReplyResult>;
      resolveHumanDelayConfig: (cfg: OpenClawConfig, agentId: string) => HumanDelayConfig;
    };
    text: {
      resolveTextChunkLimit: (
        cfg: OpenClawConfig,
        channel: string,
        accountId: string,
        opts: { fallbackLimit: number },
      ) => number;
      resolveChunkMode: (cfg: OpenClawConfig, channel: string) => ChunkMode;
      chunkTextWithMode: (text: string, limit: number, mode: ChunkMode) => string[];
    };
  };
  system: {
    enqueueSystemEvent: (message: string, opts: SystemEventOpts) => void;
  };
  state?: {
    resolveStateDir?: () => string;
  };
  /** Optional error logger exposed by some runtime implementations. */
  error?: (...args: unknown[]) => void;
  [key: string]: unknown;
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

/**
 * Reset the module-level runtime reference to null.
 * @internal Exposed for testing only — allows test isolation between runs.
 */
export function _reset(): void {
  runtime = null;
}
