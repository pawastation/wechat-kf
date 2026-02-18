# P0-03: 明确两条出站路径的职责边界

## 来源

OpenClaw 框架源码分析 + 原 P2-04 重新评估

## 源码调查结论

通过阅读框架源码，两条路径的职责区别更加明确：

### 路径 A: `outbound.ts`（框架标准路径）

- **调用方**: 框架 `deliverOutboundPayloads()` → `sendTextChunks()` → `handler.sendText()`
- **分块**: 框架根据 `chunker` + `textChunkLimit` 自动分块后再调用 sendText
- **场景**: Agent 回复后框架路由的标准投递
- **sendText 收到的是已分块的短文本**

### 路径 B: `reply-dispatcher.ts`（插件内部路径）

- **调用方**: `bot.ts` 入站消息后通过 runtime API 创建 dispatcher
- **分块**: 显式调用 `core.channel.text.chunkTextWithMode()`
- **场景**: 带 typing 模拟的流式回复
- **自行管理分块和发送节奏**

### 关键确认

两条路径职责本质不同，**不应统一**。但存在重复代码（Markdown 转换、媒体处理），应提取共享工具。

## 目标

1. 明确两条路径的职责分工，在代码中文档化
2. 提取共享的底层工具（Markdown 转换、媒体上传），避免重复实现
3. 策略：共享基础设施，保持路径独立

## 具体改动

### 1. 提取共享工具

```typescript
// src/send-utils.ts — 底层共享工具，不含路径逻辑

import { markdownToUnicode } from "./unicode-format.js";
import { uploadMedia, sendImageMessage, sendVoiceMessage, sendVideoMessage, sendFileMessage } from "./api.js";

/** 统一的 Markdown→Unicode 转换 */
export function formatText(text: string): string {
  return markdownToUnicode(text);
}

/** 根据文件扩展名检测媒体类型 */
export function detectMediaType(ext: string): "image" | "voice" | "video" | "file" {
  ext = ext.toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"].includes(ext)) return "image";
  if ([".amr", ".mp3", ".wav", ".ogg", ".silk", ".m4a", ".aac"].includes(ext)) return "voice";
  if ([".mp4", ".avi", ".mov", ".mkv", ".wmv"].includes(ext)) return "video";
  return "file";
}

/** 统一的媒体上传+发送 */
export async function uploadAndSendMedia(
  corpId: string,
  appSecret: string,
  toUser: string,
  openKfId: string,
  buffer: Buffer,
  filename: string,
  mediaType: "image" | "voice" | "video" | "file",
): Promise<{ msgid: string }> {
  const uploaded = await uploadMedia(corpId, appSecret, mediaType, buffer, filename);
  const mid = uploaded.media_id;
  switch (mediaType) {
    case "image": return sendImageMessage(corpId, appSecret, toUser, openKfId, mid);
    case "voice": return sendVoiceMessage(corpId, appSecret, toUser, openKfId, mid);
    case "video": return sendVideoMessage(corpId, appSecret, toUser, openKfId, mid);
    default:      return sendFileMessage(corpId, appSecret, toUser, openKfId, mid);
  }
}
```

### 2. 两条路径各自引用共享工具

```typescript
// outbound.ts
import { formatText, detectMediaType, uploadAndSendMedia } from "./send-utils.js";

// reply-dispatcher.ts
import { formatText, detectMediaType, uploadAndSendMedia } from "./send-utils.js";
```

### 3. 在代码头部注释中明确职责

```typescript
// outbound.ts
/**
 * Standard outbound adapter — called by OpenClaw framework for direct delivery.
 * Text is pre-chunked by framework via the declared `chunker` function.
 * For typing-aware delivery, see reply-dispatcher.ts instead.
 */

// reply-dispatcher.ts
/**
 * Typing-aware reply dispatcher — used internally by bot.ts for inbound message replies.
 * Manually handles text chunking via runtime API (core.channel.text.chunkTextWithMode).
 * For framework standard delivery, see outbound.ts instead.
 */
```

## 验收标准

- [ ] 共享的 Markdown 转换、媒体类型检测、媒体上传+发送逻辑提取到 `send-utils.ts`
- [ ] `outbound.ts` 和 `reply-dispatcher.ts` 都引用共享工具
- [ ] 两个文件头部有清晰的职责注释
- [ ] `detectMediaType` 不再在 `outbound.ts` 中重复定义
- [ ] 功能不退化

## 取代的原有 TODO

- **P2-04** (统一两条发送路径) — 完全取代，策略从"统一"改为"共享基础设施"

## 涉及文件

- `src/send-utils.ts` — 新建，共享工具
- `src/outbound.ts` — 引用共享工具 + 职责注释
- `src/reply-dispatcher.ts` — 引用共享工具 + 职责注释
