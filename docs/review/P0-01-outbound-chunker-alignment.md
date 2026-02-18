# P0-01: 声明 chunker 函数 + 统一 textChunkLimit

## 来源

OpenClaw 框架源码分析（`src/infra/outbound/deliver.ts`, `src/auto-reply/chunk.ts`）

## 源码调查结论

通过阅读 OpenClaw 源码确认：

1. **框架不会自动分块**，除非 channel 声明了 `chunker` 函数
2. 分块逻辑在 `deliverOutboundPayloads()` → `sendTextChunks()` 中：
   - 若 `handler.chunker` 为 null/undefined → 直接调用 `sendText(fullText)`，**不分块**
   - 若 `handler.chunker` 存在 → 根据 `chunkMode`（`"length"` | `"newline"`）执行分块后逐块调用 `sendText`
3. `chunkerMode` 的实际值是 `"text"` | `"markdown"`（非之前猜测的 `"split"` | `"none"`）
4. `chunkMode` 是用户配置（`"length"` | `"newline"`），`chunkerMode` 是 adapter 声明的分块算法类型

### 其他 channel 的做法

| Channel | chunker | chunkerMode | textChunkLimit |
|---------|---------|-------------|---------------|
| WhatsApp | `chunkText` | `"text"` | 4000 |
| Telegram | `chunkMarkdownText` | `"markdown"` | 4000 |
| iMessage | `chunkText` | `"text"` | 4000 |
| Discord | `null` | N/A | 2000 |
| Slack | `null` | N/A | 4000 |

## 问题描述

当前 wechat-kf 的 outbound 没有声明 `chunker`：

```typescript
// 当前 outbound.ts
export const wechatKfOutbound = {
  deliveryMode: "direct" as const,
  textChunkLimit: 2000,
  // ← 没有 chunker → 框架不分块 → sendText 收到完整长文本
  sendText: async (...) => { ... },
};
```

这意味着如果 agent 回复超过 2000 字符，sendText 会把完整文本直接发给微信 API，**超过微信 2048 字符限制会导致消息被截断**。

## 目标

1. 声明 `chunker` 函数让框架自动分块
2. 统一 `textChunkLimit` 常量
3. `sendText` 不需要内部分块（框架已处理）

## 具体改动

### 1. 声明 chunker（参考 WhatsApp 实现）

```typescript
// src/outbound.ts
import { chunkText } from "./chunk-utils.js";

export const wechatKfOutbound = {
  deliveryMode: "direct" as const,
  chunker: (text: string, limit: number) => chunkText(text, limit),
  chunkerMode: "text" as const,
  textChunkLimit: WECHAT_TEXT_CHUNK_LIMIT,

  sendText: async ({ cfg, to, text, accountId }: any) => {
    // text 已经是分块后的短文本，直接发送
    const account = resolveAccount(cfg, accountId);
    // ...
  },
};
```

### 2. 实现 chunkText 工具函数

框架内置的 `chunkText` 不能直接 import（插件是独立包），需要自己实现一个等效的：

```typescript
// src/chunk-utils.ts
export function chunkText(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > limit) {
    const window = remaining.slice(0, limit);
    // 优先在换行处断开
    let breakIdx = window.lastIndexOf("\n");
    // 其次在空白处断开
    if (breakIdx <= 0) breakIdx = window.lastIndexOf(" ");
    // 最后硬切
    if (breakIdx <= 0) breakIdx = limit;

    chunks.push(remaining.slice(0, breakIdx).trimEnd());
    remaining = remaining.slice(breakIdx).trimStart();
  }

  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}
```

### 3. 统一常量

```typescript
// src/constants.ts
/** 微信客服文本消息长度上限（字符） */
export const WECHAT_TEXT_CHUNK_LIMIT = 2000;
```

`reply-dispatcher.ts:31` 的 `fallbackLimit: 2048` 也改为引用此常量。

### 4. sendText 简化

框架分块后 `sendText` 收到的已是短文本，不需要内部分块逻辑。当前代码已经是直接发送，**不需要改动**。

## 框架类型参考

```typescript
// OpenClaw ChannelOutboundAdapter (types.adapters.ts:93-110)
export type ChannelOutboundAdapter = {
  deliveryMode: "direct" | "gateway" | "hybrid";
  chunker?: ((text: string, limit: number) => string[]) | null;
  chunkerMode?: "text" | "markdown";
  textChunkLimit?: number;
  // ...
};
```

## 验收标准

- [ ] outbound 声明了 `chunker` 函数
- [ ] outbound 声明了 `chunkerMode: "text"`
- [ ] `textChunkLimit` 引用统一常量 `WECHAT_TEXT_CHUNK_LIMIT`
- [ ] `reply-dispatcher.ts` 的 `fallbackLimit` 引用同一常量
- [ ] 发送 5000+ 字符消息不会被截断，分块后每块 ≤ 2000 字符
- [ ] 分块在换行/空白处优先断开，不会劈开单词

## 取代的原有 TODO

- **P1-06** (outbound text chunking) — 完全取代
- **P2-04** 中 outbound 相关部分 — 部分取代

## 涉及文件

- `src/outbound.ts` — 声明 chunker + chunkerMode
- `src/chunk-utils.ts` — 新建，chunkText 实现
- `src/constants.ts` — 新建，统一常量
- `src/reply-dispatcher.ts` — fallbackLimit 引用常量
