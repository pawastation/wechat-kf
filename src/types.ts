// ── WeChat KF Plugin Types ──

export type WechatKfConfig = {
  enabled?: boolean;
  corpId?: string;
  appSecret?: string;
  token?: string;
  encodingAESKey?: string;
  webhookPath?: string;
  dmPolicy?: "open" | "pairing" | "allowlist" | "disabled";
  allowFrom?: string[];
};

// ── OpenClaw config container ──
// The host framework provides a config object with a `channels` map.
// We only describe the shape the plugin actually reads.
// The channel values are typed as `unknown` because the framework passes
// plain objects whose literal types don't always narrow to our union types.
// `getChannelConfig()` casts the channel value to `WechatKfConfig`.

export type OpenClawConfig = {
  channels?: Record<string, unknown>;
  [key: string]: unknown;
};

export type ResolvedWechatKfAccount = {
  accountId: string; // openKfId (dynamically discovered)
  enabled: boolean;
  configured: boolean;
  corpId?: string;
  appSecret?: string;
  token?: string;
  encodingAESKey?: string;
  openKfId?: string; // same as accountId
  webhookPath: string;
  config: WechatKfConfig;
};

// ── API types ──

export type WechatAccessTokenResponse = {
  errcode: number;
  errmsg: string;
  access_token: string;
  expires_in: number;
};

export type WechatKfSyncMsgRequest = {
  cursor?: string;
  token?: string;
  limit?: number;
  voice_format?: number;
  open_kfid?: string;
};

export type WechatKfMergedMsgItem = {
  sender_name?: string;
  msg_content?: string;
};

export type WechatKfMessage = {
  msgid: string;
  open_kfid: string;
  external_userid: string;
  send_time: number;
  origin: number; // 3=WeChat customer, 4=system, 5=servicer
  servicer_userid?: string;
  msgtype: string;
  text?: { content: string };
  image?: { media_id: string };
  voice?: { media_id: string };
  video?: { media_id: string };
  file?: { media_id: string };
  location?: { latitude: number; longitude: number; name: string; address: string };
  link?: { title: string; desc: string; url: string; pic_url: string };
  event?: {
    event_type: string;
    open_kfid?: string;
    external_userid?: string;
    scene?: string;
    scene_param?: string;
    welcome_code?: string;
    fail_msgid?: string;
    fail_type?: number;
    servicer_userid?: string;
    status?: number;
  };
  merged_msg?: { title?: string; item?: WechatKfMergedMsgItem[] };
  channels?: { nickname?: string; title?: string; sub_type?: number };
  miniprogram?: { title?: string; appid?: string; pagepath?: string };
  business_card?: { userid?: string };
  msgmenu?: { head_content?: string; list?: { id: string; content?: string }[]; tail_content?: string };
};

export type WechatKfSyncMsgResponse = {
  errcode: number;
  errmsg: string;
  next_cursor: string;
  has_more: number;
  msg_list: WechatKfMessage[];
};

export type WechatKfSendMsgRequest = {
  touser: string;
  open_kfid: string;
  msgid?: string;
  msgtype: string;
  text?: { content: string };
  image?: { media_id: string };
  file?: { media_id: string };
  voice?: { media_id: string };
  video?: { media_id: string };
  link?: { title: string; desc?: string; url: string; thumb_media_id: string };
};

export type WechatKfSendMsgResponse = {
  errcode: number;
  errmsg: string;
  msgid: string;
};

export type WechatMediaUploadResponse = {
  errcode: number;
  errmsg: string;
  type: string;
  media_id: string;
  created_at: number;
};

export type WechatCallbackXml = {
  ToUserName: string;
  CreateTime: string;
  MsgType: string;
  Event?: string;
  Token?: string;
  OpenKfId?: string;
  Encrypt?: string;
};
