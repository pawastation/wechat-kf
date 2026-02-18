# Changelog

All notable changes to this project will be documented in this file.

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
