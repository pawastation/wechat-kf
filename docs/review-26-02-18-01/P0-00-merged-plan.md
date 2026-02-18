# P0-00: 合并改进计划 — 官方规范优先 + 最佳实践

## 核心原则

> 尽可能以官方建议的方式实现功能，再补充最佳实践。
> 凡是框架已提供的能力，不在插件中重复实现。

---

## 一、源码调查结论（2026-02-18 已确认）

通过阅读 OpenClaw 框架源码（`git@github.com:openclaw/openclaw.git`），确认了以下关键行为：

### P0-01 结论：框架分块行为

**框架不会自动分块，除非 channel 声明了 `chunker` 函数。**

- 框架在 `deliverOutboundPayloads()` → `sendTextChunks()` 中检查 `handler.chunker`
- `chunker` 为 null → 直接调用 `sendText(fullText)`，不分块
- `chunker` 存在 → 根据 `chunkMode`（`"length"` | `"newline"`）分块后逐块调用 `sendText`
- `chunkerMode` 实际值是 `"text"` | `"markdown"`（adapter 声明的分块算法类型）
- 当前 wechat-kf 没有声明 `chunker` → sendText 收到的是**完整长文本**

**→ 需要声明 `chunker` 函数，参考 WhatsApp 实现。**

### P0-02 结论：capabilities.media

**`media: false` 不阻止框架调用 sendMedia，但影响 agent 对能力的感知。**

- `capabilities.media` 是纯声明性字段，不影响运行时路由
- 框架路由仅看 payload 有无 mediaUrls，不检查 capabilities
- `sendMedia` 已经在工作（不是死代码）
- 但 `media: false` 导致 agent 不知道可以发媒体

**→ 改为 `true` + 更新 agentPrompt。紧迫度从"功能缺失"降为"声明修正"。**

### P0-04 结论：security 适配器

**需要实现 `security.resolveDmPolicy`，这是标准做法。**

- ~17 个 channel 插件都实现了 `resolveDmPolicy`
- `config.resolveAllowFrom` 只是静态查询，不负责策略执行
- DM 策略执行在入站消息处理器中（对应 bot.ts）
- 支持 pairing 流程（未授权用户 → 配对请求 → 审批）

**→ 补充 security 适配器 + bot.ts 入站检查。保留 resolveAllowFrom。**

---

## 二、交叉影响矩阵

### 被「对齐官方规范」直接覆盖或改变的 TODO

| 源码调查发现 | 影响的现有 TODO | 影响方式 |
|-------------|----------------|----------|
| 需声明 `chunker` 函数 | **P1-06** (outbound 分块) | P1-06 的"在 sendText 中手动分块"应**改为声明 chunker**，让框架分块 |
| `capabilities.media` 是声明性字段 | **P2-04** (send path unification) | sendMedia 已在工作，两条路径职责不同不需要统一 |
| 需要 `security.resolveDmPolicy` | **P3-06** (account enable/delete) | DM policy 部分由 security 适配器覆盖 |
| startMonitor 幂等性 | **P2-11** (startAccount lifecycle) | 应合并：框架对多个 account 分别调用 startAccount 时需确保 webhook server 只创建一次 |
| Manifest 缺 `additionalProperties: false` | **P1-07** (config schema) | 修复时应同步对齐 manifest |
| 三处 configSchema 不一致 | **P1-07** | manifest / config-schema.ts / index.ts 三处 schema 应统一 |

### 不受影响的 TODO（仍然有效）

