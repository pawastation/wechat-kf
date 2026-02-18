# P2-11: startAccount 生命周期和 Server 引用管理

## 来源

Plugin Interface 审查 H2

## 问题描述

`gateway.startAccount` 调用 `startMonitor` 后：

1. `startMonitor` 在 `server.listen` 成功后就返回 `Server` 对象，`startAccount` 随即 resolve。如果 OpenClaw 期望 `startAccount` 在整个生命周期内保持 pending，当前行为是错误的。
2. 返回的 `Server` 对象被丢弃，无法在 channel 层查询 server 状态或实际端口。

## 目标

明确 `startAccount` 的生命周期语义，保留 Server 引用以支持状态查询。

## 具体改动

### 1. 确认 OpenClaw 的期望行为

查阅 OpenClaw 文档确认 `startAccount` 应该：
- **方案 A**: 启动后立即 resolve（fire-and-forget） → 当前行为可接受，只需保留 Server 引用
- **方案 B**: 保持 pending 直到 abort → 需要增加 await

### 2. 如果是方案 B

```typescript
gateway: {
  startAccount: async (ctx: any) => {
    // ...
    const server = await startMonitor({ ... });

    // 保持 pending 直到 abortSignal 触发
    if (ctx.abortSignal) {
      await new Promise<void>((resolve) => {
        ctx.abortSignal.addEventListener("abort", () => resolve(), { once: true });
      });
    }
  },
},
```

### 3. 保留 Server 引用（两种方案都需要）

```typescript
// 模块级或通过 context 传递
const activeServers = new Map<string, Server>();

// startAccount 中
const server = await startMonitor({ ... });
activeServers.set(ctx.accountId, server);

// status 查询中可使用
// const server = activeServers.get(accountId);
// const addr = server?.address();
```

## 验收标准

- [ ] 确认 OpenClaw gateway 的 `startAccount` 生命周期语义
- [ ] Server 引用被保留，可用于状态查询
- [ ] abort 后 Server 引用被清理
- [ ] 如需保持 pending，`startAccount` 在 abortSignal 触发前不会 resolve

## 涉及文件

- `src/channel.ts` — 修改 `gateway.startAccount`
