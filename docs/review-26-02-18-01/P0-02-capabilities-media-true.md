# P0-02: 修正 capabilities.media = true

## 来源

OpenClaw 框架源码分析（`src/infra/outbound/deliver.ts`, `src/channels/plugins/types.core.ts`）

## 源码调查结论

通过阅读 OpenClaw 源码确认：

1. **`capabilities.media` 是纯声明性字段**，不影响运行时路由
2. 框架路由逻辑（`deliver.ts:538-569`）仅看 payload 中有无 `mediaUrls`，**不检查 capabilities**
3. 即使 `media: false`，框架仍会在 payload 含媒体时调用 `sendMedia`
4. `capabilities.media` 的实际用途：
   - Agent prompt 提示（告诉 agent 该 channel 是否支持媒体）
   - CLI capabilities 报告
   - UI 展示
   - 未来可能用于过滤

### 影响修正

- 原以为 `media: false` 导致 sendMedia 是"死代码" — **错误**，sendMedia 已经在工作
- 但 `media: false` 导致 **agent 不知道可以发媒体**，这是实际问题
- 紧迫度从"功能缺失"降为"声明不准确 + agent 提示缺失"

## 问题描述

`channel.ts:36` 声明 `capabilities.media: false`，但 `outbound.ts` 已实现完整的 `sendMedia`。Agent prompt 中写着 "Only text messages supported (Phase 1)"，与实际能力不符。

## 目标

正确声明媒体能力，让 agent 知道可以发送媒体消息。

## 具体改动

### 1. 修改 capabilities

```typescript
capabilities: {
  chatTypes: ["direct"],
  media: true,          // ← 改为 true
  reactions: false,
  threads: false,
  polls: false,
  nativeCommands: false,
  blockStreaming: false,
},
```

### 2. 修改 agentPrompt

```typescript
agentPrompt: {
  messageToolHints: () => [
    "- WeChat KF: omit `target` to reply to current conversation.",
    "- Supports text and media messages (image, voice, video, file).",
    "- 48h reply window, max 5 replies per window.",
  ],
},
```

### 3. sendMedia 中的附带文本做 Markdown 转换

当前 `outbound.ts:74-76` 发送附带文本时没有经过 `markdownToUnicode` 转换：

```typescript
// 当前代码
if (text?.trim()) {
  await sendTextMessage(..., text);  // ← 原始 markdown
}

// 修改为
if (text?.trim()) {
  const formatted = markdownToUnicode(text);
  await sendTextMessage(..., formatted);
}
```

### 4. reply-dispatcher 扩展媒体类型

当前 `reply-dispatcher.ts` 只处理 `type === "image"` 附件。应扩展为支持所有类型：

```typescript
for (const attachment of attachments) {
  if (attachment.path) {
    try {
      const buffer = await readFile(attachment.path);
      const ext = extname(attachment.path).toLowerCase();
      const mediaType = detectMediaType(ext);
      const filename = basename(attachment.path);
      const uploaded = await uploadMedia(corpId, appSecret, mediaType, buffer, filename);
      // 根据 mediaType 调用对应 send 函数
    } catch (err) {
      params.runtime?.error?.(`[wechat-kf] failed to send ${mediaType} attachment: ${err}`);
    }
  }
}
```

## 验收标准

- [ ] `capabilities.media` 为 `true`
- [ ] `agentPrompt` 反映媒体支持能力
- [ ] `sendMedia` 中的附带文本经过 `markdownToUnicode` 转换
- [ ] `reply-dispatcher` 支持 image/voice/video/file 四种附件类型
- [ ] Agent 在对话中知道自己可以发送媒体消息

## 取代的原有 TODO

- **P2-04** 中 M1 (sendMedia 文本未转换) — 完全取代
- **P2-04** 中 M6 (reply-dispatcher 仅 image) — 完全取代

## 涉及文件

- `src/channel.ts` — capabilities + agentPrompt
- `src/outbound.ts` — sendMedia 文本转换
- `src/reply-dispatcher.ts` — 扩展媒体类型
