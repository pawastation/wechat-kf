# 消息防抖聚合方案

## 背景

微信客服场景下，用户常常连续发送多条消息（如一段话拆成 2-3 条快速发送、先发文字再补图片）。当前实现中，每条消息独立触发一次 AI agent dispatch，导致：

1. **上下文碎片化** — agent 只看到第一条消息就开始回复，后续消息被当作新对话
2. **资源浪费** — 多次 agent 调用消耗 token 和算力
3. **回复混乱** — agent 对第一条消息的回复可能与第二条消息矛盾

### 方案方向

在收到消息后等待一个短暂窗口期（debounce），将同一用户的连续消息合并为一条 prompt 再派发给 AI。

## 架构变更

### 变更范围

| 文件                             | 变更类型 | 说明                                    |
| -------------------------------- | -------- | --------------------------------------- |
| `src/message-aggregator.ts`      | **新建** | 纯函数：分组 + 合并逻辑                 |
| `src/bot.ts`                     | 修改     | `_handleWebhookEventInner` 增加聚合路径 |
| `src/types.ts`                   | 修改     | 新增 `MessageAggregationConfig` 类型    |
| `src/config-schema.ts`           | 修改     | 新增 `messageAggregation` schema        |
| `openclaw.plugin.json`           | 修改     | 新增 `messageAggregation` 配置项        |
| `src/message-aggregator.test.ts` | **新建** | 聚合器单元测试                          |
| `src/bot.test.ts`                | 修改     | 扩展聚合相关集成测试                    |

### 数据流变化

```
当前流程:
  sync_msg → for each msg → extractText → dispatchMessage  (逐条派发)

聚合流程:
  sync_msg → filterValidMessages → groupConsecutiveByUser → for each group:
    → mergeTexts → dispatchMessage(mergedText, mediaFromAllMsgs)
    → sleep(debounceMs) → re-fetch sync_msg (跨批次防抖)
```

## 数据结构

### 配置类型

```typescript
// src/types.ts 新增
export type MessageAggregationConfig = {
  /** 是否启用消息聚合，默认 false */
  enabled?: boolean;
  /** 收到最后一条消息后等待的毫秒数，默认 1500 */
  debounceMs?: number;
  /** 单次聚合的最大消息数，默认 10 */
  maxMessages?: number;
};

// WechatKfConfig 新增字段
export type WechatKfConfig = {
  // ... 现有字段 ...
  messageAggregation?: MessageAggregationConfig;
};
```

### 聚合器接口

```typescript
// src/message-aggregator.ts

/** 一组来自同一用户的连续消息 */
export type MessageGroup = {
  userId: string;
  messages: WechatKfMessage[];
  texts: string[]; // 每条消息的 extractText 结果
  mediaIds: string[]; // 所有消息的 media_id 集合
};

/**
 * 将一批消息按 external_userid 分组连续消息。
 * 不同用户的消息会打断分组边界。
 *
 * 输入:  [A1, A2, B1, A3]
 * 输出:  [{userId:A, msgs:[A1,A2]}, {userId:B, msgs:[B1]}, {userId:A, msgs:[A3]}]
 */
export function groupConsecutiveByUser(
  messages: WechatKfMessage[],
): MessageGroup[];

/**
 * 将一组消息的文本合并为单条 prompt。
 * 单条消息直接返回原文；多条用换行分隔。
 */
export function mergeGroupTexts(group: MessageGroup): string;
```

## 实现步骤

### 步骤 1：新建 `src/message-aggregator.ts`

纯函数模块，无副作用，不依赖外部状态。

```typescript
import type { WechatKfMessage } from "./types.js";

export type MessageGroup = {
  userId: string;
  messages: WechatKfMessage[];
  texts: string[];
  mediaIds: string[];
};

export function groupConsecutiveByUser(
  messages: WechatKfMessage[],
  extractTextFn: (msg: WechatKfMessage) => string | null,
): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let current: MessageGroup | null = null;

  for (const msg of messages) {
    const text = extractTextFn(msg);
    // 跳过 event、非客户消息等无文本消息（与现有逻辑一致）
    if (text === null || text === "") continue;

    const userId = msg.external_userid;
    const mediaId =
      msg.image?.media_id ||
      msg.voice?.media_id ||
      msg.video?.media_id ||
      msg.file?.media_id;

    if (current && current.userId === userId) {
      current.messages.push(msg);
      current.texts.push(text);
      if (mediaId) current.mediaIds.push(mediaId);
    } else {
      current = {
        userId,
        messages: [msg],
        texts: [text],
        mediaIds: mediaId ? [mediaId] : [],
      };
      groups.push(current);
    }
  }

  return groups;
}

export function mergeGroupTexts(group: MessageGroup): string {
  if (group.texts.length === 1) return group.texts[0];
  return group.texts.join("\n");
}
```

