# P2-04: 统一 reply-dispatcher 与 outbound 消息发送逻辑

## 来源

Presentation 审查 H6、M1、M6

## 问题描述

`reply-dispatcher.ts` 和 `outbound.ts` 都实现了消息发送逻辑，但行为不一致：

| 特性 | reply-dispatcher | outbound |
|------|-----------------|----------|
| 文本分块 | 有 (chunkTextWithMode) | 无 |
| Markdown 转换 | 有 | sendText 有, sendMedia 的 text 无 |
| 媒体类型 | 仅 image | image/voice/video/file |
| 错误处理 | try/catch 继续 | 无 try/catch |

具体不一致：
1. `outbound.sendMedia` 的附带文本未经 `markdownToUnicode` 转换
2. `reply-dispatcher` 只处理 image 类型附件，忽略 voice/video/file
3. 错误处理策略不同

## 目标

提取共享逻辑到公共模块，消除重复代码，确保两条路径行为一致。

## 具体改动

### 1. 提取公共发送函数

```typescript
// src/send-utils.ts
import { markdownToUnicode } from "./unicode-format.js";
import { sendTextMessage, uploadMedia, sendImageMessage, ... } from "./api.js";
import { WECHAT_TEXT_CHUNK_LIMIT } from "./constants.js";

export async function sendFormattedText(
  corpId: string,
  appSecret: string,
  toUser: string,
  openKfId: string,
  text: string,
  chunkFn?: (text: string, limit: number) => string[],
): Promise<void> {
  const formatted = markdownToUnicode(text);
  const chunks = chunkFn?.(formatted, WECHAT_TEXT_CHUNK_LIMIT) ?? [formatted];
  for (const chunk of chunks) {
    await sendTextMessage(corpId, appSecret, toUser, openKfId, chunk);
  }
}

export async function sendMediaAttachment(
  corpId: string,
  appSecret: string,
  toUser: string,
  openKfId: string,
  buffer: Buffer,
  filename: string,
  mediaType: "image" | "voice" | "video" | "file",
): Promise<void> {
  const uploaded = await uploadMedia(corpId, appSecret, mediaType, buffer, filename);
  // 根据 mediaType 调用对应的 send 函数
}
```

### 2. reply-dispatcher 扩展媒体类型

```typescript
// 不再只处理 image
for (const attachment of attachments) {
  const type = detectMediaType(attachment.path);
  try {
    await sendMediaAttachment(corpId, appSecret, toUser, openKfId, buffer, filename, type);
  } catch (err) {
    log?.error(`[wechat-kf] failed to send ${type} attachment: ${err}`);
  }
}
```

### 3. outbound.sendMedia 的文本也做 Markdown 转换

```typescript
if (text?.trim()) {
  await sendFormattedText(corpId, appSecret, toUser, openKfId, text);
}
```

## 验收标准

- [ ] 两条发送路径共享同一套文本格式化和分块逻辑
- [ ] `outbound.sendMedia` 的附带文本经过 `markdownToUnicode` 转换
- [ ] `reply-dispatcher` 支持 image/voice/video/file 四种附件类型
- [ ] 两条路径的错误处理策略文档化并一致
- [ ] 现有功能不退化（`pnpm test` 通过）

## 涉及文件

- `src/send-utils.ts` — 新建公共发送工具
- `src/outbound.ts` — 重构使用公共工具
- `src/reply-dispatcher.ts` — 重构使用公共工具
- `src/send-utils.test.ts` — 新增测试
