# WeCom Customer Service (企业微信客服) API Reference

## Authentication

### Get Access Token

```
GET https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid={CORPID}&corpsecret={SECRET}
```

Response:
```json
{ "errcode": 0, "errmsg": "ok", "access_token": "xxx", "expires_in": 7200 }
```

- Token valid for 7200s (2 hours)
- Rate limited; cache and refresh before expiry

## Callback (Webhook)

### GET — URL Verification

```
GET /callback?msg_signature={sig}&timestamp={ts}&nonce={nonce}&echostr={encrypted_echostr}
```

1. Verify signature: `SHA1(sort([token, timestamp, nonce, echostr])) == msg_signature`
2. Decrypt echostr → plaintext
3. Return plaintext as response body (HTTP 200, text/plain)

### POST — Event Notification

```
POST /callback?msg_signature={sig}&timestamp={ts}&nonce={nonce}
Content-Type: text/xml

<xml>
  <ToUserName><![CDATA[corpid]]></ToUserName>
  <Encrypt><![CDATA[encrypted_content]]></Encrypt>
  <AgentID><![CDATA[]]></AgentID>
</xml>
```

1. Extract `<Encrypt>` from XML
2. Verify: `SHA1(sort([token, timestamp, nonce, encrypt])) == msg_signature`
3. Decrypt → get XML with `<Token>` and `<OpenKfId>` fields
4. Use Token + OpenKfId to call `sync_msg`
5. Return "success" immediately

### Signature Algorithm

```
SHA1(sort([token, timestamp, nonce, encrypt]).join(""))
```

All four strings sorted lexicographically, concatenated, then SHA1 hashed.

### Encryption Algorithm

- Algorithm: AES-256-CBC
- Key: `Base64Decode(EncodingAESKey + "=")` → 32 bytes
- IV: first 16 bytes of key
- Padding: PKCS#7, block size = 32 bytes

Plaintext format:
```
random(16 bytes) + msg_len(4 bytes, big-endian) + msg(UTF-8) + receiveid(corpId)
```

## Sync Messages

```
POST https://qyapi.weixin.qq.com/cgi-bin/kf/sync_msg?access_token={TOKEN}
```

Request:
```json
{
  "cursor": "string",       // Pagination cursor (from previous response)
  "token": "string",        // From callback notification
  "limit": 1000,            // Max messages per request (default 1000)
  "voice_format": 0,        // 0=AMR, 1=Silk
  "open_kfid": "string"     // KF account ID
}
```

Response:
```json
{
  "errcode": 0,
  "errmsg": "ok",
  "next_cursor": "string",
  "has_more": 0,
  "msg_list": [
    {
      "msgid": "string",
      "open_kfid": "string",
      "external_userid": "string",
      "send_time": 1234567890,
      "origin": 3,
      "msgtype": "text",
      "text": { "content": "hello" }
    }
  ]
}
```

### Origin Values

| Value | Meaning |
|-------|---------|
| 3 | WeChat customer (微信客户) |
| 4 | System message (系统消息) |
| 5 | Servicer/agent (接待人员) |

### Message Types (Inbound)

| Type | Fields |
|------|--------|
| `text` | `text.content` |
| `image` | `image.media_id` |
| `voice` | `voice.media_id` |
| `video` | `video.media_id` |
| `file` | `file.media_id` |
| `location` | `location.{latitude, longitude, name, address}` |
| `link` | `link.{title, desc, url, pic_url}` |
| `business_card` | `business_card.userid` |
| `miniprogram` | `miniprogram.{title, appid, pagepath, thumb_media_id}` |
| `msgmenu` | `msgmenu.head_content, list[], tail_content` |
| `event` | `event.{event_type, ...}` |

## Send Message

```
POST https://qyapi.weixin.qq.com/cgi-bin/kf/send_msg?access_token={TOKEN}
```

Request:
```json
{
  "touser": "external_userid",
  "open_kfid": "wkXXXX",
  "msgid": "optional_dedup_id",
  "msgtype": "text",
  "text": { "content": "Hello!" }
}
```

Response:
```json
{ "errcode": 0, "errmsg": "ok", "msgid": "string" }
```

### Constraints

- Must send within **48 hours** of last user message
- Maximum **5 messages** per window (resets when user sends again)

### Supported Send Types

- `text` — `text.content`
- `image` — `image.media_id`
- `voice` — `voice.media_id`
- `video` — `video.media_id`
- `file` — `file.media_id`
- `link` — `link.{title, desc, url, pic_url}`
- `miniprogram` — `miniprogram.{...}`
- `msgmenu` — interactive menu buttons
- `location` — `location.{...}`

## Event Types

### enter_session
User enters a KF session. Contains `welcome_code` for sending welcome message.

### msg_send_fail
Message delivery failed. Contains `fail_msgid` and `fail_type`.

### servicer_status_change
Agent status changed (online/offline).

### session_status_change
Session state changed (assigned, closed, etc.).
