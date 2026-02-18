# OpenClaw ChannelPlugin SDK Analysis

> Updated 2026-02-18 based on OpenClaw source code analysis (previously based on feishu plugin reverse-engineering).

## ChannelPlugin Interface

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `ChannelId` (string) | Unique channel identifier, e.g. `"wechat-kf"` |
| `meta` | `ChannelMeta` | Display metadata for UI |
| `capabilities` | `ChannelCapabilities` | Feature flags (declarative only — does not affect routing) |
| `config` | `ChannelConfigAdapter` | Account config CRUD |

### ChannelMeta

```ts
{
  id: string;
  label: string;           // Short display name
  selectionLabel: string;   // Longer name for selection UIs
  docsPath: string;         // Documentation URL path
  docsLabel: string;        // Documentation link text
  blurb: string;            // One-line description
  aliases?: string[];       // Alternative names for CLI
  order?: number;           // Sort order in lists
}
```

### ChannelCapabilities

```ts
{
  chatTypes: ("direct" | "group")[];
  media: boolean;           // Declarative — tells agent it can send media
  reactions: boolean;       // Emoji reactions
  threads: boolean;         // Thread support
  polls: boolean;           // Poll support
  nativeCommands: boolean;  // Platform slash commands
  blockStreaming: boolean;   // Block streaming responses
}
```

Note: `capabilities.media` is purely declarative. The framework routes based on
`payload.mediaUrls` presence regardless of this flag.

### ChannelConfigAdapter

```ts
{
  listAccountIds(cfg): string[];
  resolveAccount(cfg, accountId?): ResolvedAccount;
  defaultAccountId(cfg): string;
  setAccountEnabled({ cfg, accountId, enabled }): Config;
  deleteAccount({ cfg, accountId }): Config;
  isConfigured(account): boolean;
  describeAccount(account): object;
  resolveAllowFrom({ cfg }): string[];
  formatAllowFrom({ allowFrom }): string[];
}
```

## Adapters

### `outbound`: ChannelOutboundAdapter

Handles sending messages from agent to user.

```ts
{
  deliveryMode: "direct" | "gateway" | "hybrid";
  chunker?: ((text: string, limit: number) => string[]) | null;
  chunkerMode?: "text" | "markdown";
  textChunkLimit?: number;
  sendText({ cfg, to, text, accountId }): Promise<SendResult>;
  sendMedia({ cfg, to, text, mediaUrl, mediaPath, accountId }): Promise<SendResult>;
  sendPoll?(...): Promise<SendResult>;     // Optional — poll delivery
  resolveTarget?(...): string;             // Optional — resolve target ID
  sendPayload?(...): Promise<SendResult>;  // Optional — generic payload delivery
}
```

Framework chunking: when `chunker` is declared, the framework calls it to split
text before invoking `sendText` per chunk. When `chunker: null`, `sendText`
receives the full text. `chunkerMode: "text"` means plain text input;
`"markdown"` means markdown-formatted input.

### `gateway`: ChannelGatewayAdapter

Entry point for starting the channel runtime.

```ts
{
  startAccount(ctx: GatewayAccountContext): Promise<void>;
}
```

`GatewayAccountContext` provides:
- `cfg` — full OpenClawConfig
- `accountId` — which account to start
- `abortSignal` — for graceful shutdown
- `runtime` — access to OpenClaw runtime APIs (PluginRuntime)
- `log` — structured logger
- `setStatus(snapshot)` — update runtime status

### `security`: ChannelSecurityAdapter

DM access control. ~17 upstream plugins implement this — standard practice.

```ts
{
  resolveDmPolicy({ cfg, accountId? }): {
    policy: string;                    // e.g. "open" | "pairing" | "allowlist"
    allowFrom: string[];
    allowFromPath: string;             // Config path for allowlist
    approveHint: string;               // Help text for approving users
    normalizeEntry?(raw: string): string;
  };
  collectWarnings({ cfg, accountId? }): string[];
}
```

Note: `config.resolveAllowFrom` is a config query only; actual DM enforcement
happens in inbound handlers (bot.ts).

### `status`: ChannelStatusAdapter

Runtime status tracking for the dashboard.

```ts
{
  defaultRuntime: AccountRuntimeStatus;  // Default status shape
  buildChannelSummary({ snapshot }): object;          // Channel-level summary
  buildAccountSnapshot({ account, runtime }): object; // Per-account snapshot
}
```

### `setup`: ChannelSetupAdapter

Account setup wizard helpers.

```ts
{
  resolveAccountId(cfg, accountId?): string;
  applyAccountConfig({ cfg, accountId }): Config;
}
```

### Other Optional Fields

- `configSchema` — JSON Schema for channel config; used for validation and UI generation
- `agentPrompt` — `{ messageToolHints(): string[] }` — hints for the agent about this channel
- `reload` — `{ configPrefixes: string[] }` — config hot-reload prefixes
- `messaging` — message formatting customization
- `pairing` — device pairing logic

## Lifecycle

1. **Gateway startup** calls `gateway.startAccount(ctx)` for each enabled account
2. **startAccount** launches a monitor (webhook server, WebSocket, or polling loop)
3. **Inbound message** arrives, construct inbound context, call `dispatchReplyFromConfig`
4. **Agent reply** routed through `outbound.sendText` / `outbound.sendMedia`

## Key Runtime Methods (PluginRuntime)

| Method | Purpose |
|--------|---------|
| `runtime.channel.routing.resolveAgentRoute` | Route to correct agent/session |
| `runtime.channel.reply.formatAgentEnvelope` | Format message envelope |
| `runtime.channel.reply.resolveEnvelopeFormatOptions` | Get envelope formatting options |
| `runtime.channel.reply.finalizeInboundContext` | Build complete inbound context |
| `runtime.channel.reply.dispatchReplyFromConfig` | Dispatch to agent for processing |
| `runtime.channel.reply.createReplyDispatcherWithTyping` | Streaming reply with human typing delay |
| `runtime.channel.reply.resolveHumanDelayConfig` | Resolve typing delay config for agent |
| `runtime.channel.text.resolveTextChunkLimit` | Resolve chunk limit (user config or fallback) |
| `runtime.channel.text.resolveChunkMode` | Resolve chunk mode: `"length"` or `"newline"` |
| `runtime.channel.text.chunkTextWithMode` | Chunk text using resolved mode and limit |
| `runtime.channel.media.saveMediaBuffer` | Save inbound media buffer to state dir |
| `runtime.system.enqueueSystemEvent` | Queue system events |
| `runtime.state.resolveStateDir` | Get persistent state directory |

## Multi-Account Pattern

WeChat KF uses dynamically discovered accounts (each `openKfId` is an accountId).
Enterprise credentials (`corpId`, `appSecret`) are shared across all accounts.

```json5
{
  channels: {
    "wechat-kf": {
      corpId: "...",
      appSecret: "...",
      token: "...",
      encodingAESKey: "...",
      // accounts discovered dynamically from webhook callbacks
    }
  }
}
```

Each account gets its own `startAccount(ctx)` call with a distinct `accountId`.
`listAccountIds` returns all discovered KF IDs.
`resolveAccount` merges account-level + channel-level config.

## Plugin Registration

```ts
// index.ts
export default {
  id: "wechat-kf",
  name: "WeChat KF",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    api.registerChannel({ plugin: wechatKfPlugin });
  },
};
```
