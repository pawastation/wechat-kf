# P1-10: 文件持久化改为原子写入

## 来源

Business Logic 审查 M2（跨层共性问题）

## 问题描述

`saveCursor`（bot.ts）和 `persistKfIds`（accounts.ts）都直接使用 `writeFile` 写入。如果进程在写入过程中崩溃，可能留下截断或损坏的文件。

- Cursor 文件损坏 → 下次启动读取失败 → 回退到无 cursor 状态 → 可能拉取大量历史消息
- KfIds 文件损坏 → JSON 解析失败 → 丢失所有已发现的 kfId

此外，`saveCursor` 每次调用都执行 `mkdir`，虽然 `recursive: true` 使其幂等，但属于不必要的系统调用开销。

## 目标

使用 write-to-temp + rename 模式实现原子写入，防止崩溃导致数据损坏。

## 具体改动

### 提取公共原子写入函数

```typescript
// src/fs-utils.ts
import { writeFile, rename, mkdir } from "node:fs/promises";

export async function atomicWriteFile(
  filePath: string,
  content: string,
  encoding: BufferEncoding = "utf8",
): Promise<void> {
  const tmpPath = filePath + ".tmp";
  await writeFile(tmpPath, content, encoding);
  await rename(tmpPath, filePath); // 同文件系统上是原子操作
}
```

### bot.ts

```typescript
import { atomicWriteFile } from "./fs-utils.js";

let dirCreated = false;

async function saveCursor(stateDir: string, kfId: string, cursor: string): Promise<void> {
  if (!dirCreated) {
    await mkdir(stateDir, { recursive: true });
    dirCreated = true;
  }
  await atomicWriteFile(join(stateDir, `wechat-kf-cursor-${kfId}.txt`), cursor);
}
```

### accounts.ts

```typescript
import { atomicWriteFile } from "./fs-utils.js";

async function persistKfIds(): Promise<void> {
  if (!stateDir) return;
  try {
    await mkdir(stateDir, { recursive: true });
    await atomicWriteFile(
      join(stateDir, "wechat-kf-kfids.json"),
      JSON.stringify(Array.from(discoveredKfIds)),
    );
  } catch {
    // Best effort
  }
}
```

## 验收标准

- [ ] `saveCursor` 和 `persistKfIds` 都使用 `atomicWriteFile`
- [ ] 写入通过 `.tmp` 临时文件 + `rename` 完成
- [ ] `saveCursor` 不再每次调用 `mkdir`（首次创建后设标志）
- [ ] 新增测试：验证 `atomicWriteFile` 在正常情况下文件内容正确
- [ ] 新增测试：验证临时文件写入后 rename 完成，原始文件内容一致
- [ ] `loadCursor` 和 `loadKfIds` 的 fallback 逻辑不变（文件不存在时返回默认值）

## 涉及文件

- `src/fs-utils.ts` — 新建，公共原子写入工具
- `src/bot.ts` — 修改 `saveCursor`
- `src/accounts.ts` — 修改 `persistKfIds`
- `src/fs-utils.test.ts` — 新增测试
