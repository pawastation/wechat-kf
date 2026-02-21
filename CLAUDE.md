# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenClaw channel plugin (`wechat-kf`) that bridges WeChat Customer Service (企业微信客服) with OpenClaw AI agents. Zero runtime dependencies — uses only Node.js built-ins.

## Commands

```bash
# Build (TypeScript -> ESM, output to dist/)
pnpm run build

# Type check
pnpm run typecheck

# Run all tests (~600 tests across 17 test files)
pnpm test

# Run tests in watch mode
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

## Architecture

The plugin follows a layered design:

**API Layer** (`api.ts`, `crypto.ts`, `token.ts`) — WeCom HTTP API calls (including `sendRawMessage` for arbitrary message types), AES-256-CBC encryption, access token caching with hashed cache key and auto-refresh (including auto-retry on token expiry).

**Business Logic** (`bot.ts`, `accounts.ts`, `monitor.ts`) — Inbound message processing with per-kfId mutex, msgid deduplication, and configurable debounce window to coalesce rapid consecutive messages, dynamic KF account discovery with enable/disable/delete lifecycle, shared context manager + 30s polling fallback per kfId with AbortSignal guards.

**Presentation** (`reply-dispatcher.ts`, `outbound.ts`, `send-utils.ts`, `unicode-format.ts`, `wechat-kf-directives.ts`) — Two outbound paths: `outbound.ts` (framework-driven via chunker declaration) and `reply-dispatcher.ts` (plugin-internal streaming replies). Shared utilities in `send-utils.ts` (formatText, mediaKindToWechatType, detectMediaType, uploadAndSendMedia, downloadMediaFromUrl, resolveThumbMediaId). `wechat-kf-directives.ts` parses `[[wechat_*:...]]` directives for rich link cards, location, mini-program, menu, business card, channel article, and raw JSON message.

**Shared Utilities** (`constants.ts`, `fs-utils.ts`) — Shared constants including CHANNEL_ID, DEFAULT_WEBHOOK_PATH, timeouts, and error codes (`constants.ts`), atomic file writes via temp+rename (`fs-utils.ts`).

**Plugin Interface** (`channel.ts`, `index.ts`) — Implements OpenClaw's `ChannelPlugin` interface including security adapter (`resolveDmPolicy`, `collectWarnings`); `index.ts` is the entry point that exports the plugin and key helpers.

### Message Flow

**Inbound:** WeCom callback -> `webhook.ts` (method/size/content-type validation, decrypt via `crypto.ts`) -> `bot.ts` (DM policy check, per-kfId mutex, msgid dedup, debounce coalescing, sync_msg with cursor, extract text from 14+ message types, handle events: enter_session/msg_send_fail/servicer_status_change, download media) -> dispatch to OpenClaw agent via `runtime.ts`.

**Outbound (framework-driven):** Agent reply -> framework calls `outbound.ts` chunker (framework `chunkTextWithMode`) -> `sendText` per chunk (formatText via unicode-format) or `sendMedia` (loadWebMedia for all URL formats, upload to WeChat temp media, send) -> `api.ts` (send_msg) -> WeCom.

**Outbound (plugin-internal):** `bot.ts` streaming reply -> `reply-dispatcher.ts` (markdown->unicode, chunk text, human-like delay, loadWebMedia + upload media) -> `api.ts` (send_msg) -> WeCom.

### State Persistence

- **Cursors:** File-based per KF account (`~/.openclaw/state/wechat-kf/wechat-kf-cursor-{kfid}.txt`) with atomic writes for crash safety.
- **KF IDs:** Discovered dynamically from webhook callbacks, persisted to `wechat-kf-kfids.json` with atomic writes.
- **Tokens:** In-memory cache with hashed key, 5-minute early refresh margin, auto-retry on expiry.

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
- **Inbound debounce:** Configurable per-kfId debounce window (`debounceMs`) delays dispatch until no new messages arrive within the window, coalescing rapid consecutive messages into a single agent call.
- **Biome:** Linting and formatting via `@biomejs/biome` — run `pnpm run check` before committing.

## Configuration

Required fields in channel config: `corpId`, `appSecret`, `token`, `encodingAESKey`. Schema defined in `src/config-schema.ts`. Webhook path defaults to `/wechat-kf` (registered on framework's shared gateway). Optional `debounceMs` (0–10000, default disabled) coalesces rapid consecutive messages before agent dispatch.

## Tech Stack

- TypeScript 5.9, strict mode, ES2022 target, NodeNext module resolution
- Vitest 3 for testing (test files: `src/**/*.test.ts`, ~600 tests across 17 files)
- Biome 2 for linting and formatting (zero `any` in source files)
- Node.js >=22.12.0
- pnpm for package management
