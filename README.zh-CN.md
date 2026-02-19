[English](./README.md) | **中文**

# OpenClaw 微信客服插件

[![npm version](https://img.shields.io/npm/v/@pawastation%2Fwechat-kf.svg)](https://www.npmjs.com/package/@pawastation/wechat-kf)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-channel%20plugin-blue.svg)](https://openclaw.dev)

**企业微信客服渠道插件** — 让微信用户通过企业微信客服 API 与你的 OpenClaw AI Agent 对话。零运行时依赖，仅使用 Node.js 内置模块。

---

## 功能特性

- **入站消息处理** — 接收文本、图片、语音、视频、文件、位置、链接、小程序、视频号、名片、合并转发消息等 11+ 种消息类型
- **事件处理** — 处理 enter_session（用户进入会话）、msg_send_fail（消息发送失败）、servicer_status_change（接待人员状态变更）事件
- **丰富的出站消息** — 发送文本、图片、语音、视频、文件和链接消息
- **媒体上传与下载** — 自动下载入站媒体（图片、语音、视频、文件），通过企业微信临时素材 API 上传出站媒体；支持 HTTP URL 下载
- **Markdown 转 Unicode 格式化** — 将 Markdown 粗体/斜体/标题/列表转换为 Unicode 数学字母符号，在微信中实现富文本效果
- **AES-256-CBC 加密** — 完整的微信回调加密/解密，包含 SHA-1 签名验证和 PKCS#7 填充校验
- **Webhook + 轮询兜底** — HTTP webhook 服务器接收实时回调，同时提供 30 秒轮询兜底机制保证可靠性；内置请求体大小限制、方法校验和错误响应
- **动态客服账号发现** — 客服账号 ID（open_kfid）从 webhook 回调中自动发现，支持启用/禁用/删除生命周期管理
- **基于游标的增量同步** — 每个客服账号独立持久化同步游标，使用原子文件写入保证崩溃安全
- **Access Token 自动缓存** — Token 在内存中以哈希键缓存，过期前 5 分钟自动刷新，Token 过期时自动重试
- **多客服账号隔离** — 每个客服账号拥有独立的会话、游标和路由上下文，通过 per-kfId 互斥锁隔离处理
- **DM 策略控制** — 可配置的访问控制模式：`open`（开放）、`allowlist`（白名单），包含安全适配器。`pairing`（配对）模式尚未实现。
- **文本分块** — 自动按微信 2000 字符消息限制拆分长回复，并声明 chunker 供框架集成
- **会话限制感知** — 检测并优雅处理微信 48 小时回复窗口和 5 条消息限制
- **竞态条件安全** — per-kfId 互斥锁和 msgid 去重，防止消息重复处理
- **仿真回复延迟** — 可配置的打字延迟模拟，营造自然的对话节奏
- **优雅关停** — 响应中止信号，带前置检查守卫，干净地停止 webhook 服务器和轮询

## 前提条件

1. 一个**企业微信账号**，且拥有管理员权限 — [注册地址](https://work.weixin.qq.com/)
2. 至少一个**客服账号**（在企业微信的「微信客服」模块中创建）
3. 一个**公网可访问的 URL**，用于接收回调 — 可使用 [ngrok](https://ngrok.com/)、[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) 或有公网 IP 的服务器
4. 已安装并运行 **OpenClaw Gateway**（`openclaw gateway start`）

微信客服 API 有**两种接入方式**，请根据实际情况选择：

|                   | 方式一：企业微信后台自建应用                                      | 方式二：微信客服后台 API 托管                      |
| ----------------- | ----------------------------------------------------------------- | -------------------------------------------------- |
| **管理入口**      | [企业微信管理后台](https://work.weixin.qq.com/wework_admin/frame) | [微信客服管理后台](https://work.weixin.qq.com/kf/) |
| **Secret 来源**   | 自建应用的 Secret（应用密钥）                                     | 微信客服专属 Secret（开发配置中查看）              |
| **回调配置位置**  | 企业微信后台 → 微信客服 → API → 回调设置                          | 微信客服后台 → 开发配置 → 回调设置                 |
| **回调 URL 要求** | 必须使用经过企业认证的域名（需在企业微信后台完成可信域名配置）    | 无此限制，任意公网可访问的 URL 即可                |
| **需要自建应用**  | 是 — 需创建应用并关联微信客服权限                                 | 否 — 直接在微信客服后台配置                        |
| **IP 白名单**     | 在自建应用中配置「企业可信 IP」                                   | 不需要（微信客服后台无此限制）                     |
| **适用场景**      | 已有企业微信自建应用、需与其他企微功能集成                        | 仅需微信客服能力、追求简单快速接入                 |
| **推荐程度**      | 功能更完整，适合复杂场景                                          | 配置更简单，适合快速上手                           |

> **重要：** 两种方式是**互斥关系** — 同一个客服账号只能通过其中一种方式管理，不能同时使用。选定后如需切换，需要先解除当前方式的 API 绑定。

## 安装

```bash
openclaw plugins install @pawastation/wechat-kf
```

## 企业微信客服接入指南

两种接入方式共享相同的底层 API（`sync_msg`、`send_msg` 等），区别仅在于凭证获取方式和管理入口不同。本插件对两种方式**完全兼容**。

---

### 方式一：企业微信后台自建应用

通过企业微信管理后台创建自建应用，然后将该应用与微信客服 API 关联。这是功能最完整的接入方式。

#### 第 1 步：获取企业 ID（Corp ID）

1. 登录[企业微信管理后台](https://work.weixin.qq.com/wework_admin/frame)
2. 点击左侧菜单最下方的**「我的企业」**
3. 在页面底部找到并复制**「企业ID」** — 格式如 `wwXXXXXXXXXXXXXXXX`

#### 第 2 步：创建自建应用并获取 Secret

1. 进入**「应用管理」→「自建」**
2. 点击**「创建应用」**（或使用已有应用）
3. 进入应用详情页，获取**「Secret」**（应用密钥）

> 每个自建应用有独立的 Secret。调用微信客服 API 时，需要使用与微信客服关联的应用 Secret 来获取 access_token。

#### 第 3 步：开启微信客服 API 并关联自建应用

1. 回到**「应用管理」页面**，进入**「微信客服」**
2. 点击**「API」**小按钮
3. 在**「可调用接口的应用」**中选择你在第 2 步创建的自建应用
4. 在**「通过 API 管理微信客服账号 → 企业内部开发」**中，勾选需要通过 API 管理的客服账号

> 开启后，被选中账号的所有消息与事件都将通过回调推送给你的应用，原有的原生接待规则将暂不生效。

#### 第 4 步：配置回调地址（Callback URL）

1. 在微信客服的 API 设置页面，找到**「回调设置」**
2. 设置**回调地址（URL）**：
   ```
   https://your-domain.com/wechat-kf
   ```
   > 使用你的公网 URL。企业微信回调 URL 必须使用经过企业认证的域名（需在企业微信后台完成可信域名配置）。
3. 设置 **Token** — 任意随机字符串（英文或数字，不超过 32 位），或点击**「随机获取」**自动生成
4. 设置 **EncodingAESKey** — 43 位字符串（英文或数字），或点击**「随机获取」**自动生成
5. 点击**「保存」** — 企业微信会发送一个 GET 验证请求到你的回调地址

> **注意：** 保存回调配置前，webhook 服务必须已经在运行，否则验证会失败。请先启动 OpenClaw Gateway（参考[验证步骤](#验证)）。

> **重要：** 企业微信后台自建应用的回调 URL 必须使用经过企业认证的域名（需在企业微信后台完成可信域名配置），而微信客服后台的 API 托管方式没有此限制，任意公网可访问的 URL 即可。如果你没有经过认证的域名，建议使用方式二。

#### 第 5 步：配置 IP 白名单

1. 在自建应用设置中，进入**「企业可信IP」**或**「IP 白名单」**
2. 添加你服务器的公网 IP 地址
3. 查看当前公网 IP：`curl -s https://api.ipify.org`

> **注意：** 如果你的公网 IP 发生变化（家庭宽带常见），API 调用会因认证失败而报错。请注意监控 IP 变化并及时更新白名单。

#### 第 6 步：创建客服账号

1. 在**「微信客服」**页面，点击**「添加客服账号」**
2. 配置客服名称、头像等信息
3. 记录 **open_kfid** — 格式如 `wkXXXXXXXXXXXXXXXX`
4. 生成**「客服链接」**分享给用户 — 微信用户通过此链接发起咨询

> 你不需要在 OpenClaw 配置中填写 open_kfid。插件会自动从 webhook 事件中发现客服账号。

---

### 方式二：微信客服后台 API 托管

通过[微信客服管理后台](https://work.weixin.qq.com/kf/)直接启用 API，无需创建企业微信自建应用。配置更简单，适合只需要微信客服功能的场景。

#### 第 1 步：获取企业 ID（Corp ID）

1. 登录[企业微信管理后台](https://work.weixin.qq.com/wework_admin/frame)
2. 点击**「我的企业」**，复制**「企业ID」** — 格式如 `wwXXXXXXXXXXXXXXXX`

> Corp ID 始终从企业微信管理后台获取，两种方式相同。

#### 第 2 步：在微信客服后台启用 API

1. 访问[微信客服管理后台](https://work.weixin.qq.com/kf/)（需管理员扫码登录）
2. 进入**「开发配置」**
3. 点击**「启用 API」**，按照指引填写回调配置

#### 第 3 步：获取微信客服 Secret

1. 启用 API 后，在**「开发配置」**页面查看并复制 **Secret**
2. 此 Secret 由企业微信团队下发给管理员，是**微信客服专属 Secret**，与自建应用 Secret 不同
3. 如未显示 Secret，点击查看/重置后复制

> **重要区别：** 此处获取的 Secret 是「微信客服」专用密钥，而非自建应用密钥。使用此 Secret 获取的 access_token 仅可调用微信客服相关接口。

#### 第 4 步：配置回调地址（Callback URL）

1. 在**「开发配置」**页面，找到回调配置区域
2. 设置**回调地址（URL）**：
   ```
   https://your-domain.com/wechat-kf
   ```
3. 设置 **Token** — 任意随机字符串，或点击**「随机获取」**自动生成
4. 设置 **EncodingAESKey** — 43 位字符串，或点击**「随机获取」**自动生成
5. 保存配置 — 系统会发送 GET 验证请求到回调地址

> **注意：** 同样需要先启动 webhook 服务再保存配置，否则验证会失败。

#### 第 5 步：创建客服账号

1. 在微信客服后台创建客服账号
2. 记录 **open_kfid**
3. 生成**「客服链接」**分享给用户

> 启用 API 后，该账号的所有消息和事件都将通过回调推送给你的服务，你需要及时通过 API 收发消息以保证正常服务。

---

### 两种方式对照表

| 对比项            | 方式一：企业微信后台自建应用                                                   | 方式二：微信客服后台 API 托管                                    |
| ----------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| **配置复杂度**    | 较高 — 需创建应用、关联权限、配置白名单                                        | 较低 — 直接启用 API 即可                                         |
| **Secret 类型**   | 自建应用 Secret（应用密钥）                                                    | 微信客服专属 Secret                                              |
| **回调 URL 要求** | 必须使用经过企业认证的域名（需完成可信域名配置）                               | 无此限制，任意公网可访问的 URL 即可                              |
| **IP 白名单**     | 必须配置（自建应用安全要求）                                                   | 无需配置                                                         |
| **API 能力**      | 完整 — 可同时调用企业微信其他 API                                              | 仅限微信客服相关接口                                             |
| **管理灵活性**    | 高 — 可精细控制哪些客服账号走 API                                              | 中 — API 启用后覆盖所有账号                                      |
| **与企微集成**    | 天然集成 — 员工可在企微客户端接待                                              | 独立运作 — 不依赖企微客户端                                      |
| **适合谁**        | 已有企微开发经验、需要多功能集成的团队                                         | 只需 AI 客服、追求最快上手的开发者                               |
| **凭证获取**      | 企业微信管理后台 → 应用管理 → 应用详情                                         | 微信客服管理后台 → 开发配置                                      |
| **回调配置**      | 企业微信后台 → 微信客服 → API → 回调设置                                       | 微信客服后台 → 开发配置 → 回调设置                               |
| **官方文档**      | [企业微信开发者文档](https://developer.work.weixin.qq.com/document/path/94638) | [微信客服 API 文档](https://kf.weixin.qq.com/api/doc/path/93304) |

> **本插件对两种方式完全兼容** — 无论你使用哪种方式获取的 `corpId`、`appSecret`（Secret）、`token`、`encodingAESKey`，填入 OpenClaw 配置即可正常工作。配置字段 `appSecret` 既可以填自建应用 Secret，也可以填微信客服专属 Secret。

## 配置

将以下内容添加到你的 OpenClaw 配置文件（`~/.openclaw/openclaw.yaml` 或通过 `openclaw config` 命令）：

```yaml
channels:
  wechat-kf:
    enabled: true
    corpId: "wwXXXXXXXXXXXXXXXX" # 企业 ID
    appSecret: "your-app-secret-here" # 应用密钥（自建应用 Secret 或微信客服 Secret）
    token: "your-callback-token" # 回调 Token
    encodingAESKey: "your-43-char-key" # 回调 EncodingAESKey（43 位字符）
    webhookPort: 9999 # Webhook 服务端口（默认：9999）
    webhookPath: "/wechat-kf" # Webhook URL 路径（默认：/wechat-kf）
    dmPolicy: "open" # 访问控制：open | allowlist（pairing 尚未实现）
    # allowFrom:                           # 仅在 dmPolicy 为 allowlist 时使用
    #   - "external_userid_1"
    #   - "external_userid_2"
```

### 配置字段说明

| 字段             | 类型     | 必填   | 默认值       | 说明                                                          |
| ---------------- | -------- | ------ | ------------ | ------------------------------------------------------------- |
| `enabled`        | boolean  | 否     | `false`      | 是否启用该渠道                                                |
| `corpId`         | string   | **是** | —            | 企业 ID                                                       |
| `appSecret`      | string   | **是** | —            | 自建应用密钥或微信客服 Secret                                 |
| `token`          | string   | **是** | —            | Webhook 回调 Token                                            |
| `encodingAESKey` | string   | **是** | —            | 43 位 AES 加密密钥                                            |
| `webhookPort`    | integer  | 否     | `9999`       | Webhook HTTP 服务端口                                         |
| `webhookPath`    | string   | 否     | `/wechat-kf` | Webhook 回调 URL 路径                                         |
| `dmPolicy`       | string   | 否     | `"open"`     | `open`（开放）/ `allowlist`（白名单）。`pairing` 尚未实现     |
| `allowFrom`      | string[] | 否     | `[]`         | 允许的 external_userid 列表（dmPolicy 为 `allowlist` 时使用） |

## 验证

1. 启动 OpenClaw Gateway：
   ```bash
   openclaw gateway start
   ```
2. 暴露 webhook 端口（如果不在公网服务器上）：
   ```bash
   ngrok http 9999
   ```
3. 复制 HTTPS URL（如 `https://xxxx.ngrok-free.app`），在企业微信中设置回调地址：
   ```
   https://xxxx.ngrok-free.app/wechat-kf
   ```
4. 企业微信发送 GET 验证请求 — 插件自动解密 `echostr` 并响应
5. 从微信中通过客服链接发送测试消息，确认 Agent 正常回复

## 使用方式

配置完成并运行后，插件自动工作：

1. **用户**在微信中点击客服链接发起对话
2. **入站消息**通过 webhook 到达 → 插件解密、通过 `sync_msg` 同步消息、下载媒体附件，然后分发给 OpenClaw Agent
3. **Agent** 处理消息并生成回复
4. **出站回复**通过企业微信 `send_msg` API 发送，Markdown 自动转换为 Unicode 格式化纯文本

### 从 Agent 发送消息

Agent 可以使用 `message` 工具发送消息：

- **回复当前对话** — 省略 `target`，回复将发送给发消息的用户
- **发送给特定用户** — 将 `target` 设为用户的 `external_userid`
- **发送媒体** — 使用 `filePath` 或 `media` 附加图片、语音、视频或文件

### 支持的入站消息类型

| 微信消息类型 | 处理方式                                  |
| ------------ | ----------------------------------------- |
| 文本         | 原样传递给 Agent                          |
| 图片         | 下载保存为媒体附件，向 Agent 发送占位文本 |
| 语音         | 下载为 AMR 格式，保存为媒体附件           |
| 视频         | 下载为 MP4 格式，保存为媒体附件           |
| 文件         | 下载保存为媒体附件                        |
| 位置         | 转换为文本：`[位置: 名称 地址]`           |
| 链接         | 转换为文本：`[链接: 标题 URL]`            |
| 小程序       | 转换为文本，包含标题和 appid              |
| 视频号       | 转换为文本，包含类型、昵称、标题          |
| 名片         | 转换为文本，包含 userid                   |
| 合并转发消息 | 解析并展开为可读文本                      |

### 支持的出站消息类型

文本、图片、语音、视频、文件和链接消息。本地文件在发送前会自动上传到微信临时素材存储。

## 架构

```
微信用户
    |
    v
企业微信服务器（腾讯）
    |
    |--- POST 回调 --->  webhook.ts ---> 验证签名 + 大小/方法守卫
    |    (加密 XML)          |           解密 AES-256-CBC
    |                        |           提取 OpenKfId + Token
    |                        v
    |                    bot.ts ---> DM 策略检查
    |                        |       per-kfId 互斥锁 + msgid 去重
    |                        |       sync_msg API（拉取消息）
    |                        |       基于游标的增量同步
    |                        |       处理事件（enter_session 等）
    |                        |       下载媒体附件
    |                        v
    |                 OpenClaw Agent（通过 runtime 分发）
    |                        |
    |            +-----------+-----------+
    |            v                       v
    |     outbound.ts              reply-dispatcher.ts
    |     (框架驱动)               (插件内部流式处理)
    |     chunker 声明              markdown -> unicode
    |     sendText / sendMedia      文本分块 + 延迟
    |            |                       |
    |            +-----------+-----------+
    |                        v
    |                  send-utils.ts
    |                  formatText, detectMediaType
    |                  uploadAndSendMedia
    |                  downloadMediaFromUrl
    |                        v
    +--- send_msg API <-- api.ts
         (JSON)
```

### 核心模块

| 模块                  | 职责                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------- |
| `webhook.ts`          | HTTP 服务器 — GET 验证、POST 事件处理、大小/方法守卫                                  |
| `crypto.ts`           | AES-256-CBC 加密/解密、SHA-1 签名验证、PKCS#7 填充校验                                |
| `token.ts`            | Access Token 缓存，哈希键存储，自动刷新                                               |
| `api.ts`              | 企业微信 API 客户端（sync_msg、send_msg、媒体上传/下载），Token 过期自动重试          |
| `accounts.ts`         | 动态客服账号发现、解析、启用/禁用/删除生命周期                                        |
| `bot.ts`              | 消息同步（互斥锁 + 去重）、DM 策略检查、事件处理、Agent 分发                          |
| `monitor.ts`          | Webhook + 轮询生命周期管理，AbortSignal 守卫                                          |
| `reply-dispatcher.ts` | 插件内部流式回复投递，包含分块、格式化、延迟                                          |
| `outbound.ts`         | 框架驱动的出站适配器，声明 chunker                                                    |
| `send-utils.ts`       | 共享出站工具（formatText、detectMediaType、uploadAndSendMedia、downloadMediaFromUrl） |
| `chunk-utils.ts`      | 文本分块，支持自然边界拆分（换行、空格、硬截断）                                      |
| `constants.ts`        | 共享常量（WECHAT_TEXT_CHUNK_LIMIT、超时、错误码）                                     |
| `fs-utils.ts`         | 原子文件操作（临时文件 + 重命名）                                                     |
| `unicode-format.ts`   | Markdown 转 Unicode 数学字母符号格式化                                                |
| `channel.ts`          | ChannelPlugin 接口，包含安全适配器（resolveDmPolicy、collectWarnings）                |
| `runtime.ts`          | OpenClaw 运行时引用持有                                                               |

### 状态持久化

- **同步游标** — 按客服账号保存在 `~/.openclaw/state/wechat-kf/wechat-kf-cursor-{kfid}.txt`（原子写入）
- **已发现的客服 ID** — 保存在 `~/.openclaw/state/wechat-kf/wechat-kf-kfids.json`（原子写入）
- **Access Token** — 仅内存缓存，使用哈希键（重启后重新获取）

## 限制与已知问题

- **开放访问特性** — 微信客服在微信生态中本质上是公开服务。任何获取到客服联系方式（链接或二维码）的人都可以向客服账号发送消息 — 这在微信平台层面无法阻止。插件的 `dmPolicy: "allowlist"` 模式可以限制 agent 只回复白名单内的用户（非白名单用户的消息会被静默丢弃，不会触发 agent 也不会收到回复），但无法阻止未知用户触达客服入口本身。请在生产环境部署前充分了解这一公开服务特性。
- **48 小时回复窗口** — 微信仅允许在用户最后一条消息后 48 小时内回复。插件检测此限制（errcode 95026）并记录清晰警告。
- **5 条消息限制** — 在用户发送下一条消息前，最多只能发送 5 条回复。插件检测此限制并相应记录日志。
- **语音格式** — 入站语音消息为 AMR 格式；转录取决于 OpenClaw Agent 的媒体处理能力。
- **仅临时素材** — 上传的媒体使用微信临时素材 API（3 天有效期）。未实现永久素材上传。
- **单一 webhook 端点** — 所有客服账号共享同一个 webhook 端口和路径。这是设计如此（企业微信为每个企业发送所有回调到同一个 URL）。
- **不支持群聊** — 微信客服仅支持一对一会话。插件仅支持 `direct` 聊天类型。
- **IP 白名单漂移** — 如果服务器公网 IP 变化，API 调用将静默失败。请监控 IP 或使用静态 IP。

## 开发

```bash
# 安装依赖
pnpm install

# 构建
pnpm run build

# 类型检查
pnpm run typecheck

# 运行测试（16 个文件，363 个测试）
pnpm test

# 监听模式
pnpm run test:watch

# 代码检查（Biome）
pnpm run lint

# 代码检查 + 自动修复（Biome）
pnpm run lint:fix

# 格式化（Biome）
pnpm run format

# 综合 Biome 检查（代码检查 + 格式化）
pnpm run check
```

## 贡献

1. Fork 本仓库
2. 创建功能分支（`git checkout -b feature/my-feature`）
3. 修改代码并添加测试
4. 运行 `pnpm run check && pnpm run typecheck && pnpm test` 验证
5. 提交 Pull Request

## 许可证

MIT
