# P2-12: Webhook 服务器加固

## 来源

Business Logic 审查 L7（body 大小限制）+ M8（server error handler）+ M7（console.error）

## 问题描述

### 1. 请求体无大小限制（L7）
`webhook.ts` 的 `readBody` 没有限制请求体大小，攻击者可发送巨大 POST body 导致内存耗尽。

### 2. server.on("error") 的持久监听器（M8）
`monitor.ts` 中 `server.on("error", ...)` 注册的是持久监听器。listen 成功后，后续 server 运行时错误仍会触发该 handler，试图 reject 已 settled 的 Promise。

### 3. console.error 未使用结构化 logger（M7）
`webhook.ts` 中错误日志直接用 `console.error`，绕过 OpenClaw 日志系统。

## 目标

加固 webhook 服务器的安全性和错误处理。

## 具体改动

### 1. readBody 增加大小限制

```typescript
function readBody(req: IncomingMessage, maxSize = 64 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > maxSize) {
        req.destroy();
        reject(new Error("[wechat-kf] request body too large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
```

### 2. server.listen 使用 once 并移除

```typescript
await new Promise<void>((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("...")), 10_000);
  const onError = (err: Error) => { clearTimeout(timeout); reject(err); };
  server.once("error", onError);
  server.listen(webhookPort, () => {
    clearTimeout(timeout);
    server.removeListener("error", onError);
    resolve();
  });
});
```

### 3. 将 log 对象传入 webhook

```typescript
// WebhookOptions 增加 log 字段
export interface WebhookOptions {
  // ...
  log?: { info: (...a: any[]) => void; error: (...a: any[]) => void };
}

// webhook.ts 中使用 log 替代 console.error
opts.log?.error("[wechat-kf] onEvent error:", err) ?? console.error("...");
```

## 验收标准

- [ ] 超过 64KB 的请求体被拒绝，连接被关闭
- [ ] server.listen 成功后，error handler 被移除
- [ ] webhook.ts 中的 console.error 替换为 log 对象
- [ ] 新增测试：发送超大 body，验证被拒绝
- [ ] 新增测试：server.listen error handler 使用 once

## 涉及文件

- `src/webhook.ts` — readBody 大小限制 + log 替换
- `src/monitor.ts` — server.listen error handler 修复
