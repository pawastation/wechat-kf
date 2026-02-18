# P1-06: outbound.sendText 文本分块 + 统一 chunk 限制常量

## 来源

Presentation 审查 H1 + H2

## 问题描述

### 问题 1：outbound.sendText 未分块

`outbound.ts` 声明了 `textChunkLimit: 2000`，但 `sendText` 方法直接将全文发送，未调用任何分块逻辑。超过 2048 字符的文本会被企业微信 API 截断或拒绝。

```typescript
// outbound.ts — 直接发送，未分块
const formatted = markdownToUnicode(text);
await sendTextMessage(..., formatted);
```

而 `reply-dispatcher.ts` 正确地调用了 `chunkTextWithMode`。

### 问题 2：chunk 限制值不一致

- `outbound.ts`: `textChunkLimit: 2000`
- `reply-dispatcher.ts`: `fallbackLimit: 2048`

两处值不同，且未确认微信 API 限制是字节还是字符。

## 目标

1. `outbound.sendText` 正确分块后发送
2. 统一 chunk 限制常量
3. 确认并正确处理微信 API 的字节/字符限制

## 具体改动

### 1. 提取公共常量

```typescript
// src/constants.ts
export const WECHAT_TEXT_CHUNK_LIMIT = 2000; // 保守值，留安全余量
```

### 2. outbound.sendText 增加分块

确认 OpenClaw 框架是否在调用 `outbound.sendText` 前根据 `textChunkLimit` 自动分块：
- **如果框架自动分块**: 无需修改 sendText 内部逻辑，但应统一 `textChunkLimit` 值
- **如果框架不分块**: 在 sendText 内部实现分块

```typescript
sendText: async ({ cfg, to, text, accountId }: any) => {
  // ...
  const formatted = markdownToUnicode(text);
  // 若框架不自动分块，需要手动分块
  const chunks = chunkText(formatted, WECHAT_TEXT_CHUNK_LIMIT);
  for (const chunk of chunks) {
    await sendTextMessage(account.corpId, account.appSecret, externalUserId, openKfId, chunk);
  }
  // ...
},
```

### 3. 统一 reply-dispatcher.ts

```typescript
// reply-dispatcher.ts
import { WECHAT_TEXT_CHUNK_LIMIT } from "./constants.js";
const textChunkLimit = /* 从 runtime 获取 */ ?? WECHAT_TEXT_CHUNK_LIMIT;
```

## 验收标准

- [ ] 两处 chunk 限制引用同一个常量
- [ ] `outbound.sendText` 对超长文本正确分块发送
- [ ] 新增测试：传入 5000 字符文本，验证被拆分为多条消息
- [ ] 新增测试：传入短文本（<2000 字符），验证仍为一条消息
- [ ] Unicode 数学字符（粗体/斜体转换后）的 UTF-8 字节膨胀不会导致超限（需确认 API 限制单位）

## 涉及文件

- `src/constants.ts` — 新建，定义公共常量
- `src/outbound.ts` — 修改 sendText 实现分块
- `src/reply-dispatcher.ts` — 引用公共常量
- `src/outbound.test.ts` — 新增测试
