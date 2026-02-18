# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased] - 2026-02-18

Code review and improvement effort covering P0-P3 review items (27 commits).

### Added

- Biome linter/formatter with `lint`, `lint:fix`, `format`, and `check` scripts (`55f9a12`)
- Security adapter with `resolveDmPolicy` and `collectWarnings` in channel.ts (`52ed655`)
- Account enable/disable/delete lifecycle management in accounts.ts (`3084b26`)
- HTTP media URL download in outbound — download remote media, upload to WeChat, then send (`e3358c8`)
- 48-hour / 5-message session limit awareness with clear warning logs (`e3358c8`)
- Event message handling for enter_session, msg_send_fail, and servicer_status_change (`651f994`)
- Chunker declaration for framework text chunking (`outbound.chunker`, `chunkerMode: "text"`) (`75939d3`)
- Atomic file writes for cursor and kfids persistence via temp+rename (`b31583b`)
- Token auto-retry on expiry (errcodes 40014, 42001, 40001) with single-retry semantics (`cdb1992`)
- AbortSignal state checks in monitor to prevent resource leaks after shutdown (`241c1d0`)
- Webhook hardening — HTTP method validation, 64KB body size limit, content-type checks, proper error responses (`d145e31`)
- Processing mutex (per-kfId) and msgid deduplication to prevent race conditions (`635b45c`)
- `send-utils.ts` shared utilities (formatText, detectMediaType, uploadAndSendMedia, downloadMediaFromUrl) (`6fa0e67`)
- `chunk-utils.ts` text chunking with natural boundary splitting (`75939d3`)
- `constants.ts` shared constants (WECHAT_TEXT_CHUNK_LIMIT, timeouts, error codes) (`75939d3`)
- `fs-utils.ts` atomic file operations (`b31583b`)
- 363 tests across 16 test files (`d37800b` and throughout)
- Full type safety — zero `any` in source files (`e0605f4`)
- Manifest alignment with additionalProperties, uiHints, and schema sync (`b08c09c`)

### Changed

- `capabilities.media` set to `true` with expanded media type support (`906d03c`)
- Unified errcode check pattern across all API functions (`a890160`)
- Token cache key hashed (SHA-256) to avoid storing appSecret in plain text (`ed5cb6a`)
- Deduplicated send functions — shared `uploadAndSendMedia` helper replaces per-module copies (`314cff3`)
- sync_msg token/cursor mutual exclusivity enforced (`651f994`)
- Config schema aligned with manifest — field constraints, validation, and defaults (`93f72fa`)
- Build config improvements — `exports`, `types`, `files`, `engines` fields in package.json (`5657459`)
- Markdown-to-Unicode conversion fixes for edge cases (`5dcb3bc`)
- Agent prompt updated with media hints and session limit info (`906d03c`)
- Global state encapsulated for test isolation and multi-instance support (`6fcac9c`)
- Miscellaneous cleanup — dead code removal, import deduplication, naming improvements (`2bdf0a9`)
- Send function input validation added (`314cff3`)
- startAccount error handling and idempotency guard (`a706b7a`)

### Fixed

- PKCS#7 padding now validates all padding bytes, not just the last one (`60b6258`)
- `downloadMedia` error detection — check response content-type before parsing as JSON (`cdb1992`)
- startAccount error handling + idempotency guard to prevent duplicate launches (`a706b7a`)
- Race condition between webhook and polling via per-kfId mutex (`635b45c`)
- fetch timeout applied to all API calls via constants (`cdb1992`)

### Security

- PKCS#7 padding full byte validation prevents padding oracle attacks (`60b6258`)
- Token cache key hashed (SHA-256) to avoid plain-text appSecret in memory (`ed5cb6a`)
- Webhook body size limit (64KB) prevents denial-of-service via large payloads (`d145e31`)
- DM policy enforcement — `open`, `allowlist`, and `disabled` modes with security adapter (`52ed655`)
- HTTP method and content-type validation on webhook endpoint (`d145e31`)

## [0.1.0] - 2026-02-18

### Added
- **Core MVP** — Full WeChat Customer Service (企业微信客服) channel plugin for OpenClaw
- **Crypto** — AES-256-CBC encrypt/decrypt + SHA1 signature verification (`crypto.ts`)
- **Token management** — Access token cache with auto-refresh and 5-minute safety margin (`token.ts`)
- **API client** — `sync_msg`, `send_msg`, media upload/download, image/voice/video/file/link message sending (`api.ts`)
- **Webhook server** — HTTP server handling GET URL verification + POST callback events (`webhook.ts`)
- **Multi-account support** — Account resolution with legacy flat-config compatibility (`accounts.ts`)
- **Message processing** — Inbound message sync → agent dispatch via `dispatchReplyFromConfig` pattern (`bot.ts`)
- **Reply dispatcher** — Agent reply → text chunking → WeChat send_msg API bridge (`reply-dispatcher.ts`)
- **Outbound adapter** — `ChannelOutboundAdapter` for proactive messaging (`outbound.ts`)
- **Channel plugin** — Full `ChannelPlugin` implementation with multi-account support (`channel.ts`)
- **Config schema** — JSON schema for plugin configuration validation (`config-schema.ts`)
- **Verify server** — Standalone URL verification server for initial WeChat backend setup (`verify-server.cjs`)
- **File messages** — Send/receive file attachments via media_id upload
- **Voice messages** — Send voice messages with media upload support
- **Link messages** — Send rich link cards with title, description, URL, and thumbnail
- **Unicode formatting** — Text formatting utilities for WeChat message display
- **Tests** — 8 crypto tests (encrypt/decrypt roundtrip, signatures)
- **Documentation** — Architecture overview, WeCom KF API reference, plugin SDK analysis, full README
