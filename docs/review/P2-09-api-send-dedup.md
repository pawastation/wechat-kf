# P2-09: API 层 send 函数去重

## 来源

API Layer 审查 M2

## 问题描述

`api.ts` 中 `sendTextMessage`、`sendImageMessage`、`sendVoiceMessage`、`sendVideoMessage`、`sendFileMessage`、`sendLinkMessage` 六个函数结构几乎完全一致，只有 `msgtype` 和 payload 字段不同，违反 DRY 原则。

## 目标

提取通用 `sendMessage` 函数，消除重复代码。

## 具体改动

```typescript
type WechatMsgType = "text" | "image" | "voice" | "video" | "file" | "link";

async function sendMessage(
  corpId: string,
  appSecret: string,
  toUser: string,
  openKfId: string,
  msgtype: WechatMsgType,
  payload: Record<string, unknown>,
): Promise<WechatKfSendMsgResponse> {
  const token = await getAccessToken(corpId, appSecret);
  const body = { touser: toUser, open_kfid: openKfId, msgtype, ...payload };
  const data = await apiPost<WechatKfSendMsgResponse>("/kf/send_msg", token, body);
  if (data.errcode && data.errcode !== 0) {
    throw new Error(`[wechat-kf] send ${msgtype} failed: ${data.errcode} ${data.errmsg}`);
  }
  return data;
}

// 公共 API 保持不变，内部委托
export const sendTextMessage = (corpId, appSecret, toUser, openKfId, content) =>
  sendMessage(corpId, appSecret, toUser, openKfId, "text", { text: { content } });

export const sendImageMessage = (corpId, appSecret, toUser, openKfId, mediaId) =>
  sendMessage(corpId, appSecret, toUser, openKfId, "image", { image: { media_id: mediaId } });

// ... 类似
```

## 验收标准

- [ ] 六个 send 函数委托到统一的 `sendMessage` 内部函数
- [ ] 公共 API 签名不变（不影响调用方）
- [ ] 新增 `WechatMsgType` 联合类型
- [ ] `pnpm run typecheck` 通过
- [ ] `pnpm test` 通过

## 涉及文件

- `src/api.ts` — 重构 send 函数
- `src/types.ts` — 可选：添加 `WechatMsgType` 类型
