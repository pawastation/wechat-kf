# P1-03: PKCS#7 Padding 完整验证

## 来源

API Layer 审查 H3

## 问题描述

`crypto.ts` 解密后的 PKCS#7 padding 验证只检查了最后一个字节是否在有效范围 `[1, 32]`，但未验证所有 padding 字节是否一致。标准 PKCS#7 要求最后 N 个字节全部等于 N。不完整验证可能被利用于 padding oracle 攻击。

当前代码：

```typescript
const pad = decrypted[decrypted.length - 1];
if (pad < 1 || pad > 32 || pad > decrypted.length) {
  throw new Error("[wechat-kf] invalid PKCS#7 padding");
}
const content = decrypted.subarray(0, decrypted.length - pad);
```

## 目标

完整验证所有 padding 字节，消除 padding oracle 攻击风险。

## 具体改动

```typescript
const pad = decrypted[decrypted.length - 1];
if (pad < 1 || pad > 32 || pad > decrypted.length) {
  throw new Error("[wechat-kf] invalid PKCS#7 padding");
}
for (let i = 1; i <= pad; i++) {
  if (decrypted[decrypted.length - i] !== pad) {
    throw new Error("[wechat-kf] invalid PKCS#7 padding");
  }
}
const content = decrypted.subarray(0, decrypted.length - pad);
```

## 验收标准

- [ ] 所有 N 个 padding 字节都被验证等于 N
- [ ] 现有 `crypto.test.ts` 全部通过（正常加解密 roundtrip 不受影响）
- [ ] 新增测试：构造 padding 最后一字节正确但中间字节不一致的密文，验证抛出异常
- [ ] 新增测试：padding 值为 0 / 33 / 超出数据长度的边界情况

## 涉及文件

- `src/crypto.ts` — 修改 `decrypt` 函数中 padding 验证逻辑
- `src/crypto.test.ts` — 新增 padding 验证测试
