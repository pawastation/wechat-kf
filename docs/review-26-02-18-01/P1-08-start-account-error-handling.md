# P1-08: startAccount 异常时更新状态为失败

## 来源

Plugin Interface 审查 H3

## 问题描述

`channel.ts` 的 `gateway.startAccount` 在调用 `startMonitor` 前设置了 `running: true` 状态，但如果 `startMonitor` 抛出异常（如端口被占用），状态不会回滚，永远停留在 `running: true`。

```typescript
ctx.setStatus?.({ accountId: ctx.accountId, port, running: true, ... });
await startMonitor({ ... }); // 异常时状态不回滚
```

## 目标

`startAccount` 失败时正确更新状态为 `running: false`，记录错误信息，确保状态与实际一致。

## 具体改动

```typescript
gateway: {
  startAccount: async (ctx: any) => {
    // ...
    const port = config.webhookPort ?? 9999;
    try {
      ctx.setStatus?.({
        accountId: ctx.accountId,
        port,
        running: true,
        lastStartAt: new Date().toISOString(),
      });
      await startMonitor({ ... });
    } catch (err) {
      ctx.setStatus?.({
        accountId: ctx.accountId,
        port,
        running: false,
        lastError: err instanceof Error ? err.message : String(err),
        lastStopAt: new Date().toISOString(),
      });
      throw err; // 继续传播异常
    }
  },
},
```

## 验收标准

- [ ] `startMonitor` 抛出异常时，`ctx.setStatus` 被调用并设置 `running: false`
- [ ] 状态中包含 `lastError` 字段记录错误信息
- [ ] 异常仍被正常传播（re-throw）
- [ ] 新增测试：mock `startMonitor` 抛出端口占用异常，验证状态更新为 failed

## 涉及文件

- `src/channel.ts` — `gateway.startAccount` 增加 try/catch
- `src/channel.test.ts` — 新增测试
