/**
 * WeChat KF (微信客服) OpenClaw Channel Plugin
 */

import { wechatKfPlugin } from "./src/channel.js";
import { setRuntime } from "./src/runtime.js";

export { wechatKfPlugin } from "./src/channel.js";
export { sendTextMessage, syncMessages } from "./src/api.js";
export { encrypt, decrypt, computeSignature, verifySignature } from "./src/crypto.js";
export { getAccessToken } from "./src/token.js";

const plugin = {
  id: "wechat-kf",
  name: "WeChat KF",
  description: "WeChat Customer Service (企业微信客服) channel plugin",
  configSchema: { type: "object", properties: {} },
  register(api: any) {
    setRuntime(api.runtime);
    api.registerChannel({ plugin: wechatKfPlugin });
  },
};

export default plugin;
