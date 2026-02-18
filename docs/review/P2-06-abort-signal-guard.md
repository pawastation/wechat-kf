# P2-06: AbortSignal 已 abort 时的防护检查

## 来源

Business Logic 审查 H5

## 问题描述

`monitor.ts` 中 `startMonitor` 无条件创建 `setInterval` 轮询定时器，然后注册 `abortSignal.addEventListener("abort", ...)`。但如果调用时 signal 已经 aborted：

1. `setInterval` 仍被创建
2. 根据 Web 标准，对已 aborted 的 signal 调用 `addEventListener("abort", callback)` **不会**触发回调
3. 轮询定时器永远不会被清理

## 目标

在创建资源前检查 signal 状态，确保已 abort 的 signal 不会导致资源泄漏。

## 具体改动

```typescript
// monitor.ts startMonitor 函数开头
if (abortSignal?.aborted) {
  log?.info("[wechat-kf] abort signal already triggered, skipping monitor start");
  return server; // 或直接 return
}

// 创建轮询定时器后
const pollTimer = setInterval(async () => { ... }, POLL_INTERVAL_MS);

// 注册清理回调
if (abortSignal) {
  const cleanup = () => {
    clearInterval(pollTimer);
    server.close();
    log?.info("[wechat-kf] webhook server + polling stopped");
  };

  if (abortSignal.aborted) {
    cleanup(); // 双重保护
  } else {
    abortSignal.addEventListener("abort", cleanup, { once: true });
  }
}
```

## 验收标准

- [ ] 传入已 aborted 的 signal 时，不创建轮询定时器，不启动 server
- [ ] 正常 signal 时行为不变
- [ ] 新增测试：传入 `AbortSignal.abort()` 的 signal，验证不创建资源
- [ ] 新增测试：传入正常 signal 后 abort，验证资源被正确清理

## 涉及文件

- `src/monitor.ts` — 增加 abort 状态检查
- `src/monitor.test.ts` — 新增测试
