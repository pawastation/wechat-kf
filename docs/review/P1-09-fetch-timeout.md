# P1-09: 全局 fetch 调用增加超时控制

## 来源

API Layer 审查 M5 + Business Logic 审查 M3（跨层共性问题）

## 问题描述

所有 `fetch` 调用（`api.ts` 的 `apiPost`、`downloadMedia`、`uploadMedia`，`token.ts` 的 `fetchAccessToken`）均未设置超时。如果企业微信 API 响应缓慢或网络中断，调用方可能无限挂起。

在轮询场景中，如果 sync_msg 请求挂起超过 30 秒，后续轮询虽然被 `polling` 标志跳过，但轮询频率会下降，消息延迟。

## 目标

所有对外 HTTP 请求设置合理超时，避免无限挂起。Node.js 18+ 原生支持 `AbortSignal.timeout()`。

## 具体改动

### api.ts

```typescript
// apiPost
const resp = await fetch(`${BASE}${path}?access_token=${token}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(30_000), // 30s
});

// downloadMedia
const resp = await fetch(url, {
  signal: AbortSignal.timeout(60_000), // 60s，媒体下载允许更长
});

// uploadMedia
const resp = await fetch(url, {
  method: "POST",
  body: formData,
  signal: AbortSignal.timeout(60_000), // 60s
});
```

### token.ts

```typescript
const resp = await fetch(url, {
  signal: AbortSignal.timeout(15_000), // 15s，token 请求应快速
});
```

可选：提取超时常量到公共位置。

## 验收标准

- [ ] `apiPost`、`downloadMedia`、`uploadMedia`、`fetchAccessToken` 所有 fetch 调用都有 `signal` 参数
- [ ] API 调用超时 30s，媒体操作超时 60s，token 获取超时 15s
- [ ] 超时后抛出的错误信息包含明确的超时说明（`AbortError` 类型）
- [ ] 新增测试：mock 延迟响应，验证超时后正确抛出异常

## 涉及文件

- `src/api.ts` — 所有 fetch 调用增加 signal
- `src/token.ts` — fetchAccessToken 增加 signal
- `src/api.test.ts` — 新增超时测试
