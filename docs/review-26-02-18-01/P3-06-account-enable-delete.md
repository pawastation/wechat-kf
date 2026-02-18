# P3-06: setAccountEnabled / deleteAccount 空操作处理

## 来源

Plugin Interface 审查 M3

## 问题描述

`channel.ts` 中 `setAccountEnabled` 和 `deleteAccount` 是空操作（直接返回原始 cfg），但 OpenClaw UI 可能允许用户执行这些操作。用户会误以为操作成功，但下次 webhook 回调时 kfId 仍然活跃。

```typescript
setAccountEnabled: ({ cfg, accountId, enabled }: any) => {
  // Dynamic accounts — no config mutation needed
  return cfg;
},
```

## 目标

对动态发现的 kfId 提供禁用/删除能力，或明确告知操作不支持。

## 具体改动

### 方案 A：维护黑名单

```typescript
// accounts.ts
const disabledKfIds = new Set<string>();

export function disableKfId(kfId: string) {
  disabledKfIds.add(kfId.toLowerCase());
}

export function removeKfId(kfId: string) {
  const lower = kfId.toLowerCase();
  discoveredKfIds.delete(lower);
  disabledKfIds.add(lower);
  persistKfIds();
}

export function isKfIdEnabled(kfId: string): boolean {
  return !disabledKfIds.has(kfId.toLowerCase());
}
```

在 `bot.ts` 消息处理中检查：

```typescript
if (!isKfIdEnabled(openKfId)) continue;
```

### 方案 B：返回错误信号

如果 OpenClaw 支持，返回一个标识表示操作不受支持。

## 验收标准

- [ ] 禁用的 kfId 不再处理消息
- [ ] 删除的 kfId 从已发现列表中移除
- [ ] 黑名单持久化，重启后仍生效
- [ ] 新增测试：禁用/删除 kfId 后验证消息不被处理

## 涉及文件

- `src/accounts.ts` — 添加禁用/删除逻辑
- `src/channel.ts` — `setAccountEnabled` / `deleteAccount` 实现
- `src/bot.ts` — 检查 kfId 是否启用
