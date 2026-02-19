/**
 * WeChat KF (微信客服) OpenClaw Channel Plugin
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { wechatKfPlugin } from "./src/channel.js";
import { type PluginRuntime, setRuntime } from "./src/runtime.js";
import { handleWechatKfWebhook } from "./src/webhook.js";

export { sendTextMessage, syncMessages } from "./src/api.js";
export { wechatKfPlugin } from "./src/channel.js";
export { computeSignature, decrypt, encrypt, verifySignature } from "./src/crypto.js";
export { getAccessToken } from "./src/token.js";

type OpenClawPluginApi = {
  runtime: PluginRuntime;
  registerChannel: (opts: { plugin: typeof wechatKfPlugin }) => void;
  registerHttpHandler: (handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean> | boolean) => void;
};

const plugin = {
  id: "wechat-kf",
  name: "WeChat KF",
  description: "WeChat Customer Service (企业微信客服) channel plugin",
  configSchema: { type: "object", additionalProperties: false, properties: {} },
  register(api: OpenClawPluginApi) {
    setRuntime(api.runtime);
    api.registerChannel({ plugin: wechatKfPlugin });
    api.registerHttpHandler(handleWechatKfWebhook);
  },
};

export default plugin;
