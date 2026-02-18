# P1-07: config-schema.ts 补充 required 字段和验证规则

## Status: DONE

Partially covered by P0-05 (required array, additionalProperties, property keys sync).
Remaining items completed in this pass:
- Added `minLength: 43, maxLength: 43` to `encodingAESKey` in runtime schema
- Added `maximum: 65535` and `default: 9999` to `webhookPort` in runtime schema
- Added `default: "/wechat-kf"` to `webhookPath` in runtime schema
- Added `default: "open"` to `dmPolicy` in runtime schema
- Added `description` fields to runtime schema properties to match manifest
- Fixed manifest `dmPolicy` enum to include `"disabled"` (already supported by runtime code in `bot.ts`)
- Added comprehensive field-level constraint sync tests to `config-schema.test.ts`

## 来源

Plugin Interface 审查 H4

## 问题描述

`src/config-schema.ts` 导出的运行时 schema 缺少 `required` 数组和字段约束，用户可提交空配置不报错。而 `openclaw.plugin.json` 中声明了完整的约束但与运行时 schema 不同步：

| 约束 | `openclaw.plugin.json` | `config-schema.ts` |
|------|----------------------|-------------------|
| required 字段 | `["corpId", "appSecret", "token", "encodingAESKey"]` | 缺失 |
| encodingAESKey 长度 | `minLength: 43, maxLength: 43` | 缺失 |
| webhookPort 范围 | `maximum: 65535` | 缺失 |
| default 值 | webhookPort: 9999, webhookPath: "/wechat-kf" | 缺失 |
| description | 各字段有描述 | 缺失 |

## 目标

运行时 schema 与 `openclaw.plugin.json` 保持一致，确保配置验证能在运行时正确拦截无效配置。

## 具体改动

```typescript
export const wechatKfConfigSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["corpId", "appSecret", "token", "encodingAESKey"] as const,
  properties: {
    enabled: {
      type: "boolean" as const,
      description: "Enable/disable the WeChat KF channel",
    },
    corpId: {
      type: "string" as const,
      description: "企业微信 Corp ID",
    },
    appSecret: {
      type: "string" as const,
      description: "应用 Secret",
    },
    token: {
      type: "string" as const,
      description: "回调 Token",
    },
    encodingAESKey: {
      type: "string" as const,
      minLength: 43,
      maxLength: 43,
      description: "回调 EncodingAESKey (43 chars)",
    },
    webhookPort: {
      type: "number" as const,
      default: 9999,
      maximum: 65535,
      description: "Webhook 监听端口",
    },
    webhookPath: {
      type: "string" as const,
      default: "/wechat-kf",
      description: "Webhook 路径",
    },
    // ... 其他字段同步补全
  },
};
```

## 验收标准

- [x] `config-schema.ts` 包含 `required` 数组，覆盖 4 个必填字段
- [x] `encodingAESKey` 有 `minLength: 43, maxLength: 43` 约束
- [x] `webhookPort` 有 `maximum: 65535` 约束
- [x] 运行时 schema 与 `openclaw.plugin.json` 中的约束完全一致
- [x] 新增测试：传入缺少必填字段的配置，验证被 schema 拦截
- [x] 新增测试：传入 encodingAESKey 长度不为 43 的配置，验证被拦截

## 涉及文件

- `src/config-schema.ts` — 补全 schema 定义
- `src/config-schema.test.ts` — 新增测试
- `openclaw.plugin.json` — 添加 `disabled` 到 dmPolicy enum
