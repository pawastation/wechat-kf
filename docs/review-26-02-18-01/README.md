# 代码审查改进清单

审查日期：2026-02-18

## 完成状态总结

> **总计 32 项（含废弃合并），已完成 27 项，待建 2 项，废弃 3 项。**
>
> - P0 (对齐官方规范): 5/5 已完成
> - P1 (Critical): 9/9 已完成
> - P2 (Medium): 10/10 已完成
> - P3 (Low): 6/8 已完成，2 项待建 (P3-07, P3-08)
> - 额外改进: Biome linter/formatter (`55f9a12`)
>
> 所有 P0-P2 项及 P3-01 到 P3-06 均已实施并提交。P3-07 和 P3-08 为功能增强，待建。

---

## 优先级说明

- **P0 (Align)**: 对齐 OpenClaw 官方规范。**源码调查已完成，已全部实施。**
- **P1 (Critical)**: 可能导致数据丢失、安全漏洞或功能严重异常
- **P2 (Medium)**: 影响代码质量、可维护性或健壮性
- **P3 (Low)**: 小改进、功能增强、清理

> **核心原则**: 尽可能以官方建议的方式实现功能；凡是框架已提供的能力，不在插件中重复实现。
>
> 详见 [P0-00 合并计划](./P0-00-merged-plan.md) 了解各 TODO 之间的交叉影响和废弃/合并关系。

---

## P0 — 对齐官方规范（5 项，全部完成）

> 通过阅读 OpenClaw 框架源码（`openclaw/openclaw.git`）确认了所有框架行为，不再需要运行时黑盒测试。

| 编号 | 改动 | 源码结论 | 影响 | 状态 | Commit |
|------|------|---------|------|------|--------|
| [P0-01](./P0-01-outbound-chunker-alignment.md) | 声明 chunker 函数 + 统一常量 | 框架不自动分块，需声明 chunker | **取代 P1-06** | 已完成 | `75939d3` |
| [P0-02](./P0-02-capabilities-media-true.md) | capabilities.media = true | media 是声明性字段，sendMedia 已在工作 | **取代 P2-04 部分** | 已完成 | `906d03c` |
| [P0-03](./P0-03-send-path-separation.md) | 出站路径职责文档化 + 共享工具 | 两条路径职责不同，共享基础设施 | **取代 P2-04** | 已完成 | `6fa0e67` |
| [P0-04](./P0-04-security-adapter.md) | 实现 security.resolveDmPolicy | ~17 个插件都实现了，是标准做法 | **部分覆盖 P3-06** | 已完成 | `52ed655` |
| [P0-05](./P0-05-manifest-alignment.md) | Manifest 对齐 (additionalProperties + uiHints) | 不依赖源码调查 | **关联 P1-07** | 已完成 | `b08c09c` |

## P1 — Critical（9 项，全部完成）

| 编号 | 文件 | 改动 | 核心风险 | 状态 | Commit |
|------|------|------|----------|------|--------|
| [P1-01](./P1-01-webhook-polling-race-and-dedup.md) | bot.ts | Webhook/轮询竞态 + 消息去重 | 消息重复处理 | 已完成 | `635b45c` |
| [P1-02](./P1-02-cursor-save-timing.md) | bot.ts | Cursor 先处理后保存 | 崩溃丢消息 | 已完成 | `b31583b` (含在 P1-10) |
| [P1-03](./P1-03-pkcs7-padding-full-validation.md) | crypto.ts | PKCS#7 padding 完整验证 | 安全漏洞 | 已完成 | `60b6258` |
| [P1-04](./P1-04-token-expiry-auto-retry.md) | api.ts, token.ts | Token 过期自动重试 | API 间歇性失败 | 已完成 | `cdb1992` |
| [P1-05](./P1-05-download-media-error-detection.md) | api.ts | downloadMedia 检测 JSON 错误 | 静默返回错误数据 | 已完成 | `cdb1992` |
| [P1-07](./P1-07-config-schema-required-fields.md) | config-schema.ts | 补充 required（与 plugin.json 对齐） | 可提交无效配置 | 已完成 | `93f72fa` |
| [P1-08](./P1-08-start-account-error-handling.md) | channel.ts | startAccount 完整修复（含原 P2-11 + 幂等性） | 状态永远 running | 已完成 | `a706b7a` |
| [P1-09](./P1-09-fetch-timeout.md) | api.ts, token.ts | 全局 fetch 超时 | 请求无限挂起 | 已完成 | `cdb1992` |
| [P1-10](./P1-10-atomic-file-persistence.md) | bot.ts, accounts.ts | 原子文件写入 | 崩溃损坏持久化文件 | 已完成 | `b31583b` |