| TODO | 原因 |
|------|------|
| P1-01 (竞态+去重) | 纯业务逻辑层，与框架无关 |
| P1-02 (cursor 保存时机) | 同上 |
| P1-03 (PKCS#7 padding) | 安全问题，与框架无关 |
| P1-04 (token 重试) | API 层，与框架无关 |
| P1-05 (downloadMedia 错误) | API 层，与框架无关 |
| P1-07 (config schema required) | 仍需修复，但应与 plugin.json 对齐 |
| P1-08 (startAccount 错误处理) | 仍需要 |
| P1-09 (fetch 超时) | 仍需要 |
| P1-10 (原子写入) | 仍需要 |
| P2-01 (类型安全) | 仍需要，且应包含新接口类型 |
| P2-02 (测试覆盖) | 仍需要 |
| P2-03 (markdown 修复) | 仍需要 |
| P2-05 (sync_msg token/cursor) | 仍需要 |
| P2-06 (abort signal) | 仍需要 |
| P2-07 (全局状态) | 仍需要 |
| P2-08 (事件处理) | 仍需要 |
| P2-09 (API send 去重) | 仍需要 |
| P2-10 (输入验证) | 仍需要 |
| P2-12 (webhook 加固) | 仍需要 |
| P3-01 (token cache key) | 仍需要 |
| P3-02 (errcode 检查) | 仍需要 |
| P3-03 (build 配置) | 仍需要 |
| P3-05 (杂项) | 仍需要 |

### 应合并的 TODO 组

| 合并后 | 原 TODO | 合并理由 |
|--------|---------|----------|
| **「声明 chunker + 统一常量」** | P1-06 + P0-01 | 统一处理出站分块问题 |
| **「共享出站基础设施」** | P2-04 部分 + P0-03 | 共享工具函数，保持路径独立 |
| **「startAccount 完整修复」** | P1-08 + P2-11 + 幂等性 | 同一函数的三个问题 |

---

## 三、修订后的优先级排序

### 第 0 批：对齐官方规范（5 项，已完成源码调查）

| 编号 | 改动 | 源码调查结论 | 实施复杂度 |
|------|------|-------------|-----------|
| P0-01 | 声明 chunker 函数 + 统一 textChunkLimit | 需声明 chunker，参考 WhatsApp | 中（新建 chunk-utils.ts + constants.ts） |
| P0-02 | capabilities.media = true + agentPrompt | 声明性修正，sendMedia 已工作 | 低 |
| P0-03 | 两条出站路径职责文档化 + 共享工具 | 路径职责已确认 | 中（新建 send-utils.ts） |
| P0-04 | security 适配器 resolveDmPolicy | 需实现，参考 Discord | 中（channel.ts + bot.ts） |
| P0-05 | Manifest 对齐 | 不依赖源码调查 | 低 |

### 第 1 批：核心安全 + 可靠性（P1，不变）

| 顺序 | 编号 | 改动 | 状态 |
|------|------|------|------|
| 1 | P1-01 | Webhook/轮询竞态 + 去重 | **不变** |
| 2 | P1-02 | Cursor 保存时机 | **不变** |
| 3 | P1-03 | PKCS#7 padding | **不变** |
| 4 | P1-04 | Token 过期重试 | **不变** |
| 5 | P1-05 | downloadMedia 错误检测 | **不变** |
| 6 | P1-07 | Config schema required（与 plugin.json 对齐） | **微调** |
| 7 | P1-08+ | **startAccount 完整修复**（含原 P2-11 + 幂等性） | **合并** |
| 8 | P1-09 | fetch 超时 | **不变** |
| 9 | P1-10 | 原子写入 | **不变** |

注意：原 P1-06 已合并到 P0-01。

### 第 2 批：质量 + 健壮性（P2）

| 顺序 | 编号 | 改动 | 状态 |
|------|------|------|------|
| 1 | P2-01 | 类型安全（含新接口类型） | **扩展** |
| 2 | P2-02 | 测试覆盖 | **不变** |
| 3 | P2-03 | Markdown 转换修复 | **不变** |
| 4 | P2-05 | sync_msg token/cursor | **不变** |
| 5 | P2-06 | AbortSignal guard | **不变** |
| 6 | P2-07 | 全局状态封装 | **不变** |
| 7 | P2-08 | 事件处理 | **不变** |
| 8 | P2-09 | API send 函数去重 | **不变** |
| 9 | P2-10 | 输入验证 | **不变** |
| 10 | P2-12 | Webhook 加固 | **不变** |

注意：原 P2-04 已拆分并入 P0-02 + P0-03。原 P2-11 已合并到 P1-08。

### 第 3 批：功能增强 + 清理（P3）

| 顺序 | 编号 | 改动 | 状态 |
|------|------|------|------|
| 1 | P3-01 | Token cache key | **不变** |
| 2 | P3-02 | errcode 检查模式 | **不变** |
| 3 | P3-03 | Build 配置 | **不变** |
| 4 | P3-04 | HTTP 媒体 + 5msg 限制 | **优先级提升** |
| 5 | P3-05 | 杂项清理 | **不变** |
| 6 | P3-06 | Account enable/delete | **部分被 P0-04 覆盖** |
| 7 | P3-07 | 注册 CLI 命令 | **新增** |
| 8 | P3-08 | 注册 Agent Tools | **新增** |

---

## 四、废弃或大幅变更的 TODO

| 原 TODO | 处置 | 原因 |
|---------|------|------|
| **P1-06** (outbound 手动分块) | **废弃/改写** → 合并到 P0-01 | 应声明 chunker 让框架分块，而非在 sendText 内手动分块 |
| **P2-04** (统一两条发送路径) | **废弃/拆分** → M1 入 P0-02，策略改为 P0-03 | 两条路径职责不同，不应强行统一 |
| **P2-11** (startAccount 生命周期) | **合并** → 入 P1-08 | 同一函数的三个问题放在一起修 |
| **P3-06** (account enable/delete) | **部分覆盖** → 视 P0-04 结果 | DM policy 部分由 security 适配器覆盖 |

---

## 五、实施路线图

```
第 0 批 (对齐官方) ─┬─ P0-01 声明 chunker 函数 + chunk-utils.ts + constants.ts
   源码调查已完成     ├─ P0-02 media=true + agentPrompt 更新
                    ├─ P0-03 send-utils.ts 共享工具 + 职责注释
                    ├─ P0-04 security.resolveDmPolicy + bot.ts DM 检查
                    └─ P0-05 manifest 对齐 (additionalProperties + uiHints + schema 统一)
                         │
                         ▼
第 1 批 (安全可靠) ─┬─ P1-01 竞态+去重
                    ├─ P1-02 cursor 时机  ←─ 依赖 P1-01
                    ├─ P1-03 PKCS#7
                    ├─ P1-04 token 重试
                    ├─ P1-05 downloadMedia
                    ├─ P1-07 config schema
                    ├─ P1-08+ startAccount 完整修复 (含原 P2-11 + 幂等性)
                    ├─ P1-09 fetch 超时
                    └─ P1-10 原子写入
                         │
                         ▼
第 2 批 (质量)   ─┬─ P2-01 类型安全 (扩展)
                   ├─ P2-02 测试覆盖
                   ├─ P2-03 Markdown
                   └─ ... (其余 P2)
                         │
                         ▼
第 3 批 (增强)   ─── P3-* + CLI + Agent Tools
```

第 0 批的**源码调查已完成**，可以直接进入实施阶段。

---

## 六、完成状态（2026-02-18 更新）

**全部 4 批次均已实施完成（P3-07/P3-08 待建除外）。**

### 第 0 批：对齐官方规范 — 全部完成

| 编号 | 改动 | Commit |
|------|------|--------|
| P0-01 | 声明 chunker 函数 + 统一常量 | `75939d3` |
| P0-02 | capabilities.media = true + agentPrompt | `906d03c` |
| P0-03 | send-utils.ts 共享工具 + 职责注释 | `6fa0e67` |
| P0-04 | security.resolveDmPolicy + bot.ts DM 检查 | `52ed655` |
| P0-05 | manifest 对齐 | `b08c09c` |

### 第 1 批：核心安全 + 可靠性 — 全部完成

| 编号 | 改动 | Commit |
|------|------|--------|
| P1-01 | Webhook/轮询竞态 + 去重 | `635b45c` |
| P1-02 | Cursor 保存时机（含在 P1-10 原子写入中） | `b31583b` |
| P1-03 | PKCS#7 padding 完整验证 | `60b6258` |
| P1-04 | Token 过期自动重试 | `cdb1992` |
| P1-05 | downloadMedia 错误检测 | `cdb1992` |
| P1-07 | Config schema required 对齐 | `93f72fa` |
| P1-08 | startAccount 完整修复（含原 P2-11 + 幂等性） | `a706b7a` |
| P1-09 | fetch 超时 | `cdb1992` |
| P1-10 | 原子文件写入 | `b31583b` |

### 第 2 批：质量 + 健壮性 — 全部完成

| 编号 | 改动 | Commit |
|------|------|--------|
| P2-01 | 类型安全（含新接口类型） | `e0605f4` |
| P2-02 | 测试覆盖补全 | `d37800b` |
| P2-03 | Markdown 转换修复 | `5dcb3bc` |
| P2-05 + P2-08 | sync_msg token/cursor 修复 + 事件处理 | `651f994` |
| P2-06 | AbortSignal 状态检查 | `241c1d0` |
| P2-07 | 全局状态封装 | `6fcac9c` |
| P2-09 + P2-10 | API send 去重 + 输入验证 | `314cff3` |
| P2-12 | Webhook 服务器加固 | `d145e31` |

### 第 3 批：功能增强 + 清理 — 6/8 完成

| 编号 | 改动 | 状态 | Commit |
|------|------|------|--------|
| P3-01 | Token cache key 哈希化 | 已完成 | `ed5cb6a` |
| P3-02 | errcode 检查模式统一 | 已完成 | `a890160` |
| P3-03 | Build 配置优化 | 已完成 | `5657459` |
| P3-04 | HTTP 媒体下载 + 5msg 限制 | 已完成 | `e3358c8` |
| P3-05 | 杂项清理 | 已完成 | `2bdf0a9` |
| P3-06 | 账户禁用/删除 | 已完成 | `3084b26` |
| P3-07 | 注册 CLI 命令 | **待建** | — |
| P3-08 | 注册 Agent Tools | **待建** | — |

### 额外改进

| 改动 | Commit |
|------|--------|
| Biome linter/formatter 添加 + 全量 lint 修复 | `55f9a12` |

### 废弃追踪确认

所有 3 项废弃/合并均已在对应的目标 TODO 中实施：
- ~~P1-06~~ → 合并到 P0-01 (`75939d3`)
- ~~P2-04~~ → 拆分到 P0-02 (`906d03c`) + P0-03 (`6fa0e67`)
- ~~P2-11~~ → 合并到 P1-08 (`a706b7a`)