### 步骤 2：修改 `src/types.ts`

在 `WechatKfConfig` 类型中新增 `messageAggregation` 字段：

```typescript
export type WechatKfConfig = {
  enabled?: boolean;
  corpId?: string;
  appSecret?: string;
  token?: string;
  encodingAESKey?: string;
  webhookPath?: string;
  dmPolicy?: "open" | "pairing" | "allowlist" | "disabled";
  allowFrom?: string[];
  messageAggregation?: MessageAggregationConfig; // 新增
};
```

### 步骤 3：修改 `src/config-schema.ts`

新增 `messageAggregation` 对象 schema：

```typescript
messageAggregation: {
  type: "object" as const,
  properties: {
    enabled: { type: "boolean" as const, default: false },
    debounceMs: {
      type: "number" as const,
      default: 1500,
      minimum: 200,
      maximum: 10000,
      description: "收到最后一条消息后等待的毫秒数",
    },
    maxMessages: {
      type: "number" as const,
      default: 10,
      minimum: 2,
      maximum: 50,
      description: "单次聚合的最大消息数",
    },
  },
},
```

### 步骤 4：修改 `openclaw.plugin.json`

在 `configSchema.properties` 中添加对应的 JSON Schema 和 uiHints。

### 步骤 5：修改 `src/bot.ts` — 聚合路径

在 `_handleWebhookEventInner` 的消息处理循环中引入条件分支：

```typescript
// 在 for (const msg of resp.msg_list ?? []) 循环之前读取聚合配置
const aggConfig = channelConfig.messageAggregation;
const aggEnabled = aggConfig?.enabled === true;

if (aggEnabled) {
  // ── 聚合路径 ──
  // 1. 先过滤：跳过 event、非 origin=3、stale、dedup（与现有逻辑一致）
  const validMsgs = (resp.msg_list ?? []).filter((msg) => {
    if (msg.msgtype === "event") {
      handleEvent(ctx, account, msg);
      return false;
    }
    if (msg.origin !== 3) return false;
    const age = Math.floor(Date.now() / 1000) - msg.send_time;
    if (age > MAX_MESSAGE_AGE_S) return false;
    if (isDuplicate(msg.msgid)) return false;
    return true;
  });

  // 2. 按用户分组
  const groups = groupConsecutiveByUser(validMsgs, extractText);

  // 3. 逐组派发
  for (const group of groups) {
    const mergedText = mergeGroupTexts(group);
    // 使用组内最后一条消息作为 dispatch 的代表消息（保留最新 msgid/send_time）
    const representativeMsg = group.messages[group.messages.length - 1];
    try {
      await dispatchMessage(ctx, account, representativeMsg, mergedText, group);
    } catch (err) {
      log?.error(`${logTag(openKfId)} dispatch error: ${formatError(err)}`);
    }
  }
} else {
  // ── 现有逐条路径（行为不变）──
  for (const msg of resp.msg_list ?? []) {
    /* ... 现有代码 ... */
  }
}
```

### 步骤 6：跨批次防抖

当聚合启用时，处理完当前批次后等待 `debounceMs`，然后重新拉取 sync_msg 检查是否有新消息到达：

```typescript
// 在 while (hasMore) 循环末尾，cursor 保存之后
if (aggEnabled && !hasMore) {
  // 用户可能正在连续输入 — 等待 debounce 窗口后 re-fetch
  const debounceMs = aggConfig?.debounceMs ?? 1500;
  await sleep(debounceMs);

  // Re-fetch 检查是否有新消息
  const recheckResp = await syncMessages(corpId, appSecret, {
    limit: 1000,
    open_kfid: openKfId,
    cursor,
  });

  if ((recheckResp.msg_list?.length ?? 0) > 0) {
    // 有新消息 — 继续循环处理
    hasMore = true;
    // resp 更新为 recheckResp，进入下一轮聚合
  }
}
```

### 步骤 7：修改 `dispatchMessage` 签名

增加可选的 `group` 参数，以便聚合模式下收集所有消息的 media：