> ~~P1-06~~ 已合并到 P0-01。P1-08 已吸收原 P2-11 内容。

## P2 — Medium（10 项，全部完成）

| 编号 | 文件 | 改动 | 改进方向 | 状态 | Commit |
|------|------|------|----------|------|--------|
| [P2-01](./P2-01-type-safety-overhaul.md) | 全项目 | 类型安全（含新接口类型） | 消除 any | 已完成 | `e0605f4` |
| [P2-02](./P2-02-test-coverage-plan.md) | 全项目 | 测试覆盖补全 | 8 个模块无测试 | 已完成 | `d37800b` |
| [P2-03](./P2-03-markdown-conversion-fixes.md) | unicode-format.ts | Markdown 转换修复 | 正则冲突/缺失语法 | 已完成 | `5dcb3bc` |
| [P2-05](./P2-05-sync-msg-token-cursor.md) | bot.ts | sync_msg token/cursor 互斥 | 参数误用 | 已完成 | `651f994` |
| [P2-06](./P2-06-abort-signal-guard.md) | monitor.ts | AbortSignal 状态检查 | 资源泄漏 | 已完成 | `241c1d0` |
| [P2-07](./P2-07-global-state-isolation.md) | accounts.ts, runtime.ts | 全局状态封装 | 多实例/测试隔离 | 已完成 | `6fcac9c` |
| [P2-08](./P2-08-event-handling.md) | bot.ts | 事件消息处理 | enter_session 等 | 已完成 | `651f994` |
| [P2-09](./P2-09-api-send-dedup.md) | api.ts | send 函数去重 | DRY | 已完成 | `314cff3` |
| [P2-10](./P2-10-input-validation.md) | api.ts, crypto.ts | 输入参数验证 | 防御性编程 | 已完成 | `314cff3` |
| [P2-12](./P2-12-webhook-hardening.md) | webhook.ts, monitor.ts | Webhook 服务器加固 | 安全/错误处理 | 已完成 | `d145e31` |

> ~~P2-04~~ 已拆分并入 P0-02 + P0-03。~~P2-11~~ 已合并入 P1-08。

## P3 — Low（8 项，6 项完成，2 项待建）

| 编号 | 文件 | 改动 | 改进方向 | 状态 | Commit |
|------|------|------|----------|------|--------|
| [P3-01](./P3-01-token-cache-key.md) | token.ts | Cache key 哈希化 | 密钥保护 | 已完成 | `ed5cb6a` |
| [P3-02](./P3-02-errcode-check-pattern.md) | api.ts | 统一 errcode 检查 | 正确性 | 已完成 | `a890160` |
| [P3-03](./P3-03-build-and-packaging.md) | tsconfig.json, package.json | 构建产物优化 | 包质量 | 已完成 | `5657459` |
| [P3-04](./P3-04-media-url-and-5msg-limit.md) | outbound.ts | HTTP 媒体下载 + 消息限制 | 功能增强 | 已完成 | `e3358c8` |
| [P3-05](./P3-05-misc-cleanup.md) | 多文件 | 杂项清理（10 小项） | 代码质量 | 已完成 | `2bdf0a9` |
| [P3-06](./P3-06-account-enable-delete.md) | accounts.ts, channel.ts | 账户禁用/删除 | 功能完善（部分被 P0-04 覆盖） | 已完成 | `3084b26` |
| P3-07 (待建) | index.ts | 注册 CLI 命令 (status/send/accounts) | 功能增强 | **待建** | — |
| P3-08 (待建) | index.ts | 注册 Agent Tools | 功能增强 | **待建** | — |

