# P1-04: Token 过期自动清除并重试

## 来源

API Layer 审查 H4

## 问题描述

当企业微信 API 返回 token 相关错误码（40014 不合法的 access_token、42001 access_token 已过期、40001 不合法的 secret）时，当前代码直接抛出异常，不会清除缓存 token 或重试。`clearAccessToken` 函数已在 `token.ts` 中导出但从未被任何代码调用。

## 目标

Token 失效时自动清除缓存并重试一次，减少因 token 过期导致的间歇性 API 错误。

## 具体改动

### 方案 A：在 apiPost 层实现（推荐）

在 `api.ts` 中新增一个带重试的 wrapper：

```typescript
const TOKEN_EXPIRED_CODES = new Set([40014, 42001, 40001]);

export async function apiPostWithTokenRetry<T>(
  path: string,
  corpId: string,
  appSecret: string,
  body: unknown,
): Promise<T> {
  let token = await getAccessToken(corpId, appSecret);
  const data = await apiPost<T>(path, token, body);

  const result = data as any;
  if (result.errcode && TOKEN_EXPIRED_CODES.has(result.errcode)) {
    clearAccessToken(corpId, appSecret);
    token = await getAccessToken(corpId, appSecret);
    return apiPost<T>(path, token, body);
  }
  return data;
}
```

将 `syncMessages`、`sendTextMessage` 等所有公共 API 函数改为使用 `apiPostWithTokenRetry`。

### 方案 B：在各调用点检测

在 `bot.ts`、`reply-dispatcher.ts` 等调用方检测 errcode 并调用 `clearAccessToken` 后重试。侵入性更大，不推荐。

## 验收标准

- [ ] 当 API 返回 errcode 40014/42001/40001 时，自动清除缓存 token 并重试一次
- [ ] 重试仍失败时，正常抛出异常（不无限重试）
- [ ] `clearAccessToken` 被正确调用（可通过日志或 mock 验证）
- [ ] 新增测试：mock API 首次返回 42001，第二次返回成功，验证自动恢复
- [ ] 新增测试：mock API 连续返回 42001，验证只重试一次然后抛出

## 涉及文件

- `src/api.ts` — 新增 `apiPostWithTokenRetry`，修改各 API 函数
- `src/token.ts` — `clearAccessToken` 保持不变（已实现）
- `src/api.test.ts` — 新增测试