```typescript
async function dispatchMessage(
  ctx: BotContext,
  account: ResolvedWechatKfAccount,
  msg: WechatKfMessage,
  text: string,
  group?: MessageGroup,  // 新增：聚合模式下传入整组消息
): Promise<void> {
  // media 下载部分：
  // 非聚合模式：只处理 msg 自身的 media_id（现有逻辑）
  // 聚合模式：遍历 group.messages 的所有 media_id
  const msgsToProcess = group ? group.messages : [msg];
  for (const m of msgsToProcess) {
    const mediaId = m.image?.media_id || m.voice?.media_id || ...;
    if (mediaId) { /* 下载并保存 */ }
  }
}
```

## 边界情况

### 1. 混合消息类型

用户先发文字 "帮我看看这张图" 再发图片。聚合后：

- `mergedText`: `"帮我看看这张图\n[用户发送了一张图片]"`
- `mediaPaths`: 包含图片的保存路径
- agent 同时看到文字和图片，上下文完整

### 2. 不同用户交错

sync_msg 返回 `[A1, B1, A2]`。分组结果：

- Group 1: `{userId: A, msgs: [A1]}`
- Group 2: `{userId: B, msgs: [B1]}`
- Group 3: `{userId: A, msgs: [A2]}`

A 的两条消息不会被错误合并，因为 B 的消息打断了连续性。

### 3. 超过 maxMessages

当一个用户连续消息数超过 `maxMessages` 时，截断分组：

```typescript
// groupConsecutiveByUser 中增加限制
if (current && current.userId === userId && current.messages.length < maxMessages) {
  current.messages.push(msg);
  // ...
} else {
  current = { userId, messages: [msg], ... };
  groups.push(current);
}
```

### 4. 防抖期间服务关闭

跨批次 sleep 期间如果收到 AbortSignal，应立即返回不再 re-fetch：

```typescript
if (aggEnabled && !hasMore) {
  const debounceMs = aggConfig?.debounceMs ?? 1500;
  const aborted = await sleepOrAbort(debounceMs, ctx.signal);
  if (aborted) return;
  // ...
}
```

### 5. 聚合关闭时零影响

`aggEnabled === false` 时走现有的 `for (const msg of resp.msg_list)` 路径，行为完全不变。无需修改现有测试。

### 6. 单条消息无额外开销

如果 debounce 窗口内只收到一条消息，`groupConsecutiveByUser` 返回包含一条消息的单个组，`mergeGroupTexts` 直接返回原文，效果等同于非聚合模式。

### 7. at-least-once 保证不变

聚合模式下 cursor 仍然在整批消息处理完毕后保存（与现有逻辑一致）。msgid dedup 确保 re-fetch 时不会重复派发。

## 测试策略

### 新建 `src/message-aggregator.test.ts`

纯函数测试，不需要 mock：

| 测试用例              | 说明                         |
| --------------------- | ---------------------------- |
| 空消息列表            | 返回空数组                   |
| 单条消息              | 返回包含一个组的数组         |
| 同用户连续 3 条       | 合并为一个组                 |
| 不同用户交错          | 正确分割为多个组             |
| maxMessages 截断      | 超过限制时开始新组           |
| 混合 text + image     | texts 和 mediaIds 都正确填充 |
| extractText 返回 null | 跳过该消息                   |
| mergeGroupTexts 单条  | 返回原文                     |
| mergeGroupTexts 多条  | 用 `\n` 连接                 |

### 扩展 `src/bot.test.ts`

| 测试用例               | 说明                                              |
| ---------------------- | ------------------------------------------------- |
| 聚合关闭               | 与现有行为完全一致（回归验证）                    |
| 聚合开启 + 同用户 2 条 | dispatchMessage 只调用 1 次，文本已合并           |
| 聚合开启 + 不同用户    | 每个用户各调用 1 次 dispatchMessage               |
| 跨批次防抖             | mock sleep + re-fetch，验证新消息被聚合           |
| re-fetch 无新消息      | 正常结束，不多余派发                              |
| media 聚合             | 多条含 media 的消息合并后 mediaPaths 包含所有文件 |

## 配置示例

```yaml
# openclaw.yaml
channels:
  wechat-kf:
    corpId: "ww..."
    appSecret: "..."
    token: "..."
    encodingAESKey: "..."
    messageAggregation:
      enabled: true
      debounceMs: 2000 # 2 秒等待窗口
      maxMessages: 10 # 最多聚合 10 条
```
