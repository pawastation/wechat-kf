# Contributing to OpenClaw WeChat KF Plugin

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
    |                      formatText, mediaKindToWechatType
    |                      detectMediaType, uploadAndSendMedia
    |                      resolveThumbMediaId
    |                            v
    +--- send_msg API <--- api.ts
         (JSON)
```

## Key Modules

| Module                    | Role                                                                                                                    |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `webhook.ts`              | HTTP handler (framework gateway) — GET verification, POST event handling, size/method guards                            |
| `crypto.ts`               | AES-256-CBC encrypt/decrypt, SHA-1 signature, full PKCS#7 validation                                                   |
| `token.ts`                | Access token cache with hashed key and auto-refresh                                                                     |
| `api.ts`                  | WeCom API client (sync_msg, send_msg, sendRawMessage, media upload/download) with token auto-retry                      |
| `accounts.ts`             | Dynamic KF account discovery, resolution, enable/disable/delete lifecycle                                               |
| `bot.ts`                  | Message sync with mutex + dedup, DM policy check, event handling, agent dispatch, merged_msg media download             |
| `monitor.ts`              | Shared context manager (setSharedContext/getSharedContext/waitForSharedContext/clearSharedContext)                       |
| `reply-dispatcher.ts`     | Plugin-internal streaming reply delivery with chunking, formatting, delays                                              |
| `outbound.ts`             | Framework-driven outbound adapter with chunker declaration                                                              |
| `send-utils.ts`           | Shared outbound utilities (formatText, mediaKindToWechatType, detectMediaType, uploadAndSendMedia, resolveThumbMediaId) |
| `wechat-kf-directives.ts` | `[[wechat_*:...]]` directive parser for rich message types in agent replies                                             |
| `constants.ts`            | Shared constants (WECHAT_TEXT_CHUNK_LIMIT, timeouts, error codes)                                                       |
| `fs-utils.ts`             | Atomic file operations (temp file + rename)                                                                             |
| `unicode-format.ts`       | Markdown to Unicode Mathematical styled text                                                                            |
| `channel.ts`              | ChannelPlugin interface with security adapter (resolveDmPolicy, collectWarnings)                                        |
| `config-schema.ts`        | JSON Schema for wechat-kf channel config validation                                                                     |
| `runtime.ts`              | OpenClaw runtime reference holder                                                                                       |

## State Persistence

- **Sync cursors** — saved per KF account in `~/.openclaw/state/wechat-kf/wechat-kf-cursor-{kfid}.txt` (atomic writes)
- **Discovered KF IDs** — saved in `~/.openclaw/state/wechat-kf/wechat-kf-kfids.json` (atomic writes)
- **Access tokens** — in-memory only with hashed cache key (re-fetched on restart)

## Key Patterns

- **Multi-account isolation:** Each `openKfId` is an independent account; enterprise credentials (corpId, appSecret) are shared.
- **WeChat crypto:** SHA-1 signature verification + AES-256-CBC with PKCS#7 padding (32-byte blocks, full byte validation). Plaintext format: `random(16) + msgLen(4 BE) + msg(UTF8) + receiverId`.
- **Graceful shutdown:** All long-lived processes (polling timer, shared gateway handler) listen on `AbortSignal` with pre-check guards.
- **Access control:** Three modes — `open`, `allowlist`, `pairing` (configured via `dmPolicy`). `pairing` blocks unknown senders, sends a pairing code, and approves via `openclaw pairing approve wechat-kf <code>`. Security adapter exposes `resolveDmPolicy` and `collectWarnings`.
- **Race condition safety:** Per-kfId processing mutex prevents concurrent sync_msg calls; msgid deduplication prevents duplicate delivery.
- **Atomic file writes:** Cursor and kfids persistence uses temp file + rename to prevent corruption on crash.
- **Token auto-retry:** API calls that fail with expired-token errcodes (40014, 42001, 40001) automatically refresh the token and retry once.
- **Two outbound paths:** `outbound.ts` handles framework-driven delivery (with chunker declaration); `reply-dispatcher.ts` handles plugin-internal streaming replies with typing delays.
- **Session limits:** WeChat enforces 48h reply window and 5-message limit per window (errcode 95026); detected and logged with clear warnings.

## Development Commands

```bash
# Install dependencies
pnpm install

# Build (TypeScript -> ESM, output to dist/)
pnpm run build

# Type check
pnpm run typecheck

# Run all tests (~670 tests across 17 files)
pnpm test

# Watch mode
pnpm run test:watch

# Run a single test file
pnpm vitest run src/crypto.test.ts

# Lint (Biome)
pnpm run lint

# Lint + auto-fix (Biome)
pnpm run lint:fix

# Format (Biome)
pnpm run format

# Combined Biome check (lint + format)
pnpm run check
```

## Contributing Workflow

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes and add tests
4. Run `pnpm run check && pnpm run typecheck && pnpm test` to verify
5. Submit a pull request
