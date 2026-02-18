# P3-01: Token 缓存 key 避免明文 appSecret

## 来源

API Layer 审查 H1

## 问题描述

`token.ts` 使用 `${corpId}:${appSecret}` 作为缓存 Map 的 key。虽然是内存中的 Map，但如果任何调试工具、heap dump 或日志序列化了 Map 内容，appSecret 会被完整暴露。

## 目标

使用 appSecret 的哈希值作为 cache key，防止意外泄露。

## 具体改动

```typescript
import { createHash } from "node:crypto";

function makeCacheKey(corpId: string, appSecret: string): string {
  const hash = createHash("sha256").update(appSecret).digest("hex").slice(0, 16);
  return `${corpId}:${hash}`;
}
```

将 `getAccessToken` 和 `clearAccessToken` 中的 `${corpId}:${appSecret}` 替换为 `makeCacheKey(corpId, appSecret)`。

## 验收标准

- [ ] 缓存 key 不包含明文 appSecret
- [ ] 不同 appSecret 产生不同 key（哈希碰撞概率可忽略）
- [ ] 现有功能不受影响（`pnpm test` 通过）

## 涉及文件

- `src/token.ts` — 修改 cache key 生成逻辑
