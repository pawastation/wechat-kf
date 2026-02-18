# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenClaw channel plugin (`openclaw-wechat-kf`) that bridges WeChat Customer Service (企业微信客服) with OpenClaw AI agents. Zero runtime dependencies — uses only Node.js built-ins.

## Commands

```bash
# Build (TypeScript → ESM, output to dist/)
pnpm run build

# Type check
pnpm run typecheck

# Run all tests
pnpm test

# Run tests in watch mode
pnpm run test:watch

# Run a single test file
pnpm vitest run src/crypto.test.ts
```

## Architecture

The plugin follows a layered design:

**API Layer** (`api.ts`, `crypto.ts`, `token.ts`) — WeCom HTTP API calls, AES-256-CBC encryption, access token caching with auto-refresh.

**Business Logic** (`bot.ts`, `accounts.ts`, `monitor.ts`) — Inbound message processing, dynamic KF account discovery, webhook + 30s polling fallback lifecycle.

**Presentation** (`reply-dispatcher.ts`, `outbound.ts`, `unicode-format.ts`) — Markdown→Unicode styled text conversion, text chunking (2048 char WeChat limit), media upload/send.

**Plugin Interface** (`channel.ts`, `index.ts`) — Implements OpenClaw's `ChannelPlugin` interface; `index.ts` is the entry point that exports the plugin and key helpers.

### Message Flow

**Inbound:** WeCom callback → `webhook.ts` (decrypt via `crypto.ts`) → `bot.ts` (sync_msg with cursor, extract text from 11+ message types, download media) → dispatch to OpenClaw agent via `runtime.ts`.

**Outbound:** Agent reply → `reply-dispatcher.ts` (markdown→unicode, chunk text, upload media) → `api.ts` (send_msg) → WeCom.

### State Persistence

- **Cursors:** File-based per KF account (`~/.openclaw/state/wechat-kf/wechat-kf-cursor-{kfid}.txt`) for incremental sync.
- **KF IDs:** Discovered dynamically from webhook callbacks, persisted to `wechat-kf-kfids.json`.
- **Tokens:** In-memory cache with 5-minute early refresh margin.

## Key Patterns

- **Multi-account isolation:** Each `openKfId` is an independent account; enterprise credentials (corpId, appSecret) are shared.
- **WeChat crypto:** SHA-1 signature verification + AES-256-CBC with PKCS#7 padding (32-byte blocks). Plaintext format: `random(16) + msgLen(4 BE) + msg(UTF8) + receiverId`.
- **Graceful shutdown:** All long-lived processes (webhook server, polling timer) listen on `AbortSignal`.
- **Access control:** Three modes — `open`, `pairing`, `allowlist` (configured via `dmPolicy`).

## Configuration

Required fields in channel config: `corpId`, `appSecret`, `token`, `encodingAESKey`. Schema defined in `src/config-schema.ts`. Webhook defaults to port 9999 at path `/wechat-kf`.

## Development Utilities

- `tools/verify-server.cjs` — Standalone callback verification server for WeCom setup (env: `TOKEN`, `ENCODING_AES_KEY`).
- `tools/test-poll.cjs` — Standalone sync_msg polling tester (env: `WECHAT_CORP_ID`, `WECHAT_APP_SECRET`, `WECHAT_OPEN_KFID`).

## Tech Stack

- TypeScript 5.9, strict mode, ES2022 target, NodeNext module resolution
- Vitest 3 for testing (test files: `src/**/*.test.ts`)
- Node.js >=18.0.0
- pnpm for package management
