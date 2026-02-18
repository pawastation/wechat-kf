/**
 * Send message helpers
 */

import { sendTextMessage } from "./api.js";
import type { ResolvedWechatKfAccount } from "./types.js";

export async function sendText(
  account: ResolvedWechatKfAccount,
  toUser: string,
  content: string,
): Promise<{ messageId: string }> {
  const openKfId = account.openKfId ?? account.accountId;
  if (!account.corpId || !account.appSecret || !openKfId) {
    throw new Error("[wechat-kf] missing corpId/appSecret/openKfId for sending");
  }
  const result = await sendTextMessage(account.corpId, account.appSecret, toUser, openKfId, content);
  return { messageId: result.msgid };
}
