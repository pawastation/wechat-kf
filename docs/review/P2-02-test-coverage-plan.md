# P2-02: 测试覆盖补全计划

## 来源

跨层共性问题：各层审查均指出测试覆盖不足

## 问题描述

当前仅有 2 个测试文件：`crypto.test.ts`（加解密）和 `unicode-format.test.ts`（格式化）。以下核心模块完全没有测试：

| 模块 | 重要度 | 当前测试 |
|------|--------|----------|
| `api.ts` | 核心 | 无 |
| `token.ts` | 核心 | 无 |
| `bot.ts` | 核心 | 无 |
| `accounts.ts` | 中等 | 无 |
| `monitor.ts` | 中等 | 无 |
| `reply-dispatcher.ts` | 中等 | 无 |
| `outbound.ts` | 中等 | 无 |
| `channel.ts` | 中等 | 无 |
| `config-schema.ts` | 低 | 无 |
| `webhook.ts` | 低 | 无 |

## 目标

为各核心模块补充单元测试，关键路径覆盖率达到 80% 以上。

## 具体改动

### token.test.ts（优先）

- 成功获取 token 并缓存
- 缓存命中直接返回（不发请求）
- 缓存过期后重新获取（5 分钟提前刷新边界）
- 并发请求去重（多个 getAccessToken 同时调用只发一次请求）
- `clearAccessToken` 清除后下次重新获取
- 网络错误处理
- HTTP 非 200 响应
- errcode 非 0 的业务错误

### api.test.ts（优先）

- `syncMessages` 正常响应解析
- `sendTextMessage` 成功发送
- `downloadMedia` 正常二进制数据
- `downloadMedia` JSON 错误检测（配合 P1-05）
- `uploadMedia` FormData 构建和成功上传
- HTTP 错误（非 200）
- 业务错误（errcode 非 0）
- Token 过期自动重试（配合 P1-04）

### bot.test.ts（优先）

- `extractText` 所有 11+ 消息类型分支
- cursor 加载/保存的读写逻辑（mock fs）
- `handleWebhookEvent` 的 has_more 循环
- origin 过滤（只处理 origin=3）
- 消息去重（配合 P1-01）

### accounts.test.ts

- `registerKfId` 去重和持久化
- `loadKfIds` 从文件恢复
- `recoverOriginalKfId` 大小写匹配
- `resolveAccount` 配置合并
- `listAccountIds` 有/无 kfId 时的返回

### outbound.test.ts

- `sendText` 分块发送（配合 P1-06）
- `sendMedia` 各媒体类型
- `detectMediaType` 扩展名识别
- 文本 Markdown 转换
- fallback 文本消息

### reply-dispatcher.test.ts

- 纯文本回复分块
- 附件 + 文本混合
- 错误处理（附件失败继续发文本）

### channel.test.ts

- `config.listAccountIds` / `resolveAccount` / `isConfigured`
- `status.buildChannelSummary` / `buildAccountSnapshot`
- `setup.applyAccountConfig` 配置合并
- `gateway.startAccount` 正常启动和错误处理

## 验收标准

- [ ] 每个核心模块有对应的 `.test.ts` 文件
- [ ] `pnpm test` 全部通过
- [ ] `extractText` 覆盖所有消息类型分支
- [ ] token 缓存的并发去重有测试验证
- [ ] API 层的错误处理路径有测试覆盖
- [ ] 使用 vitest 的 mock 功能隔离外部依赖（fetch、fs）

## 涉及文件

- `src/token.test.ts` — 新建
- `src/api.test.ts` — 新建
- `src/bot.test.ts` — 新建
- `src/accounts.test.ts` — 新建
- `src/outbound.test.ts` — 新建
- `src/reply-dispatcher.test.ts` — 新建
- `src/channel.test.ts` — 新建
