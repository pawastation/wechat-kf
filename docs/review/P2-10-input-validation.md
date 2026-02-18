# P2-10: API 层输入参数验证

## 来源

API Layer 审查 M6（uploadMedia type）+ M7（deriveAesKey 长度）

## 问题描述

### 1. uploadMedia type 参数无约束
`type: string` 接受任意字符串，但企业微信 API 只支持 `"image" | "voice" | "video" | "file"`。

### 2. deriveAesKey 未验证输入长度
`EncodingAESKey` 固定 43 字符（Base64 解码为 32 字节 AES key）。传入错误长度会导致 `createCipheriv` 抛出不友好的底层错误。

## 目标

在 API 边界进行输入验证，提供清晰的错误信息。

## 具体改动

### uploadMedia 类型约束

```typescript
type WechatMediaType = "image" | "voice" | "video" | "file";

export async function uploadMedia(
  corpId: string,
  appSecret: string,
  type: WechatMediaType,  // 编译时约束
  buffer: Buffer,
  filename: string,
): Promise<WechatMediaUploadResponse> { ... }
```

### deriveAesKey 长度校验

```typescript
export function deriveAesKey(encodingAESKey: string): Buffer {
  if (encodingAESKey.length !== 43) {
    throw new Error(
      `[wechat-kf] EncodingAESKey must be 43 characters, got ${encodingAESKey.length}`
    );
  }
  const key = Buffer.from(encodingAESKey + "=", "base64");
  if (key.length !== 32) {
    throw new Error(`[wechat-kf] derived AES key must be 32 bytes, got ${key.length}`);
  }
  return key;
}
```

## 验收标准

- [ ] `uploadMedia` 的 `type` 参数为联合类型 `"image" | "voice" | "video" | "file"`
- [ ] `deriveAesKey` 传入非 43 字符字符串时抛出清晰错误
- [ ] `deriveAesKey` 解码结果非 32 字节时抛出清晰错误
- [ ] `pnpm run typecheck` 通过
- [ ] 新增测试：`deriveAesKey` 各种非法长度输入

## 涉及文件

- `src/api.ts` — 修改 `uploadMedia` 参数类型
- `src/crypto.ts` — 修改 `deriveAesKey` 增加校验
- `src/crypto.test.ts` — 新增边界测试
