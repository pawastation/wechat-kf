# P0-04: 实现 security 适配器（resolveDmPolicy）

## 来源

OpenClaw 框架源码分析（`src/channels/plugins/types.adapters.ts`, `extensions/discord/src/channel.ts`）

## 源码调查结论

通过阅读 OpenClaw 源码确认：

1. **需要实现 `security.resolveDmPolicy`** — 这是标准做法，~17 个 channel 插件都实现了
2. `config.resolveAllowFrom` 只是静态配置查询，**不负责策略执行**
3. 实际的 DM 策略执行在**入站消息处理器**中（对应我们的 `bot.ts`）
4. 支持的策略：`"open"` | `"pairing"` | `"allowlist"` | `"disabled"`
5. pairing 流程：未授权用户触发配对请求 → 审批后存入 `~/.openclaw/state/<channel>-allowFrom.json`

### 框架类型定义

```typescript
// types.adapters.ts:311-316
export type ChannelSecurityAdapter<ResolvedAccount = unknown> = {
  resolveDmPolicy?: (
    ctx: ChannelSecurityContext<ResolvedAccount>,
  ) => ChannelSecurityDmPolicy | null;
  collectWarnings?: (ctx: ChannelSecurityContext<ResolvedAccount>) => Promise<string[]> | string[];
};

// types.core.ts:184-191
export type ChannelSecurityDmPolicy = {
  policy: string;                              // "open" | "pairing" | "allowlist" | "disabled"
  allowFrom?: Array<string | number> | null;   // 静态允许列表
  policyPath?: string;                         // 配置路径（用于 UI 提示）
  allowFromPath: string;                       // allowFrom 配置路径
  approveHint: string;                         // 审批提示文案
  normalizeEntry?: (raw: string) => string;    // 输入规范化
};
```

### 参考实现：Discord

```typescript
// extensions/discord/src/channel.ts:114-128
security: {
  resolveDmPolicy: ({ cfg, accountId, account }) => {
    const resolvedAccountId = accountId ?? account.accountId ?? DEFAULT_ACCOUNT_ID;
    const useAccountPath = Boolean(cfg.channels?.discord?.accounts?.[resolvedAccountId]);
    const allowFromPath = useAccountPath
      ? `channels.discord.accounts.${resolvedAccountId}.dm.`
      : "channels.discord.dm.";
    return {
      policy: account.config.dm?.policy ?? "pairing",
      allowFrom: account.config.dm?.allowFrom ?? [],
      allowFromPath,
      approveHint: formatPairingApproveHint("discord"),
      normalizeEntry: (raw) => raw.replace(/^(discord|user):/i, "").replace(/^<@!?(\d+)>$/, "$1"),
    };
  },
  collectWarnings: ({ account }) => { /* ... */ },
},
```

## 问题描述

当前项目通过两种方式处理 DM 策略，但缺少标准的 `security` 适配器：

1. `openclaw.plugin.json` 中 configSchema 声明 `dmPolicy` 字段
2. `channel.ts` 中 `config.resolveAllowFrom` 返回允许的 userId 列表
3. **缺少** `security.resolveDmPolicy` — 框架无法正确识别和展示 DM 策略

## 目标

1. 实现 `security.resolveDmPolicy`，让框架正确识别 DM 策略
2. 保留 `config.resolveAllowFrom`（两者职责不同）
3. 确认 bot.ts 入站处理中是否需要加 DM policy 检查

## 具体改动

### 1. 在 channel.ts 中添加 security 适配器

```typescript
// channel.ts
security: {
  resolveDmPolicy: ({ cfg, accountId }) => {
    const config = getChannelConfig(cfg);
    const policy = config.dmPolicy ?? "open";
    return {
      policy,
      allowFrom: config.allowFrom ?? [],
      allowFromPath: "channels.wechat-kf.allowFrom",
      approveHint: [
        `To approve a WeChat KF user, add their external_userid to the allowlist:`,
        `  openclaw config set channels.wechat-kf.allowFrom '["{userid}"]'`,
      ].join("\n"),
      normalizeEntry: (raw: string) => raw.replace(/^user:/i, "").trim(),
    };
  },
  collectWarnings: ({ cfg }) => {
    const config = getChannelConfig(cfg);
    const policy = config.dmPolicy ?? "open";
    if (policy === "open") {
      return [`- WeChat KF: dmPolicy="open" — any WeChat user can chat with the agent.`];
    }
    return [];
  },
},
```

### 2. 保留 config.resolveAllowFrom

`resolveAllowFrom` 仍然需要，它的职责是为框架提供出站目标解析的允许列表。与 `security.resolveDmPolicy` 不冲突：

- `security.resolveDmPolicy` → 声明策略（用于审计/UI/pairing 流程）
- `config.resolveAllowFrom` → 返回允许列表（用于出站目标解析）

### 3. bot.ts 入站 DM 策略检查

参考 Discord 的 `message-handler.preflight.ts`，bot.ts 的入站处理应在分发消息前检查 DM 策略：

```typescript
// bot.ts — 伪代码，具体实现取决于 runtime API
async function handleInboundMessage(msg, cfg, runtime) {
  const config = getChannelConfig(cfg);
  const dmPolicy = config.dmPolicy ?? "open";

  if (dmPolicy === "disabled") {
    runtime.log?.verbose?.("[wechat-kf] drop DM (dmPolicy: disabled)");
    return;
  }

  if (dmPolicy !== "open") {
    const allowFrom = config.allowFrom ?? [];
    // 可能还需要读取 pairing store
    const pairingStore = await readChannelAllowFromStore("wechat-kf").catch(() => []);
    const effectiveAllowFrom = [...allowFrom, ...pairingStore];

    if (!effectiveAllowFrom.includes(msg.external_userid)) {
      if (dmPolicy === "pairing") {
        // 触发 pairing 请求
        await upsertChannelPairingRequest({ ... });
      }
      runtime.log?.verbose?.(`[wechat-kf] blocked unauthorized sender ${msg.external_userid}`);
      return;
    }
  }

  // 正常处理消息...
}
```

> 注意：pairing 流程的具体实现依赖 runtime API，需要确认框架提供了哪些 pairing 工具函数。此项可延后到 P2 实施。

## 验收标准

- [ ] `channel.ts` 包含 `security.resolveDmPolicy` 实现
- [ ] `security.resolveDmPolicy` 返回正确的 policy/allowFrom/approveHint
- [ ] `config.resolveAllowFrom` 保留不变
- [ ] `collectWarnings` 在 dmPolicy="open" 时发出安全提醒
- [ ] bot.ts 入站处理检查 DM 策略（基本版：open/allowlist；pairing 可延后）

## 可能取代的原有 TODO

- **P3-06** (account enable/delete) 的 access control 部分 — 部分覆盖

## 涉及文件

- `src/channel.ts` — 新增 `security` 适配器
- `src/bot.ts` — 入站 DM 策略检查（基本版）
