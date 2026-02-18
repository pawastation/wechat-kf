# P3-04: HTTP 媒体 URL 下载 + 5 条消息限制感知

## 来源

Presentation 审查 M4（HTTP URL）+ M5（5 条限制）

## 问题描述

### 1. HTTP URL 媒体不支持下载上传（M4）
当 `mediaUrl` 是 HTTP URL 时，`outbound.sendMedia` 直接将 URL 作为纯文本发送。用户只收到链接文本而非实际图片/文件。

### 2. 5 条消息限制未感知（M5）
企业微信客服 API 在 48 小时窗口内限制每次会话最多 5 条消息。分块后的多条消息 + 附件可能超出限制。超限后 API 返回 errcode 95026。

## 目标

1. 支持从 HTTP URL 下载媒体并上传到微信临时素材
2. 感知 5 条消息限制，在超限时给出明确日志

## 具体改动

### 1. HTTP URL 媒体下载

```typescript
// outbound.ts sendMedia 中
if (resolvedPath?.startsWith("http")) {
  const resp = await fetch(resolvedPath, { signal: AbortSignal.timeout(60_000) });
  if (!resp.ok) throw new Error(`Failed to download media: ${resp.status}`);
  buffer = Buffer.from(await resp.arrayBuffer());
  const urlPath = new URL(resolvedPath).pathname;
  filename = basename(urlPath) || "download";
  ext = extname(filename);
}
```

### 2. 消息限制感知

```typescript
// 发送消息时检测 95026 错误码
try {
  await sendTextMessage(...);
} catch (err) {
  if (err.message?.includes("95026")) {
    log?.error("[wechat-kf] message limit exceeded (5 msgs per session window)");
    // 可选：合并剩余 chunk 或截断
    break;
  }
  throw err;
}
```

可选：本地追踪每个会话的已发送消息数，提前避免超限。

## 验收标准

- [ ] `sendMedia` 支持 `http://` 和 `https://` 开头的 mediaUrl
- [ ] 下载的媒体被正确上传到微信临时素材并发送
- [ ] 下载超时（60s）后抛出清晰错误
- [ ] 95026 错误码被识别并记录明确日志
- [ ] 新增测试：mock HTTP URL 下载 + 上传流程

## 涉及文件

- `src/outbound.ts` — 增加 HTTP URL 下载逻辑
- `src/reply-dispatcher.ts` — 可选：同步增加 95026 检测
- `src/outbound.test.ts` — 新增测试
