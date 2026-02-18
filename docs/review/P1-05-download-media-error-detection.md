# P1-05: downloadMedia 检测 JSON 错误响应

## 来源

API Layer 审查 H5

## 问题描述

`downloadMedia` 在企业微信返回业务错误时，HTTP 状态码仍为 200，但 Content-Type 为 `application/json`，body 是 JSON 错误信息（如 `{"errcode": 40007, "errmsg": "invalid media_id"}`）。当前代码直接将 JSON 错误体作为 Buffer 返回给调用方，下游会以为下载成功但数据是错误的。

```typescript
// 当前代码
const resp = await fetch(`${BASE}/media/get?access_token=${token}&media_id=${mediaId}`);
if (!resp.ok) throw new Error(...);
return Buffer.from(await resp.arrayBuffer()); // JSON 错误也被当作二进制返回
```

## 目标

正确检测并抛出 downloadMedia 的业务错误，避免将 JSON 错误体误当作有效媒体数据。

## 具体改动

```typescript
export async function downloadMedia(
  corpId: string,
  appSecret: string,
  mediaId: string,
): Promise<Buffer> {
  const token = await getAccessToken(corpId, appSecret);
  const resp = await fetch(`${BASE}/media/get?access_token=${token}&media_id=${mediaId}`);
  if (!resp.ok) {
    throw new Error(`[wechat-kf] download media failed: ${resp.status} ${resp.statusText}`);
  }
  const contentType = resp.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const data = (await resp.json()) as { errcode: number; errmsg: string };
    throw new Error(`[wechat-kf] download media failed: ${data.errcode} ${data.errmsg}`);
  }
  return Buffer.from(await resp.arrayBuffer());
}
```

## 验收标准

- [ ] 当响应 Content-Type 为 `application/json` 时，解析 JSON 并抛出包含 errcode/errmsg 的错误
- [ ] 正常二进制响应（Content-Type 为 image/xxx 等）仍正确返回 Buffer
- [ ] 新增测试：mock 200 + `application/json` 响应，验证抛出异常
- [ ] 新增测试：mock 200 + `image/jpeg` 响应，验证返回正确 Buffer

## 涉及文件

- `src/api.ts` — 修改 `downloadMedia` 函数
- `src/api.test.ts` — 新增测试
