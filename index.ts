/**
 * WeChat KF (微信客服) OpenClaw Channel Plugin
 */

import { wechatKfPlugin } from "./src/channel.js";
import { type PluginRuntime, setRuntime } from "./src/runtime.js";

export { sendTextMessage, syncMessages } from "./src/api.js";
export { wechatKfPlugin } from "./src/channel.js";
export { computeSignature, decrypt, encrypt, verifySignature } from "./src/crypto.js";
export { getAccessToken } from "./src/token.js";

type OpenClawPluginApi = {
  runtime: PluginRuntime;
  registerChannel: (opts: { plugin: typeof wechatKfPlugin }) => void;
};

const plugin = {
  id: "wechat-kf",
  name: "WeChat KF",
  description: "WeChat Customer Service (企业微信客服) channel plugin",
  // Plugin-level config schema (not channel-level).
  // Channel config is handled via openclaw.plugin.json configSchema
  // and the runtime schema in channel.ts → configSchema.
  configSchema: { type: "object", additionalProperties: false, properties: {} },
  register(api: OpenClawPluginApi) {
    setRuntime(api.runtime);
    api.registerChannel({ plugin: wechatKfPlugin });
  },
};

export default plugin;
