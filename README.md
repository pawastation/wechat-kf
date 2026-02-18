# openclaw-wechat-kf

[![npm version](https://img.shields.io/npm/v/openclaw-wechat-kf.svg)](https://www.npmjs.com/package/openclaw-wechat-kf)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-channel%20plugin-blue.svg)](https://openclaw.dev)

**WeChat Customer Service channel plugin for OpenClaw** — let WeChat users chat with your AI agent via the WeCom KF API.

企业微信客服渠道插件 — 让微信用户通过企业微信客服 API 与你的 AI Agent 对话。

---

## Features

- **Inbound message handling** — receive text, image, voice, video, file, location, link, mini-program (小程序), channels (视频号), business card (名片), and forwarded chat history (合并转发消息) from WeChat users
- **Rich outbound messaging** — send text, image, voice, video, file, and link messages back to users
- **Media upload & download** — automatically downloads inbound media (images, voice, video, files) and uploads outbound media via the WeCom temporary media API
- **Markdown → Unicode formatting** — converts markdown bold/italic/headings/lists to Unicode Mathematical Alphanumeric symbols for styled plain-text display in WeChat
- **AES-256-CBC encryption** — full WeChat callback encryption/decryption with SHA-1 signature verification
- **Webhook + polling fallback** — HTTP webhook server for real-time callbacks, with automatic 30-second polling fallback for reliability
- **Dynamic KF account discovery** — KF account IDs (open_kfid) are automatically discovered from webhook callbacks; no need to pre-configure each one
- **Cursor-based incremental sync** — persists sync cursors per KF account for reliable message delivery across restarts
- **Access token auto-caching** — tokens cached in memory with automatic refresh 5 minutes before expiry
- **Multi-KF-account isolation** — each KF account (客服账号) gets its own session, cursor, and routing context
- **DM policy control** — configurable access control: `open`, `pairing`, or `allowlist`
- **Text chunking** — automatically splits long replies to respect WeChat's message size limits
- **Human-like reply delays** — configurable typing delay simulation for natural conversation pacing
- **Graceful shutdown** — responds to abort signals, cleanly stopping the webhook server and polling

## Prerequisites

1. A **WeCom account** (企业微信) with admin access — [register here](https://work.weixin.qq.com/)
2. A **self-built application** (自建应用) with Customer Service API permissions enabled
3. At least one **Customer Service account** (客服账号) created in WeCom's 微信客服 section
4. A **public URL** for webhook callbacks — use [ngrok](https://ngrok.com/), [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/), or a server with a public IP
5. **OpenClaw Gateway** installed and running (`openclaw gateway start`)

## Installation

```bash
openclaw plugins install openclaw-wechat-kf
```

## WeCom Setup Guide

### Step 1: Get your Corp ID (企业ID)

1. Log in to the [WeCom Admin Console](https://work.weixin.qq.com/wework_admin/frame) (企业微信管理后台)
2. Go to **我的企业** (My Enterprise) at the bottom of the left sidebar
3. Copy the **企业ID** (Corp ID) — it looks like `wwXXXXXXXXXXXXXXXX`

### Step 2: Create or select an application (自建应用)

1. Go to **应用管理 → 自建** (App Management → Self-built)
2. Click **创建应用** (Create App) — or use an existing app
3. Note the app's **Secret** (应用密钥)
4. Under **API 权限** (API Permissions), ensure **微信客服** (WeChat Customer Service) is enabled

### Step 3: Configure the Customer Service callback (微信客服回调)

1. Go to **微信客服** in the left sidebar
2. Click **API** or **回调设置** (Callback Settings)
3. Set the **回调地址** (Callback URL):
   ```
   https://your-domain.com/wechat-kf
   ```
   > Use your public URL. If using ngrok: `https://xxxx.ngrok-free.app/wechat-kf`
4. Set a **Token** — any random string, or let WeCom generate one
5. Set an **EncodingAESKey** — 43-character base64 string, or let WeCom generate one
6. Click **保存** (Save) — WeCom will send a verification GET request to your callback URL

> ⚠️ The webhook server must be running before you save the callback URL, or verification will fail. Start OpenClaw Gateway first (see [Verification](#verification)).

### Step 4: Create a KF account (客服账号)

1. In the **微信客服** section, click **添加客服账号** (Add KF Account)
2. Configure the account name, avatar, etc.
3. Note the **open_kfid** — it looks like `wkXXXXXXXXXXXXXXXX`
4. Generate a **客服链接** (KF Link) to share with users — this is how WeChat users start chatting

> 💡 You don't need to configure the open_kfid in OpenClaw. The plugin discovers KF accounts automatically from incoming webhook events.

### Step 5: IP Whitelist (IP 白名单)

1. In your self-built app settings, go to **企业可信IP** or **IP白名单**
2. Add your server's public IP address
3. Check your current IP: `curl -s https://api.ipify.org`

> ⚠️ If your public IP changes (common with residential connections), API calls will fail with auth errors. Re-check and update the whitelist when this happens.

## Configuration

Add the following to your OpenClaw config (`~/.openclaw/openclaw.yaml` or via `openclaw config`):

```yaml
channels:
  wechat-kf:
    enabled: true
    corpId: "wwXXXXXXXXXXXXXXXX"        # Your Corp ID (企业ID)
    appSecret: "your-app-secret-here"      # App Secret (应用密钥)
    token: "your-callback-token"           # Callback Token (回调Token)
    encodingAESKey: "your-43-char-key"     # Callback EncodingAESKey (43 characters)
    webhookPort: 9999                      # Local port for webhook server (default: 9999)
    webhookPath: "/wechat-kf"              # URL path for webhook (default: /wechat-kf)
    dmPolicy: "open"                       # Access control: open | pairing | allowlist
    # allowFrom:                           # Only used with dmPolicy: allowlist
    #   - "external_userid_1"
    #   - "external_userid_2"
```

### Configuration Reference

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `enabled` | boolean | No | `false` | Enable the channel |
| `corpId` | string | **Yes** | — | WeCom Corp ID (企业ID) |
| `appSecret` | string | **Yes** | — | Self-built app secret (应用密钥) |
| `token` | string | **Yes** | — | Webhook callback token |
| `encodingAESKey` | string | **Yes** | — | 43-char AES key for message encryption |
| `webhookPort` | integer | No | `9999` | Port for the HTTP webhook server |
| `webhookPath` | string | No | `/wechat-kf` | URL path for webhook callbacks |
| `dmPolicy` | string | No | `"open"` | `open` / `pairing` / `allowlist` |
| `allowFrom` | string[] | No | `[]` | Allowed external_userids (when dmPolicy is `allowlist`) |

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

1. **Users** tap your Customer Service link (客服链接) in WeChat to start a conversation
2. **Inbound messages** arrive via webhook → the plugin decrypts, syncs messages via `sync_msg`, downloads any media, and dispatches to your OpenClaw agent
3. **The agent** processes the message and generates a reply
4. **Outbound replies** are sent back via the WeCom `send_msg` API, with markdown automatically converted to Unicode-styled plain text

### Sending messages from the agent

The agent can use the `message` tool to send messages:

- **Reply to current conversation** — omit `target`; the reply goes to whoever messaged
- **Send to a specific user** — set `target` to the user's `external_userid`
- **Send media** — use `filePath` or `media` to attach images, voice, video, or files

### Supported inbound message types

| WeChat Type | How it's handled |
|-------------|-----------------|
| Text (文本) | Passed as-is to the agent |
| Image (图片) | Downloaded, saved as media attachment, placeholder text sent to agent |
| Voice (语音) | Downloaded as AMR, saved as media attachment |
| Video (视频) | Downloaded as MP4, saved as media attachment |
| File (文件) | Downloaded, saved as media attachment |
| Location (位置) | Converted to text: `[位置: name address]` |
| Link (链接) | Converted to text: `[链接: title url]` |
| Mini Program (小程序) | Converted to text with title and appid |
| Channels (视频号) | Converted to text with type, nickname, title |
| Business Card (名片) | Converted to text with userid |
| Forwarded Messages (合并转发) | Parsed and expanded into readable text |

### Supported outbound message types

Text, image, voice, video, file, and link messages. Local files are automatically uploaded to WeChat's temporary media storage before sending.

## Architecture

```
WeChat User
    │
    ▼
WeCom Server (腾讯)
    │
    ├─── POST callback ──→  webhook.ts ──→ verify signature
    │    (encrypted XML)         │           decrypt AES-256-CBC
    │                            │           extract OpenKfId + Token
    │                            ▼
    │                        bot.ts ──→ sync_msg API (pull messages)
    │                            │       cursor-based incremental sync
    │                            │       download media attachments
    │                            ▼
    │                     OpenClaw Agent (dispatch via runtime)
    │                            │
    │                            ▼
    │                     reply-dispatcher.ts
    │                            │  markdown → unicode formatting
    │                            │  text chunking
    │                            │  human-like delay
    │                            ▼
    └─── send_msg API ◀── outbound.ts / api.ts
         (JSON)              upload media if needed
```

### Key modules

| Module | Role |
|--------|------|
| `webhook.ts` | HTTP server — GET verification, POST event handling |
| `crypto.ts` | AES-256-CBC encrypt/decrypt, SHA-1 signature |
| `token.ts` | Access token cache with auto-refresh |
| `api.ts` | WeCom API client (sync_msg, send_msg, media upload/download) |
| `accounts.ts` | Dynamic KF account discovery and resolution |
| `bot.ts` | Message sync, media download, agent dispatch |
| `monitor.ts` | Webhook + polling lifecycle management |
| `reply-dispatcher.ts` | Reply delivery with chunking, formatting, delays |
| `outbound.ts` | Outbound message adapter (text + media) |
| `unicode-format.ts` | Markdown → Unicode Mathematical styled text |
| `channel.ts` | ChannelPlugin interface implementation |
| `runtime.ts` | OpenClaw runtime reference holder |

### State persistence

- **Sync cursors** — saved per KF account in `~/.openclaw/state/wechat-kf/wechat-kf-cursor-{kfid}.txt`
- **Discovered KF IDs** — saved in `~/.openclaw/state/wechat-kf/wechat-kf-kfids.json`
- **Access tokens** — in-memory only (re-fetched on restart)

## Limitations / Known Issues

- **48-hour reply window** — WeChat only allows replies within 48 hours of the user's last message. After that, messages will fail with an API error.
- **5 messages per window** — you can send at most 5 replies before the user sends another message.
- **No welcome message** — `enter_session` events are received but not yet handled (no auto-greeting when a user first opens the chat).
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

# Run tests
pnpm test

# Watch mode
pnpm run test:watch
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes and add tests
4. Run `pnpm run typecheck && pnpm test` to verify
5. Submit a pull request

## License

MIT
