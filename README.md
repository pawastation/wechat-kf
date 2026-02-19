**English** | [中文](./README.zh-CN.md)

# WeChat KF for OpenClaw

[![npm version](https://img.shields.io/npm/v/@pawastation%2Fwechat-kf.svg)](https://www.npmjs.com/package/@pawastation/wechat-kf)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-channel%20plugin-blue.svg)](https://openclaw.dev)

**WeChat Customer Service channel plugin for OpenClaw** — let WeChat users chat with your AI agent via the WeCom KF API. Zero runtime dependencies — uses only Node.js built-ins.

---

## Features

- **Inbound message handling** — receive text, image, voice, video, file, location, link, mini-program, channels, business card, and forwarded chat history from WeChat users (11+ message types)
- **Event handling** — processes enter_session, msg_send_fail, and servicer_status_change events
- **Rich outbound messaging** — send text, image, voice, video, file, and link messages back to users
- **Media upload & download** — automatically downloads inbound media and uploads outbound media via the WeCom temporary media API; supports HTTP URL download for outbound media
- **Markdown to Unicode formatting** — converts markdown bold/italic/headings/lists to Unicode Mathematical Alphanumeric symbols for styled plain-text display in WeChat
- **AES-256-CBC encryption** — full WeChat callback encryption/decryption with SHA-1 signature verification and PKCS#7 padding validation
- **Webhook + polling fallback** — HTTP webhook server for real-time callbacks, with automatic 30-second polling fallback for reliability; hardened with body size limits, method validation, and error responses
- **Dynamic KF account discovery** — KF account IDs (open_kfid) are automatically discovered from webhook callbacks with enable/disable/delete lifecycle management
- **Cursor-based incremental sync** — persists sync cursors per KF account with atomic file writes for crash safety
- **Access token auto-caching** — tokens cached in memory with hashed keys, automatic refresh 5 minutes before expiry, and auto-retry on token expiry
- **Multi-KF-account isolation** — each KF account gets its own session, cursor, and routing context with per-kfId processing mutex
- **DM policy control** — configurable access control: `open` or `allowlist` with security adapter (resolveDmPolicy, collectWarnings). `pairing` mode is not yet implemented.
- **Text chunking** — automatically splits long replies to respect WeChat's 2000-character message size limit, with chunker declaration for framework integration
- **Session limit awareness** — detects and gracefully handles WeChat's 48-hour reply window and 5-message-per-window limits
- **Race condition safety** — per-kfId mutex and msgid deduplication prevent duplicate message processing
- **Human-like reply delays** — configurable typing delay simulation for natural conversation pacing
- **Graceful shutdown** — responds to abort signals with pre-check guards, cleanly stopping the webhook server and polling

## Prerequisites

1. A **WeCom account** (企业微信) with admin privileges — [Register here](https://work.weixin.qq.com/)
2. At least one **Customer Service account** (客服账号) created in WeCom's WeChat Customer Service module
3. A **publicly accessible URL** for receiving callbacks — you can use [ngrok](https://ngrok.com/), [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/), or a server with a public IP
4. **OpenClaw Gateway** installed and running (`openclaw gateway start`)

## Installation

```bash
openclaw plugins install @pawastation/wechat-kf
```

## WeCom Setup Guide

The WeChat KF API supports **two integration methods**. Both share the same underlying API (`sync_msg`, `send_msg`, etc.) and this plugin is fully compatible with either.

### Method comparison

|                              | Method 1: WeCom Admin Self-built App                                            | Method 2: WeChat KF Admin API Hosting              |
| ---------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------- |
| **Admin console**            | [WeCom Admin](https://work.weixin.qq.com/wework_admin/frame)                    | [WeChat KF Admin](https://work.weixin.qq.com/kf/)  |
| **Secret source**            | Self-built app secret                                                           | WeChat KF dedicated secret                         |
| **Callback config location** | WeCom Admin > WeChat KF > API > Callback settings                               | WeChat KF Admin > Dev Config > Callback settings   |
| **Callback URL requirement** | Must use a verified corporate domain (trusted domain configured in WeCom Admin) | No restriction — any publicly accessible URL works |
| **Requires self-built app**  | Yes — create an app and grant KF API permissions                                | No — configure directly in the KF admin console    |
| **IP whitelist**             | Required (self-built app security requirement)                                  | Not required                                       |
| **API scope**                | Full — can call other WeCom APIs alongside KF                                   | Limited to WeChat KF APIs only                     |
| **Best for**                 | Teams with existing WeCom integrations                                          | Developers who only need AI customer service       |
| **Complexity**               | Higher — create app, grant permissions, configure IP whitelist                  | Lower — enable API and go                          |

> **Important:** The two methods are **mutually exclusive** — a KF account can only be managed through one method at a time. To switch, you must first unbind the current API integration.

### Required credentials

Regardless of which method you choose, you need these four values for the plugin configuration:

| Credential                            | Where to find it                                                                                               |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Corp ID** (`corpId`)                | WeCom Admin > My Enterprise > Enterprise ID (format: `wwXXXXXXXXXXXXXXXX`)                                     |
| **App Secret** (`appSecret`)          | Method 1: WeCom Admin > App Management > App Details > Secret; Method 2: WeChat KF Admin > Dev Config > Secret |
| **Token** (`token`)                   | Generated when configuring callback URL (any random string, up to 32 chars)                                    |
| **EncodingAESKey** (`encodingAESKey`) | Generated when configuring callback URL (43-char string)                                                       |

### Detailed setup instructions

Since the WeCom and WeChat KF admin consoles are entirely in Chinese, detailed step-by-step setup instructions are provided in the [Chinese guide](./README.zh-CN.md#企业微信客服接入指南). The guide covers:

- **Method 1** (企业微信后台自建应用): Creating a self-built app, granting KF permissions, configuring callback URL and IP whitelist (6 steps)
- **Method 2** (微信客服后台 API 托管): Enabling the API directly from the KF admin console (5 steps)
- A detailed comparison table of both methods

## Configuration

Add the following to your OpenClaw config (`~/.openclaw/openclaw.yaml` or via `openclaw config`):

```yaml
channels:
  wechat-kf:
    enabled: true
    corpId: "wwXXXXXXXXXXXXXXXX" # Your Corp ID
    appSecret: "your-app-secret-here" # App Secret (self-built app or WeChat KF secret)
    token: "your-callback-token" # Callback Token
    encodingAESKey: "your-43-char-key" # Callback EncodingAESKey (43 characters)
    webhookPort: 9999 # Local port for webhook server (default: 9999)
    webhookPath: "/wechat-kf" # URL path for webhook (default: /wechat-kf)
    dmPolicy: "open" # Access control: open | allowlist (pairing: not yet implemented)
    # allowFrom:                           # Only used with dmPolicy: allowlist
    #   - "external_userid_1"
    #   - "external_userid_2"
```

### Configuration reference

| Field            | Type     | Required | Default      | Description                                             |
| ---------------- | -------- | -------- | ------------ | ------------------------------------------------------- |
| `enabled`        | boolean  | No       | `false`      | Enable the channel                                      |
| `corpId`         | string   | **Yes**  | —            | WeCom Corp ID                                           |
| `appSecret`      | string   | **Yes**  | —            | Self-built app secret or WeChat KF secret               |
| `token`          | string   | **Yes**  | —            | Webhook callback token                                  |
| `encodingAESKey` | string   | **Yes**  | —            | 43-char AES key for message encryption                  |
| `webhookPort`    | integer  | No       | `9999`       | Port for the HTTP webhook server                        |
| `webhookPath`    | string   | No       | `/wechat-kf` | URL path for webhook callbacks                          |
| `dmPolicy`       | string   | No       | `"open"`     | `open` / `allowlist` (`pairing` not yet implemented)    |
| `allowFrom`      | string[] | No       | `[]`         | Allowed external_userids (when dmPolicy is `allowlist`) |

## Verification

1. Start the gateway:
   ```bash
   openclaw gateway start
   ```
2. Expose the webhook port (if not on a public server):
   ```bash
   ngrok http 9999
   ```
3. Copy the HTTPS URL (e.g. `https://xxxx.ngrok-free.app`) and set the callback URL in WeCom:
   ```
   https://xxxx.ngrok-free.app/wechat-kf
   ```
4. WeCom sends a GET verification request — the plugin decrypts the `echostr` and responds automatically
5. Send a test message from WeChat (via the KF link) and confirm the agent responds

## Usage

Once configured and running, the plugin works automatically:

1. **Users** tap your Customer Service link in WeChat to start a conversation
2. **Inbound messages** arrive via webhook — the plugin decrypts, syncs messages via `sync_msg`, downloads any media, and dispatches to your OpenClaw agent
3. **The agent** processes the message and generates a reply
4. **Outbound replies** are sent back via the WeCom `send_msg` API, with markdown automatically converted to Unicode-styled plain text

### Sending messages from the agent

The agent can use the `message` tool to send messages:

- **Reply to current conversation** — omit `target`; the reply goes to whoever messaged
- **Send to a specific user** — set `target` to the user's `external_userid`
- **Send media** — use `filePath` or `media` to attach images, voice, video, or files

### Supported inbound message types

| WeChat Type              | How it's handled                                                      |
| ------------------------ | --------------------------------------------------------------------- |
| Text                     | Passed as-is to the agent                                             |
| Image                    | Downloaded, saved as media attachment, placeholder text sent to agent |
| Voice                    | Downloaded as AMR, saved as media attachment                          |
| Video                    | Downloaded as MP4, saved as media attachment                          |
| File                     | Downloaded, saved as media attachment                                 |
| Location                 | Converted to text: `[Location: name address]`                         |
| Link                     | Converted to text: `[Link: title url]`                                |
| Mini Program             | Converted to text with title and appid                                |
| Channels (Video Account) | Converted to text with type, nickname, title                          |
| Business Card            | Converted to text with userid                                         |
| Forwarded Messages       | Parsed and expanded into readable text                                |

### Supported outbound message types

Text, image, voice, video, file, and link messages. Local files are automatically uploaded to WeChat's temporary media storage before sending.

## Architecture

```
WeChat User
    |
    v
WeCom Server (Tencent)
    |
    |--- POST callback --->  webhook.ts ---> verify signature + size/method guards
    |    (encrypted XML)         |           decrypt AES-256-CBC
    |                            |           extract OpenKfId + Token
    |                            v
    |                        bot.ts ---> DM policy check
    |                            |       per-kfId mutex + msgid dedup
    |                            |       sync_msg API (pull messages)
    |                            |       cursor-based incremental sync
    |                            |       handle events (enter_session, etc.)
    |                            |       download media attachments
    |                            v
    |                     OpenClaw Agent (dispatch via runtime)
    |                            |
    |                +-----------+-----------+
    |                v                       v
    |         outbound.ts              reply-dispatcher.ts
    |         (framework-driven)       (plugin-internal streaming)
    |         chunker declaration       markdown -> unicode
    |         sendText / sendMedia      text chunking + delay
    |                |                       |
    |                +-----------+-----------+
    |                            v
    |                      send-utils.ts
    |                      formatText, detectMediaType
    |                      uploadAndSendMedia
    |                      downloadMediaFromUrl
    |                            v
    +--- send_msg API <--- api.ts
         (JSON)
```

### Key modules

| Module                | Role                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------- |
| `webhook.ts`          | HTTP server — GET verification, POST event handling, size/method guards                           |
| `crypto.ts`           | AES-256-CBC encrypt/decrypt, SHA-1 signature, full PKCS#7 validation                              |
| `token.ts`            | Access token cache with hashed key and auto-refresh                                               |
| `api.ts`              | WeCom API client (sync_msg, send_msg, media upload/download) with token auto-retry                |
| `accounts.ts`         | Dynamic KF account discovery, resolution, enable/disable/delete lifecycle                         |
| `bot.ts`              | Message sync with mutex + dedup, DM policy check, event handling, agent dispatch                  |
| `monitor.ts`          | Webhook + polling lifecycle management with AbortSignal guards                                    |
| `reply-dispatcher.ts` | Plugin-internal streaming reply delivery with chunking, formatting, delays                        |
| `outbound.ts`         | Framework-driven outbound adapter with chunker declaration                                        |
| `send-utils.ts`       | Shared outbound utilities (formatText, detectMediaType, uploadAndSendMedia, downloadMediaFromUrl) |
| `chunk-utils.ts`      | Text chunking with natural boundary splitting (newline, whitespace, hard-cut)                     |
| `constants.ts`        | Shared constants (WECHAT_TEXT_CHUNK_LIMIT, timeouts, error codes)                                 |
| `fs-utils.ts`         | Atomic file operations (temp file + rename)                                                       |
| `unicode-format.ts`   | Markdown to Unicode Mathematical styled text                                                      |
| `channel.ts`          | ChannelPlugin interface with security adapter (resolveDmPolicy, collectWarnings)                  |
| `runtime.ts`          | OpenClaw runtime reference holder                                                                 |

### State persistence

- **Sync cursors** — saved per KF account in `~/.openclaw/state/wechat-kf/wechat-kf-cursor-{kfid}.txt` (atomic writes)
- **Discovered KF IDs** — saved in `~/.openclaw/state/wechat-kf/wechat-kf-kfids.json` (atomic writes)
- **Access tokens** — in-memory only with hashed cache key (re-fetched on restart)

## Limitations / Known Issues

- **Open access by design** — WeChat Customer Service is inherently a public-facing service within the WeChat ecosystem. Anyone who obtains the KF contact link (URL or QR code) can send messages to your KF account — this cannot be prevented at the WeChat platform level. The plugin's `dmPolicy: "allowlist"` mode can restrict which users the agent actually responds to (non-allowlisted messages are silently dropped), but it cannot prevent unknown users from reaching the KF entry point itself. Please be aware of this public-facing nature when deploying in production.
- **48-hour reply window** — WeChat only allows replies within 48 hours of the user's last message. The plugin detects this (errcode 95026) and logs a clear warning.
- **5 messages per window** — you can send at most 5 replies before the user sends another message. The plugin detects this limit and logs accordingly.
- **Voice format** — inbound voice messages are AMR format; transcription depends on the OpenClaw agent's media processing capabilities.
- **Temporary media only** — uploaded media uses WeChat's temporary media API (3-day expiry). Permanent media upload is not implemented.
- **Single webhook endpoint** — all KF accounts share the same webhook port and path. This is by design (WeCom sends all callbacks to one URL per enterprise).
- **No group chat** — WeChat KF is direct messaging only. The plugin only supports `direct` chat type.
- **IP whitelist drift** — if your server's public IP changes, API calls will fail silently. Monitor your IP or use a static IP.

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm run build

# Type check
pnpm run typecheck

# Run tests (363 tests across 16 files)
pnpm test

# Watch mode
pnpm run test:watch

# Lint (Biome)
pnpm run lint

# Lint + auto-fix (Biome)
pnpm run lint:fix

# Format (Biome)
pnpm run format

# Combined Biome check (lint + format)
pnpm run check
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes and add tests
4. Run `pnpm run check && pnpm run typecheck && pnpm test` to verify
5. Submit a pull request

## License

MIT