---

## 额外改进

| 改动 | 说明 | Commit |
|------|------|--------|
| Biome linter/formatter | 添加 Biome 代码检查和格式化工具，修复所有 lint 问题 | `55f9a12` |

---

## 废弃/合并追踪

| 原 TODO | 状态 | 去向 |
|---------|------|------|
| ~~P1-06~~ | 废弃 | → 合并到 [P0-01](./P0-01-outbound-chunker-alignment.md) |
| ~~P2-04~~ | 废弃 | → 拆分到 [P0-02](./P0-02-capabilities-media-true.md) + [P0-03](./P0-03-send-path-separation.md) |
| ~~P2-11~~ | 废弃 | → 合并到 [P1-08](./P1-08-start-account-error-handling.md) |

> 废弃的文档文件保留供参考，但不再执行。以本 README 中的清单为准。

---

## 实施路线图

```
第 0 批 (对齐官方) ─┬─ P0-01 声明 chunker + chunk-utils.ts + constants.ts  ✔ 75939d3
   源码调查已完成     ├─ P0-02 media=true + agentPrompt                     ✔ 906d03c
   全部完成          ├─ P0-03 send-utils.ts 共享工具 + 职责注释              ✔ 6fa0e67
                    ├─ P0-04 security.resolveDmPolicy                       ✔ 52ed655
                    └─ P0-05 manifest 对齐                                  ✔ b08c09c
                         │
                         ▼
第 1 批 (安全可靠) ─┬─ P1-01 竞态+去重                                      ✔ 635b45c
   全部完成          ├─ P1-02 cursor 时机  ←─ 依赖 P1-01                    ✔ b31583b
                    ├─ P1-03 PKCS#7                                         ✔ 60b6258
                    ├─ P1-04 token 重试                                     ✔ cdb1992
                    ├─ P1-05 downloadMedia                                  ✔ cdb1992
                    ├─ P1-07 config schema                                  ✔ 93f72fa
                    ├─ P1-08 startAccount 完整修复                           ✔ a706b7a
                    ├─ P1-09 fetch 超时                                     ✔ cdb1992
                    └─ P1-10 原子写入                                       ✔ b31583b
                         │
                         ▼
第 2 批 (质量)    ─┬─ P2-01 类型安全                                        ✔ e0605f4
   全部完成         ├─ P2-02 测试覆盖                                        ✔ d37800b
                   ├─ P2-03 Markdown                                        ✔ 5dcb3bc
                   ├─ P2-05+08 bot.ts 修复                                  ✔ 651f994
                   ├─ P2-06 AbortSignal                                     ✔ 241c1d0
                   ├─ P2-07 全局状态                                         ✔ 6fcac9c
                   ├─ P2-09+10 API 去重+验证                                ✔ 314cff3
                   └─ P2-12 Webhook 加固                                    ✔ d145e31
                         │
                         ▼
第 3 批 (增强)    ─┬─ P3-01 token cache key                                 ✔ ed5cb6a
   6/8 完成         ├─ P3-02 errcode 检查                                    ✔ a890160
                   ├─ P3-03 build 配置                                      ✔ 5657459
                   ├─ P3-04 媒体 URL + 5msg                                 ✔ e3358c8
                   ├─ P3-05 杂项清理                                        ✔ 2bdf0a9
                   ├─ P3-06 账户禁用/删除                                    ✔ 3084b26
                   ├─ P3-07 CLI 命令                                        ○ 待建
                   └─ P3-08 Agent Tools                                     ○ 待建

额外 ── Biome linter/formatter                                             ✔ 55f9a12
```
