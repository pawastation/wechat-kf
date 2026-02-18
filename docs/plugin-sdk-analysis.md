# OpenClaw ChannelPlugin SDK Analysis

Based on analysis of the feishu plugin implementation.

## ChannelPlugin Interface

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `ChannelId` (string) | Unique channel identifier, e.g. `"wechat-kf"` |
| `meta` | `ChannelMeta` | Display metadata for UI |
| `capabilities` | `ChannelCapabilities` | Feature flags |
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
  media: boolean;           // Can send/receive media
  reactions: boolean;       // Emoji reactions
  threads: boolean;         // Thread support
  polls: boolean;           // Poll support
  nativeCommands: boolean;  // Platform slash commands
  blockStreaming: boolean;   // Block streaming responses
}
```

### ChannelConfigAdapter

```ts
{
  listAccountIds(cfg): string[];
  resolveAccount(cfg, accountId?): ResolvedAccount;
  defaultAccountId(): string;
  setAccountEnabled({ cfg, accountId, enabled }): Config;
  deleteAccount({ cfg, accountId }): Config;
  isConfigured(account): boolean;
  describeAccount(account): object;
  resolveAllowFrom({ cfg, accountId }): string[];
  formatAllowFrom({ allowFrom }): string[];
}
```

## Important Optional Fields

### `outbound`: ChannelOutboundAdapter

Handles sending messages from agent to user.

```ts
{
  deliveryMode: "direct" | "queued";
  chunker?: (text) => string[];
  chunkerMode?: "split" | "none";
  textChunkLimit?: number;
  sendText({ cfg, to, text, accountId, ... }): Promise<SendResult>;
  sendMedia({ cfg, to, text, mediaUrl, ... }): Promise<SendResult>;
}
```

### `gateway`: ChannelGatewayAdapter

Entry point for starting the channel runtime.

```ts
{
  startAccount(ctx: GatewayAccountContext): Promise<void>;
}
```

`GatewayAccountContext` provides:
- `cfg` — full ClawdbotConfig
- `accountId` — which account to start
- `abortSignal` — for graceful shutdown
- `runtime` — access to OpenClaw runtime APIs
- `log` — structured logger
- `setStatus(snapshot)` — update runtime status

### `configSchema`

JSON Schema for the channel's config section. Used for validation and UI generation.

### Other Optional Fields

- `setup` — account setup wizard helpers
- `security` — auth/pairing logic
- `messaging` — message formatting customization
- `agentPrompt` — hints for the agent about this channel
- `status` — runtime status tracking
- `reload` — config hot-reload prefixes
- `pairing` — device pairing logic

## Lifecycle

1. **Gateway startup** → calls `gateway.startAccount(ctx)` for each enabled account
2. **startAccount** launches a monitor (webhook server, WebSocket, or polling loop)
3. **Inbound message** → construct inbound context → call `dispatchReplyFromConfig`
4. **Agent reply** → routed through `outbound.sendText` / `outbound.sendMedia`

## Key Runtime Methods

| Method | Purpose |
|--------|---------|
| `runtime.channel.routing.resolveAgentRoute` | Route to correct agent/session |
| `runtime.channel.reply.formatAgentEnvelope` | Format message envelope |
| `runtime.channel.reply.finalizeInboundContext` | Build complete inbound context |
| `runtime.channel.reply.dispatchReplyFromConfig` | Dispatch to agent for processing |
| `runtime.channel.inbound.inject` | Simplified inbound message injection |
| `runtime.system.enqueueSystemEvent` | Queue system events |
| `runtime.state.resolveStateDir` | Get persistent state directory |

## Multi-Account Pattern

Feishu uses a `channels.feishu.accounts` map:

```json5
{
  channels: {
    feishu: {
      accounts: {
        main: { appId: "...", appSecret: "..." },
        staging: { appId: "...", appSecret: "..." }
      }
    }
  }
}
```

Each account gets its own `startAccount(ctx)` call with a distinct `accountId`.
`listAccountIds` returns all account keys.
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
