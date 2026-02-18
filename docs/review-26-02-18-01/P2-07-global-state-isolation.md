# P2-07: 模块级全局可变状态封装

## 来源

Business Logic 审查 M1 + Plugin Interface 审查 M1

## 问题描述

以下模块使用模块级全局变量存储可变状态：

| 模块 | 全局变量 | 风险 |
|------|---------|------|
| `accounts.ts` | `discoveredKfIds: Set`, `stateDir: string` | 多实例共享、测试泄漏 |
| `runtime.ts` | `runtime: PluginRuntime \| null` | 多实例共享 |
| `token.ts` | `cache: Map`, `pending: Map` | 多实例共享 |

问题：
1. 同一进程多个插件实例时状态互相污染
2. 测试用例之间状态泄漏
3. `discoveredKfIds` 没有 clear 机制，只增不减
4. `stateDir` 在两处设置，容易不一致

## 目标

封装可变状态，支持多实例独立运行和测试隔离。

## 具体改动

### 方案 A：类封装（推荐）

```typescript
// src/accounts.ts
export class AccountManager {
  private discoveredKfIds = new Set<string>();
  private stateDir: string | null = null;

  setStateDir(dir: string) { this.stateDir = dir; }
  registerKfId(kfId: string) { ... }
  getKnownKfIds(): string[] { ... }
  async loadKfIds(dir: string) { ... }
  clear() { this.discoveredKfIds.clear(); this.stateDir = null; }
}
```

```typescript
// src/runtime.ts
export class RuntimeHolder {
  private runtime: PluginRuntime | null = null;
  set(rt: PluginRuntime) { this.runtime = rt; }
  get(): PluginRuntime | null { return this.runtime; }
  clear() { this.runtime = null; }
}
```

在 `channel.ts` 或顶层创建实例，通过 context 传递。

### 方案 B：提供 reset 函数（最小改动）

为每个模块添加 `_reset()` 函数供测试使用：

```typescript
/** @internal for testing only */
export function _reset() {
  discoveredKfIds.clear();
  stateDir = null;
}
```

## 验收标准

- [ ] 全局可变状态被封装或可重置
- [ ] 测试用例之间不会出现状态泄漏
- [ ] 现有功能不退化（`pnpm test` 通过）
- [ ] 如选方案 A，`channel.ts` 通过 context 传递实例而非直接 import 全局变量

## 涉及文件

- `src/accounts.ts` — 封装或添加 reset
- `src/runtime.ts` — 封装或添加 reset
- `src/token.ts` — 添加 reset（清除 cache + pending）
- `src/channel.ts` — 适配新的状态管理方式
- `src/bot.ts` — 适配
