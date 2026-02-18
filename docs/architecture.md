# Architecture

## Overview

```
WeChat User → 微信客服入口 → WeCom Server → [HTTP callback] → wechat-kf plugin → OpenClaw Agent
                                            ← [send_msg API] ← wechat-kf plugin ←
```

## Components

### webhook.ts — HTTP Server
- `GET` handler: URL verification (decrypt echostr)
- `POST` handler: receive encrypted callback → verify → decrypt → trigger sync

### crypto.ts — WeChat Crypto
- `computeSignature` / `verifySignature`: SHA1 signature
- `encrypt` / `decrypt`: AES-256-CBC with PKCS#7 padding

### token.ts — Access Token Manager
- In-memory cache per account (corpId+appSecret)
- Auto-refresh 5 min before expiry

### api.ts — WeCom API Client
- `syncMessages`: pull messages via sync_msg
- `sendTextMessage`: send text via send_msg

### accounts.ts — Multi-Account Manager
- Resolves account config from `channels.wechat-kf.accounts.<id>`
- Merges channel-level defaults (corpId, webhookPort, etc.)

### bot.ts — Message Processor
- Called on webhook event
- Pulls messages via sync_msg with cursor tracking
- Filters customer messages (origin=3)
- Injects into OpenClaw via `runtime.channel.inbound.inject`

### monitor.ts — Lifecycle Manager
- Starts webhook server
- Validates access_token
- Handles abort signal for graceful shutdown

### channel.ts — ChannelPlugin
- Implements full ChannelPlugin interface
- Multi-account config adapter
- Gateway startAccount entry point
- Status tracking

### outbound.ts — Send Messages
- `sendText`: send text to WeChat user
- `sendMedia`: fallback to text with URL (Phase 1)

## Multi-Account Config

```json5
{
  channels: {
    "wechat-kf": {
      corpId: "wwXXXX",          // shared across accounts
      webhookPort: 9999,
      webhookPath: "/wechat-kf",
      accounts: {
        main: {
          appSecret: "...",
          token: "...",
          encodingAESKey: "...",
          openKfId: "wkXXXX",
        }
      }
    }
  }
}
```

## Message Flow

1. WeCom POST callback → webhook.ts verifies + decrypts
2. bot.ts calls sync_msg with cursor
3. For each customer message: inject into OpenClaw runtime
4. Agent processes → outbound.ts sends reply via send_msg API

## State

- **Cursor**: persisted to `runtime.state.resolveStateDir()` for incremental sync
- **Access token**: in-memory cache, auto-refreshed

## WeCom API Constraints

- **48-hour reply window**: agents can only reply to a user within 48 hours of the user's last message
- **5-message limit**: maximum 5 replies per 48-hour window per user session
- **No proactive messaging**: the agent cannot initiate conversations; the user must message first
