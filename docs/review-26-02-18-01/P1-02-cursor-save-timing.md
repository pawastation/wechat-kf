# P1-02: Cursor 保存时机调整为消息处理之后

## 来源

Business Logic 审查 H3

## 问题描述

当前 `handleWebhookEvent` 的 while 循环中，cursor 在消息处理**之前**保存：

```typescript
if (resp.next_cursor) {
  cursor = resp.next_cursor;
  await saveCursor(stateDir, openKfId, cursor);  // 先保存
}
for (const msg of resp.msg_list ?? []) {
  // 如果这里崩溃，cursor 已前进但消息未处理 → 丢消息
}
```

这是 "at-most-once" 语义。对客服场景，"at-least-once"（先处理后保存）+ 幂等性更合适。

## 目标

将消息处理语义从 at-most-once 改为 at-least-once，避免进程崩溃时丢消息。配合 P1-01 的 msgid 去重保证幂等性。

## 具体改动

将 `saveCursor` 移到消息处理循环**之后**：

```typescript
// bot.ts handleWebhookEvent 内循环
const messages = resp.msg_list ?? [];
for (const msg of messages) {
  if (msg.origin !== 3) continue;
  if (isDuplicate(msg.msgid)) continue;
  const text = extractText(msg);
  if (text === null || text === "") continue;
  try {
    await dispatchMessage(ctx, account, msg, text);
  } catch (err) {
    log?.error(`[wechat-kf:${openKfId}] dispatch error for msgid=${msg.msgid}: ${err}`);
    // 单条失败不阻塞后续消息
  }
}

// 所有消息处理完毕后再保存 cursor
if (resp.next_cursor) {
  cursor = resp.next_cursor;
  await saveCursor(stateDir, openKfId, cursor);
}
```

## 验收标准

- [ ] `saveCursor` 调用发生在 `for (const msg ...)` 循环之后
- [ ] 单条消息处理失败（`dispatchMessage` 抛异常）不影响后续消息处理和 cursor 保存
- [ ] 新增测试：模拟消息处理中途异常，验证 cursor 仍被正确保存
- [ ] 配合 P1-01 的去重机制，重启后重复拉取的消息不会被再次分发

## 涉及文件

- `src/bot.ts` — 调整 saveCursor 位置
- `src/bot.test.ts` — 新增测试

## 依赖

- P1-01（去重机制）应先行或同步实施，否则 at-least-once 语义会导致重复处理
