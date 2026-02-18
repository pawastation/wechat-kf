# P2-01: 全项目类型安全治理

## 来源

跨层共性问题：API H(L1)、Business Logic M6、Presentation L1、Plugin Interface H1/H5/L1

## 问题描述

项目中大量使用 `any` 类型，几乎覆盖所有层：

| 位置 | 示例 |
|------|------|
| `channel.ts:15-16` | `ChannelPlugin<T = any>`, `ChannelMeta = Record<string, any>` |
| `channel.ts` 各回调 | `({ cfg, accountId }: any)` |
| `bot.ts:19-24` | `BotContext.cfg: any`, `runtime?: any` |
| `bot.ts:60,84,90` | `(msg as any).merged_msg`, `(msg as any).channels` |
| `monitor.ts:14-20` | `MonitorContext` 类似 |
| `outbound.ts:26,38` | `sendText/sendMedia` 参数为 `any` |
| `reply-dispatcher.ts:14-20` | `cfg: any`, `runtime: any` |
| `index.ts:18` | `register(api: any)` |

这导致：拼写错误不被编译器捕获、缺少字段不被发现、消费者无类型提示、OpenClaw API 变更只能运行时发现。

## 目标

消除关键路径上的 `any`，为 OpenClaw 插件接口和企业微信消息类型提供完整类型定义。

## 具体改动

### 1. 定义 OpenClaw 插件接口类型

在 `src/plugin-types.ts` 中定义（参考 `docs/plugin-sdk-analysis.md`）：

```typescript
export interface ChannelMeta {
  id: string;
  label: string;
  selectionLabel: string;
  docsPath: string;
  docsLabel: string;
  blurb: string;
  aliases?: string[];
  order?: number;
}

export interface ChannelCapabilities {
  chatTypes: ("direct" | "group")[];
  media: boolean;
  reactions: boolean;
  threads: boolean;
  polls: boolean;
  nativeCommands: boolean;
  blockStreaming: boolean;
}

export interface PluginRuntime {
  // 根据实际使用情况定义
}

export interface OpenClawPluginApi {
  runtime: PluginRuntime;
  registerChannel(opts: { plugin: ChannelPlugin }): void;
}

// ... 完整 ChannelPlugin 接口
```

### 2. 扩展 WechatKfMessage 类型

在 `src/types.ts` 中补充缺失的消息类型字段：

```typescript
export interface WechatKfMessage {
  // ... 现有字段
  merged_msg?: { title: string; item_list: Array<{ ... }> };
  channels?: { nickname: string; scene: number };
  miniprogram?: { title: string; appid: string; pagepath: string };
  business_card?: { userid: string };
  msgmenu?: { head_content: string; list: Array<{ ... }> };
}
```

### 3. 定义 Context 类型

```typescript
export interface Logger {
  info: (...args: any[]) => void;
  warn?: (...args: any[]) => void;
  error: (...args: any[]) => void;
}

export interface BotContext {
  cfg: WechatKfConfig;
  runtime?: PluginRuntime;
  stateDir: string;
  log?: Logger;
}
```

### 4. 逐步替换各处 any

从内到外：`types.ts` → `bot.ts`/`accounts.ts` → `channel.ts` → `index.ts`

## 验收标准

- [ ] `src/plugin-types.ts` 包含 OpenClaw 插件接口的完整类型定义
- [ ] `src/types.ts` 的 `WechatKfMessage` 覆盖所有 11+ 消息类型字段
- [ ] `BotContext`、`MonitorContext` 不再使用 `any`
- [ ] `channel.ts` 所有回调参数有具体类型
- [ ] `index.ts` 的 `register` 参数有具体类型
- [ ] `outbound.ts` 和 `reply-dispatcher.ts` 参数有具体类型
- [ ] `bot.ts` 中的 `as any` 强转全部消除
- [ ] `pnpm run typecheck` 通过
- [ ] `pnpm test` 通过

## 涉及文件

- `src/plugin-types.ts` — 新建
- `src/types.ts` — 扩展消息类型
- `src/bot.ts` — 替换 BotContext 和 as any
- `src/monitor.ts` — 替换 MonitorContext
- `src/channel.ts` — 替换 ChannelPlugin/ChannelMeta 和回调参数
- `src/outbound.ts` — 替换参数类型
- `src/reply-dispatcher.ts` — 替换参数类型
- `src/index.ts` — 替换 register 参数类型
