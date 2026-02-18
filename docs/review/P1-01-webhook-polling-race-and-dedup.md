# P1-01: Webhook/轮询竞态条件 + 消息去重

## 来源

Business Logic 审查 H1 + H4

## 问题描述

Webhook 回调和 30s 轮询**同时运行**，二者都会对同一个 `openKfId` 调用 `handleWebhookEvent()` 执行 `sync_msg`。没有任何互斥机制，导致：

1. **重复消息处理**: 两路并发各自读到相同 cursor，拉取到相同消息，重复分发给 agent。
2. **Cursor 竞态**: 两路并发各自写入 next_cursor，后写覆盖先写，cursor 可能回退。
3. **缺少 msgid 去重**: 即使出现重复拉取，也没有基于 `msg.msgid` 的去重检查。

竞态时序示例：

```
T0: Webhook 触发 -> loadCursor() = "A"
T1: 轮询触发    -> loadCursor() = "A"
T2: Webhook sync_msg(cursor="A") -> M1,M2, next_cursor="B"
T3: Webhook saveCursor("B"), 处理 M1,M2
T4: 轮询 sync_msg(cursor="A") -> 又拿到 M1,M2
T5: 轮询 saveCursor("B"), 再次处理 M1,M2（重复!）
```

## 目标

确保同一 kfId 同一时刻只有一个 sync_msg 流程在执行；即使出现意外重复拉取，也能通过 msgid 去重避免重复分发。

## 具体改动

### 1. 添加 per-kfId 异步锁

在 `bot.ts` 中实现简易 mutex，确保同一 kfId 的 `handleWebhookEvent` 串行执行：

```typescript
const kfLocks = new Map<string, Promise<void>>();

export async function handleWebhookEvent(ctx, openKfId, syncToken) {
  const prev = kfLocks.get(openKfId);
  let release: () => void;
  const current = new Promise<void>(r => { release = r; });
  kfLocks.set(openKfId, current);
  try {
    await prev;
    await _handleWebhookEventInner(ctx, openKfId, syncToken);
  } finally {
    release!();
    if (kfLocks.get(openKfId) === current) kfLocks.delete(openKfId);
  }
}
```

### 2. 添加 msgid 去重

使用固定大小的 Set（LRU 风格）记录已处理的 msgid：

```typescript
const processedMsgIds = new Set<string>();
const MAX_IDS = 10000;

function isDuplicate(msgid: string): boolean {
  if (processedMsgIds.has(msgid)) return true;
  if (processedMsgIds.size >= MAX_IDS) {
    const arr = [...processedMsgIds];
    processedMsgIds.clear();
    for (const id of arr.slice(arr.length / 2)) processedMsgIds.add(id);
  }
  processedMsgIds.add(msgid);
  return false;
}
```

在消息处理循环中增加去重检查：

```typescript
for (const msg of resp.msg_list ?? []) {
  if (msg.origin !== 3) continue;
  if (isDuplicate(msg.msgid)) continue; // 跳过已处理
  // ...
}
```

## 验收标准

- [ ] 并发调用同一 kfId 的 `handleWebhookEvent` 时，第二个调用等待第一个完成后再执行
- [ ] 同一 msgid 只会被 `dispatchMessage` 处理一次
- [ ] 新增单元测试：模拟并发调用，验证锁的串行化行为
- [ ] 新增单元测试：连续传入相同 msgid，验证去重生效
- [ ] 去重 Set 超过上限时自动清理，不会无限增长

## 涉及文件

- `src/bot.ts` — 添加 mutex + 去重逻辑
- `src/bot.test.ts` — 新增测试
