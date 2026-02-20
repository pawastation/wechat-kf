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
  send_time?: number;
  msgtype?: string;
};

export type WechatKfMessage = {
  msgid: string;
  open_kfid: string;
  external_userid: string;
  send_time: number;
  origin: number; // 3=WeChat customer, 4=system, 5=servicer
  servicer_userid?: string;
  msgtype: string;
  text?: { content: string; menu_id?: string };
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
  miniprogram?: { title?: string; appid?: string; pagepath?: string; thumb_media_id?: string };
  business_card?: { userid?: string };
  msgmenu?: { head_content?: string; list?: { id: string; content?: string }[]; tail_content?: string };
  channels_shop_product?: {
    product_id?: string;
    head_image?: string;
    title?: string;
    sales_price?: string;
    shop_nickname?: string;
    shop_head_image?: string;
  };
  channels_shop_order?: {
    order_id?: string;
    product_titles?: string;
    price_wording?: string;
    state?: string;
    image_url?: string;
    shop_nickname?: string;
  };
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
  miniprogram?: { appid: string; title?: string; thumb_media_id: string; pagepath: string };
  msgmenu?: {
    head_content?: string;
    list?: Array<
      | { type: "click"; click: { id?: string; content: string } }
      | { type: "view"; view: { url: string; content: string } }
      | { type: "miniprogram"; miniprogram: { appid: string; pagepath: string; content: string } }
      | { type: "text"; text: { content: string; no_newline?: number } }
    >;
    tail_content?: string;
  };
  location?: { name?: string; address?: string; latitude: number; longitude: number };
  business_card?: { userid: string };
  ca_link?: { link_url: string };
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
