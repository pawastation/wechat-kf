# P0-05: 对齐 openclaw.plugin.json Manifest 规范

## 来源

OpenClaw 官方文档 https://docs.openclaw.ai/plugins/manifest

## 规范要点

| 规范要求 | 当前状态 | 是否合规 |
|---------|---------|---------|
| 必须有 `id` | `"wechat-kf"` | OK |
| 必须有 `configSchema` | 有 | OK |
| `additionalProperties: false` 推荐 | **缺失** | 需修复 |
| `uiHints` 用于 UI 标签/占位符/敏感标记 | **缺失** | 建议补充 |
| configSchema 即使无配置也必须提供 | 已提供 | OK |
| 空 schema 可接受 | N/A（有配置） | OK |
| 未声明的 channels 键会触发错误 | `channels: ["wechat-kf"]` 已声明 | OK |

## 问题清单

### 1. configSchema 缺少 `additionalProperties: false`

官方示例明确包含 `"additionalProperties": false`。当前 manifest 没有此字段，意味着用户可以在配置中写入任意未定义字段而不报错。

### 2. 缺少 `uiHints` — 敏感字段未标记

文档说明 `uiHints` 用于：config field labels / placeholders / **sensitive flags** for UI rendering。

当前 manifest 没有 `uiHints`，导致：
- `appSecret` 和 `encodingAESKey` 等敏感字段在 UI 中可能以明文显示
- 用户在 UI 中看不到友好的字段标签和输入占位符

### 3. index.ts 的插件级 configSchema 与 manifest 不一致

`index.ts:17` 的 `configSchema: { type: "object", properties: {} }` 是空 schema，而 manifest 中有完整 schema。文档明确说"Config validation does not execute plugin code; it uses the plugin manifest"。

这意味着：
- manifest 中的 configSchema 是**唯一权威源**，用于静态验证
- `index.ts` 的空 schema 不影响配置验证，但存在误导性
- `channel.ts:53` 的 `configSchema: { schema: wechatKfConfigSchema }` 用于运行时（框架可能通过它生成 UI）

### 4. 与 P1-07 的关系

P1-07 指出 `src/config-schema.ts` 缺少 `required` 字段。修复 P1-07 时应同时确保：
- manifest (`openclaw.plugin.json`) 是权威源
- `src/config-schema.ts` 与 manifest 保持同步（或直接从 manifest 生成/引用）

## 具体改动

### 1. manifest 补充 additionalProperties

```json
{
  "id": "wechat-kf",
  "name": "WeChat Customer Service",
  "description": "OpenClaw channel plugin for WeChat Customer Service (企业微信客服) via WeCom KF API",
  "version": "0.1.0",
  "channels": ["wechat-kf"],
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["corpId", "appSecret", "token", "encodingAESKey"],
    "properties": {
      ...
    }
  }
}
```

### 2. 补充 uiHints

```json
{
  "uiHints": {
    "corpId": {
      "label": "Corp ID (企业ID)",
      "placeholder": "ww1234567890abcdef"
    },
    "appSecret": {
      "label": "App Secret (应用密钥)",
      "sensitive": true,
      "placeholder": "Enter your WeCom app secret"
    },
    "token": {
      "label": "Webhook Token",
      "sensitive": true,
      "placeholder": "Callback verification token"
    },
    "encodingAESKey": {
      "label": "EncodingAESKey",
      "sensitive": true,
      "placeholder": "43-character base64 key"
    },
    "webhookPort": {
      "label": "Webhook Port",
      "placeholder": "9999"
    },
    "webhookPath": {
      "label": "Webhook Path",
      "placeholder": "/wechat-kf"
    },
    "dmPolicy": {
      "label": "DM Policy",
      "placeholder": "open"
    },
    "allowFrom": {
      "label": "Allowlist (External User IDs)"
    }
  }
}
```

### 3. 统一 configSchema 来源

**选项 A（推荐）**：从 manifest 的 JSON 文件读取 schema，运行时复用

```typescript
// src/config-schema.ts
import schema from "../openclaw.plugin.json" with { type: "json" };
export const wechatKfConfigSchema = schema.configSchema;
```

这样只维护一份 schema，manifest 和运行时永远一致。

**选项 B**：手动保持同步，在代码注释中标注 manifest 为权威源。

### 4. index.ts 的空 schema 清理

```typescript
// index.ts — 插件级配置（非 channel 级），当前不需要
const plugin = {
  id: "wechat-kf",
  name: "WeChat KF",
  description: "...",
  // 插件级 configSchema：无额外配置
  // Channel 配置通过 manifest configSchema + channel.configSchema 处理
  configSchema: { type: "object" as const, additionalProperties: false as const, properties: {} },
  register(api: any) { ... },
};
```

## 验收标准

- [ ] `openclaw.plugin.json` 包含 `"additionalProperties": false`
- [ ] `openclaw.plugin.json` 包含 `uiHints`，标记 appSecret/token/encodingAESKey 为 `sensitive: true`
- [ ] `src/config-schema.ts` 与 manifest 中的 configSchema 保持一致（或直接引用）
- [ ] `index.ts` 的空 schema 有注释说明其用途
- [ ] 三处 schema 的职责关系在代码中有文档说明
- [ ] 用户在 UI 中看到友好的字段标签
- [ ] 敏感字段在 UI 中不以明文显示

## 与现有 TODO 的关系

- **P1-07** (config-schema required): 修复 P1-07 时应同步实施本条，确保 manifest 为权威源
- **P0-00 合并计划**: index.ts 空 schema 的困惑已在此解决

## 涉及文件

- `openclaw.plugin.json` — 补充 additionalProperties + uiHints
- `src/config-schema.ts` — 改为引用 manifest 或手动同步
- `index.ts` — 注释说明插件级 schema 的用途
