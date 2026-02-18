# P2-05: 正确处理 sync_msg 的 token/cursor 互斥关系

## 来源

Business Logic 审查 H2

## 问题描述

企业微信 sync_msg API 中 `cursor` 和 `token` 是互斥参数：
- 有 cursor → 用 cursor 做增量拉取
- 无 cursor 但有 webhook token → 用 token 拉增量
- 二者都没有 → 拉全量（最近 3 天历史）

当前代码同时传递 cursor 和 token，行为未定义：

```typescript
const syncReq: any = {
  cursor: cursor || undefined,
  token: syncToken || undefined,  // 有 cursor 时不应传 token
  limit: 1000,
  open_kfid: openKfId,
};
```

## 目标

按企业微信文档正确处理 token/cursor 互斥，避免未定义行为。

## 具体改动

```typescript
const syncReq: WechatKfSyncMsgRequest = {
  limit: 1000,
  open_kfid: openKfId,
};

if (cursor) {
  syncReq.cursor = cursor;
} else if (syncToken) {
  syncReq.token = syncToken;
} else {
  log?.info(`[wechat-kf:${openKfId}] no cursor or token, fetching initial batch`);
}
```

## 验收标准

- [ ] 有 cursor 时，请求体只包含 cursor 不包含 token
- [ ] 无 cursor 有 syncToken 时，请求体只包含 token 不包含 cursor
- [ ] 二者都没有时，请求体既不含 cursor 也不含 token，并输出日志
- [ ] `syncReq` 使用 `WechatKfSyncMsgRequest` 类型而非 `any`
- [ ] 新增测试验证三种场景的请求体构造

## 涉及文件

- `src/bot.ts` — 修改 syncReq 构造逻辑
- `src/bot.test.ts` — 新增测试
