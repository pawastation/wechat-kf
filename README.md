# openclaw-wechat-kf

[![npm version](https://img.shields.io/npm/v/openclaw-wechat-kf.svg)](https://www.npmjs.com/package/openclaw-wechat-kf)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-channel%20plugin-blue.svg)](https://openclaw.dev)

**WeChat Customer Service channel plugin for OpenClaw** — let WeChat users chat with your AI agent via the WeCom KF API.

企业微信客服渠道插件 — 让微信用户通过企业微信客服 API 与你的 AI Agent 对话。

---

## Features

- **Inbound message handling** — receive text, image, voice, video, file, location, link, mini-program (小程序), channels (视频号), business card (名片), and forwarded chat history (合并转发消息) from WeChat users
- **Event handling** — processes enter_session, msg_send_fail, and servicer_status_change events
- **Rich outbound messaging** — send text, image, voice, video, file, and link messages back to users
- **Media upload & download** — automatically downloads inbound media (images, voice, video, files) and uploads outbound media via the WeCom temporary media API; supports HTTP URL download for outbound media
- **Markdown to Unicode formatting** — converts markdown bold/italic/headings/lists to Unicode Mathematical Alphanumeric symbols for styled plain-text display in WeChat
- **AES-256-CBC encryption** — full WeChat callback encryption/decryption with SHA-1 signature verification and full PKCS#7 padding validation
- **Webhook + polling fallback** — HTTP webhook server for real-time callbacks, with automatic 30-second polling fallback for reliability; hardened with body size limits, method validation, and error responses
- **Dynamic KF account discovery** — KF account IDs (open_kfid) are automatically discovered from webhook callbacks with enable/disable/delete lifecycle management
- **Cursor-based incremental sync** — persists sync cursors per KF account with atomic file writes for crash safety
- **Access token auto-caching** — tokens cached in memory with hashed keys, automatic refresh 5 minutes before expiry, and auto-retry on token expiry
- **Multi-KF-account isolation** — each KF account (客服账号) gets its own session, cursor, and routing context with per-kfId processing mutex
- **DM policy control** — configurable access control: `open`, `pairing`, or `allowlist` with security adapter (resolveDmPolicy, collectWarnings)
- **Text chunking** — automatically splits long replies to respect WeChat's 2000-character message size limit, with chunker declaration for framework integration
- **Session limit awareness** — detects and gracefully handles WeChat's 48-hour reply window and 5-message-per-window limits
- **Race condition safety** — per-kfId mutex and msgid deduplication prevent duplicate message processing
- **Human-like reply delays** — configurable typing delay simulation for natural conversation pacing
- **Graceful shutdown** — responds to abort signals with pre-check guards, cleanly stopping the webhook server and polling

## Prerequisites

1. 一个**企业微信账号**，且拥有管理员权限 — [注册地址](https://work.weixin.qq.com/)
2. 至少一个**客服账号**（在企业微信的「微信客服」模块中创建）
3. 一个**公网可访问的 URL**，用于接收回调 — 可使用 [ngrok](https://ngrok.com/)、[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) 或有公网 IP 的服务器
4. 已安装并运行 **OpenClaw Gateway**（`openclaw gateway start`）

微信客服 API 有**两种接入方式**，请根据实际情况选择：

| | 方式一：企业微信后台自建应用 | 方式二：微信客服后台 API 托管 |
|---|---|---|
| **管理入口** | [企业微信管理后台](https://work.weixin.qq.com/wework_admin/frame) | [微信客服管理后台](https://work.weixin.qq.com/kf/) |
| **Secret 来源** | 自建应用的 Secret（应用密钥） | 微信客服专属 Secret（开发配置中查看） |
| **回调配置位置** | 企业微信后台 → 微信客服 → API → 回调设置 | 微信客服后台 → 开发配置 → 回调设置 |
| **需要自建应用** | 是 — 需创建应用并关联微信客服权限 | 否 — 直接在微信客服后台配置 |
| **IP 白名单** | 在自建应用中配置「企业可信 IP」 | 不需要（微信客服后台无此限制） |
| **适用场景** | 已有企业微信自建应用、需与其他企微功能集成 | 仅需微信客服能力、追求简单快速接入 |
| **推荐程度** | 功能更完整，适合复杂场景 | 配置更简单，适合快速上手 |

> **重要：** 两种方式是**互斥关系** — 同一个客服账号只能通过其中一种方式管理，不能同时使用。选定后如需切换，需要先解除当前方式的 API 绑定。

## Installation

```bash
openclaw plugins install openclaw-wechat-kf
```

## WeCom Setup Guide

两种接入方式共享相同的底层 API（`sync_msg`、`send_msg` 等），区别仅在于凭证获取方式和管理入口不同。本插件对两种方式**完全兼容**。

---

### Method 1: 企业微信后台自建应用

通过企业微信管理后台创建自建应用，然后将该应用与微信客服 API 关联。这是功能最完整的接入方式。

#### Step 1: 获取企业 ID（Corp ID）

1. 登录[企业微信管理后台](https://work.weixin.qq.com/wework_admin/frame)
2. 点击左侧菜单最下方的**「我的企业」**
3. 在页面底部找到并复制**「企业ID」** — 格式如 `wwXXXXXXXXXXXXXXXX`

#### Step 2: 创建自建应用并获取 Secret

1. 进入**「应用管理」→「自建」**
2. 点击**「创建应用」**（或使用已有应用）
3. 进入应用详情页，复制**「Secret」**（应用密钥）
4. 确认该应用的**「API 权限」**中已启用**「微信客服」**

> 每个自建应用有独立的 Secret。调用微信客服 API 时，需要使用与微信客服关联的应用 Secret 来获取 access_token。

#### Step 3: 开启微信客服 API 并关联自建应用

1. 在左侧菜单进入**「微信客服」**
2. 点击**「API」**小按钮
3. 在**「可调用接口的应用」**中选择你在 Step 2 创建的自建应用
4. 在**「通过 API 管理微信客服账号 → 企业内部开发」**中，勾选需要通过 API 管理的客服账号

> 开启后，被选中账号的所有消息与事件都将通过回调推送给你的应用，原有的原生接待规则将暂不生效。

#### Step 4: 配置回调地址（Callback URL）

1. 在微信客服的 API 设置页面，找到**「回调设置」**
2. 设置**回调地址（URL）**：
   ```
   https://your-domain.com/wechat-kf
   ```
   > 使用你的公网 URL。如果使用 ngrok：`https://xxxx.ngrok-free.app/wechat-kf`
3. 设置 **Token** — 任意随机字符串（英文或数字，不超过 32 位），或点击**「随机获取」**自动生成
4. 设置 **EncodingAESKey** — 43 位字符串（英文或数字），或点击**「随机获取」**自动生成
5. 点击**「保存」** — 企业微信会发送一个 GET 验证请求到你的回调地址

> **注意：** 保存回调配置前，webhook 服务必须已经在运行，否则验证会失败。请先启动 OpenClaw Gateway（参考 [Verification](#verification)）。

#### Step 5: 配置 IP 白名单

1. 在自建应用设置中，进入**「企业可信IP」**或**「IP 白名单」**
2. 添加你服务器的公网 IP 地址
3. 查看当前公网 IP：`curl -s https://api.ipify.org`

> **注意：** 如果你的公网 IP 发生变化（家庭宽带常见），API 调用会因认证失败而报错。请注意监控 IP 变化并及时更新白名单。

#### Step 6: 创建客服账号

1. 在**「微信客服」**页面，点击**「添加客服账号」**
2. 配置客服名称、头像等信息
3. 记录 **open_kfid** — 格式如 `wkXXXXXXXXXXXXXXXX`
4. 生成**「客服链接」**分享给用户 — 微信用户通过此链接发起咨询

> 你不需要在 OpenClaw 配置中填写 open_kfid。插件会自动从 webhook 事件中发现客服账号。

---

### Method 2: 微信客服后台 API 托管

通过[微信客服管理后台](https://work.weixin.qq.com/kf/)直接启用 API，无需创建企业微信自建应用。配置更简单，适合只需要微信客服功能的场景。

#### Step 1: 获取企业 ID（Corp ID）

1. 登录[企业微信管理后台](https://work.weixin.qq.com/wework_admin/frame)
2. 点击**「我的企业」**，复制**「企业ID」** — 格式如 `wwXXXXXXXXXXXXXXXX`

> Corp ID 始终从企业微信管理后台获取，两种方式相同。

#### Step 2: 在微信客服后台启用 API

1. 访问[微信客服管理后台](https://work.weixin.qq.com/kf/)（需管理员扫码登录）
2. 进入**「开发配置」**
3. 点击**「启用 API」**，按照指引填写回调配置

#### Step 3: 获取微信客服 Secret

1. 启用 API 后，在**「开发配置」**页面查看并复制 **Secret**
2. 此 Secret 由企业微信团队下发给管理员，是**微信客服专属 Secret**，与自建应用 Secret 不同
3. 如未显示 Secret，点击查看/重置后复制

> **重要区别：** 此处获取的 Secret 是「微信客服」专用密钥，而非自建应用密钥。使用此 Secret 获取的 access_token 仅可调用微信客服相关接口。

#### Step 4: 配置回调地址（Callback URL）

1. 在**「开发配置」**页面，找到回调配置区域
2. 设置**回调地址（URL）**：
   ```
   https://your-domain.com/wechat-kf
   ```
3. 设置 **Token** — 任意随机字符串，或点击**「随机获取」**自动生成
4. 设置 **EncodingAESKey** — 43 位字符串，或点击**「随机获取」**自动生成
5. 保存配置 — 系统会发送 GET 验证请求到回调地址

> **注意：** 同样需要先启动 webhook 服务再保存配置，否则验证会失败。

#### Step 5: 创建客服账号

1. 在微信客服后台创建客服账号
2. 记录 **open_kfid**
3. 生成**「客服链接」**分享给用户

> 启用 API 后，该账号的所有消息和事件都将通过回调推送给你的服务，你需要及时通过 API 收发消息以保证正常服务。

---

### Comparison: 两种方式对照表

| 对比项 | 方式一：企业微信后台自建应用 | 方式二：微信客服后台 API 托管 |
|--------|--------------------------|--------------------------|
| **配置复杂度** | 较高 — 需创建应用、关联权限、配置白名单 | 较低 — 直接启用 API 即可 |
| **Secret 类型** | 自建应用 Secret（应用密钥） | 微信客服专属 Secret |
| **IP 白名单** | 必须配置（自建应用安全要求） | 无需配置 |
| **API 能力** | 完整 — 可同时调用企业微信其他 API | 仅限微信客服相关接口 |
| **管理灵活性** | 高 — 可精细控制哪些客服账号走 API | 中 — API 启用后覆盖所有账号 |
| **与企微集成** | 天然集成 — 员工可在企微客户端接待 | 独立运作 — 不依赖企微客户端 |
| **适合谁** | 已有企微开发经验、需要多功能集成的团队 | 只需 AI 客服、追求最快上手的开发者 |
| **凭证获取** | 企业微信管理后台 → 应用管理 → 应用详情 | 微信客服管理后台 → 开发配置 |
| **回调配置** | 企业微信后台 → 微信客服 → API → 回调设置 | 微信客服后台 → 开发配置 → 回调设置 |
| **官方文档** | [企业微信开发者文档](https://developer.work.weixin.qq.com/document/path/94638) | [微信客服 API 文档](https://kf.weixin.qq.com/api/doc/path/93304) |

> **本插件对两种方式完全兼容** — 无论你使用哪种方式获取的 `corpId`、`appSecret`（Secret）、`token`、`encodingAESKey`，填入 OpenClaw 配置即可正常工作。配置字段 `appSecret` 既可以填自建应用 Secret，也可以填微信客服专属 Secret。

## Configuration

Add the following to your OpenClaw config (`~/.openclaw/openclaw.yaml` or via `openclaw config`):

```yaml
channels:
  wechat-kf:
    enabled: true
    corpId: "wwXXXXXXXXXXXXXXXX"        # Your Corp ID (企业ID)
    appSecret: "your-app-secret-here"      # App Secret (自建应用密钥 or 微信客服 Secret)
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
| `appSecret` | string | **Yes** | — | Self-built app secret (应用密钥) or WeChat KF secret (微信客服 Secret) |
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
    ├─── POST callback ──→  webhook.ts ──→ verify signature + size/method guards
    │    (encrypted XML)         │           decrypt AES-256-CBC
    │                            │           extract OpenKfId + Token
    │                            ▼
    │                        bot.ts ──→ DM policy check
    │                            │       per-kfId mutex + msgid dedup
    │                            │       sync_msg API (pull messages)
    │                            │       cursor-based incremental sync
    │                            │       handle events (enter_session, etc.)
    │                            │       download media attachments
    │                            ▼
    │                     OpenClaw Agent (dispatch via runtime)
    │                            │
    │                ┌───────────┴───────────┐
    │                ▼                       ▼
    │         outbound.ts              reply-dispatcher.ts
    │         (framework-driven)       (plugin-internal streaming)
    │         chunker declaration       markdown → unicode
    │         sendText / sendMedia      text chunking + delay
    │                │                       │
    │                └───────────┬───────────┘
    │                            ▼
    │                      send-utils.ts
    │                      formatText, detectMediaType
    │                      uploadAndSendMedia
    │                      downloadMediaFromUrl
    │                            ▼
    └─── send_msg API ◀── api.ts
         (JSON)
```

### Key modules

| Module | Role |
|--------|------|
| `webhook.ts` | HTTP server — GET verification, POST event handling, size/method guards |
| `crypto.ts` | AES-256-CBC encrypt/decrypt, SHA-1 signature, full PKCS#7 validation |
| `token.ts` | Access token cache with hashed key and auto-refresh |
| `api.ts` | WeCom API client (sync_msg, send_msg, media upload/download) with token auto-retry |
| `accounts.ts` | Dynamic KF account discovery, resolution, enable/disable/delete lifecycle |
| `bot.ts` | Message sync with mutex + dedup, DM policy check, event handling, agent dispatch |
| `monitor.ts` | Webhook + polling lifecycle management with AbortSignal guards |
| `reply-dispatcher.ts` | Plugin-internal streaming reply delivery with chunking, formatting, delays |
| `outbound.ts` | Framework-driven outbound adapter with chunker declaration |
| `send-utils.ts` | Shared outbound utilities (formatText, detectMediaType, uploadAndSendMedia, downloadMediaFromUrl) |
| `chunk-utils.ts` | Text chunking with natural boundary splitting (newline, whitespace, hard-cut) |
| `constants.ts` | Shared constants (WECHAT_TEXT_CHUNK_LIMIT, timeouts, error codes) |
| `fs-utils.ts` | Atomic file operations (temp file + rename) |
| `unicode-format.ts` | Markdown to Unicode Mathematical styled text |
| `channel.ts` | ChannelPlugin interface with security adapter (resolveDmPolicy, collectWarnings) |
| `runtime.ts` | OpenClaw runtime reference holder |

### State persistence

- **Sync cursors** — saved per KF account in `~/.openclaw/state/wechat-kf/wechat-kf-cursor-{kfid}.txt` (atomic writes)
- **Discovered KF IDs** — saved in `~/.openclaw/state/wechat-kf/wechat-kf-kfids.json` (atomic writes)
- **Access tokens** — in-memory only with hashed cache key (re-fetched on restart)

## Limitations / Known Issues

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
