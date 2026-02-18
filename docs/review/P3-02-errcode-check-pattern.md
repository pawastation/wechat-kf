# P3-02: 统一 errcode 检查模式

## 来源

API Layer 审查 M1

## 问题描述

API 层多处使用 `data.errcode !== 0` 检查错误。但企业微信 API 在成功时可能不返回 `errcode` 字段（返回 `undefined`），`undefined !== 0` 为 `true`，导致成功响应也被当作错误。

当前模式：
```typescript
if (data.errcode !== 0) throw new Error(...); // undefined !== 0 → 误报
```

## 目标

统一使用宽松的 errcode 检查模式，避免误报。

## 具体改动

```typescript
// 方案 1：truthy 检查（errcode 为 0 或 undefined 时跳过）
if (data.errcode) throw new Error(...);

// 方案 2：显式排除（更清晰）
if (data.errcode != null && data.errcode !== 0) throw new Error(...);
```

涉及函数：`syncMessages`、`sendTextMessage`、`uploadMedia` 等所有检查 errcode 的地方。

如果采用 P1-04 的 `apiPostWithTokenRetry` 重构，可在统一入口处处理 errcode 检查，不需要每个函数单独检查。

## 验收标准

- [ ] 所有 errcode 检查使用统一模式
- [ ] 成功响应（errcode 为 0 或 undefined）不会被误判为错误
- [ ] 错误响应（errcode 非 0）正确抛出异常
- [ ] 新增测试：mock 无 errcode 字段的成功响应，验证不抛异常

## 涉及文件

- `src/api.ts` — 修改所有 errcode 检查
