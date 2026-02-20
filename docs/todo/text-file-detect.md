# 文本文件检测与预览方案

## 背景

当用户通过微信客服发送文件时（`msgtype === "file"`），当前实现存在两个问题：

1. **文本占位符无信息** — `extractText` 返回固定字符串 `"[用户发送了一个文件]"`，AI agent 不知道文件名、类型、内容
2. **MIME 类型不准确** — 文件统一标记为 `"application/octet-stream"`，无法利用文件名推断实际类型
3. **文本文件内容丢失** — `.txt`、`.csv`、`.json`、`.py` 等文本文件本可直接提取内容给 agent，但当前只作为不透明二进制处理

### 方案思路

下载文件后检测是否为文本类型，如果是则提取预览内容拼接到 prompt 中，让 AI 能直接"看到"文件内容。

## 架构变更

### 变更范围

| 文件                      | 变更类型 | 说明                                                                 |
| ------------------------- | -------- | -------------------------------------------------------------------- |
| `src/text-detect.ts`      | **新建** | 文本文件检测 + 预览提取                                              |
| `src/bot.ts`              | 修改     | `dispatchMessage` 中增加文本检测；`extractText` file case 增加文件名 |
| `src/types.ts`            | 修改     | `WechatKfMessage.file` 增加 `file_name` 字段                         |
| `src/text-detect.test.ts` | **新建** | 检测器单元测试                                                       |
| `src/bot.test.ts`         | 修改     | 扩展文件处理相关测试                                                 |

### 数据流变化

```
当前流程:
  file msg → extractText → "[用户发送了一个文件]"
  file msg → downloadMedia → mime="application/octet-stream" → saveMediaBuffer

新流程:
  file msg → extractText → "[用户发送了一个文件: report.xlsx]"  (含文件名)
  file msg → downloadMedia → detectTextFile(buffer, fileName)
    → 是文本 → buildFileDescription(fileName, preview) → 替换 text
    → 非文本 → 保持现有行为（二进制保存，使用推断的 MIME）
```

## 数据结构

### 检测结果类型

```typescript
// src/text-detect.ts

/** 文本文件检测结果 */
export type TextDetectResult = {
  /** 是否为文本文件 */
  isText: boolean;
  /** 检测到的编码（"utf-8" | "ascii" | "unknown"） */
  encoding?: string;
  /** 推断的 MIME 类型（如 "text/plain", "text/csv", "application/json"） */
  mime?: string;
};

/** 文件预览结果 */
export type FilePreview = {
  /** 预览文本（截断到 maxLength） */
  content: string;
  /** 原始总字节数 */
  totalBytes: number;
  /** 是否被截断 */
  truncated: boolean;
};
```

### 类型变更

```typescript
// src/types.ts — WechatKfMessage.file 字段扩展
file?: {
  media_id: string;
  file_name?: string;  // 新增：微信 API 返回的原始文件名
};
```

> 注：微信客服 sync_msg API 的 file 消息体中包含 `file_name` 字段（参见[微信开放文档](https://developer.work.weixin.qq.com/document/path/94670)），当前类型定义中缺失该字段。

## 实现步骤

### 步骤 1：新建 `src/text-detect.ts`

```typescript
export type TextDetectResult = {
  isText: boolean;
  encoding?: string;
  mime?: string;
};

export type FilePreview = {
  content: string;
  totalBytes: number;
  truncated: boolean;
};

/** 已知文本文件扩展名 → MIME 类型映射 */
const TEXT_EXTENSIONS: Record<string, string> = {
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".json": "application/json",
  ".xml": "application/xml",
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".ts": "text/typescript",
  ".py": "text/x-python",
  ".rb": "text/x-ruby",
  ".java": "text/x-java",
  ".c": "text/x-c",
  ".cpp": "text/x-c++",
  ".h": "text/x-c",
  ".go": "text/x-go",
  ".rs": "text/x-rust",
  ".sh": "text/x-shellscript",
  ".bash": "text/x-shellscript",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
  ".toml": "text/x-toml",
  ".ini": "text/plain",
  ".cfg": "text/plain",
  ".conf": "text/plain",
  ".log": "text/plain",
  ".sql": "text/x-sql",
  ".graphql": "text/x-graphql",
  ".env": "text/plain",
  ".gitignore": "text/plain",
  ".dockerfile": "text/plain",
};

/** 文本 content-type 前缀 */
const TEXT_CONTENT_TYPES = [
  "text/",
  "application/json",
  "application/xml",
  "application/yaml",
];

/** BOM 标记 */
const BOM_UTF8 = Buffer.from([0xef, 0xbb, 0xbf]);
const BOM_UTF16_LE = Buffer.from([0xff, 0xfe]);
const BOM_UTF16_BE = Buffer.from([0xfe, 0xff]);

/**
 * 检测 buffer 是否为文本文件。
 * 优先级：扩展名 > content-type > BOM > 字节采样。
 */
export function detectTextFile(
  buffer: Buffer,
  fileName?: string,
  contentType?: string,
): TextDetectResult {
  // 1. 扩展名检测
  if (fileName) {
    const ext = extractExtension(fileName);
    const mime = TEXT_EXTENSIONS[ext];
    if (mime) return { isText: true, encoding: "utf-8", mime };
  }

  // 2. Content-Type 检测
  if (contentType) {
    const ct = contentType.split(";")[0].trim().toLowerCase();
    if (TEXT_CONTENT_TYPES.some((prefix) => ct.startsWith(prefix))) {
      return { isText: true, encoding: "utf-8", mime: ct };
    }
  }

  // 3. BOM 检测
  if (buffer.length >= 3 && buffer.subarray(0, 3).equals(BOM_UTF8)) {
    return { isText: true, encoding: "utf-8", mime: "text/plain" };
  }
  if (buffer.length >= 2) {
    if (buffer.subarray(0, 2).equals(BOM_UTF16_LE)) {
      return { isText: true, encoding: "utf-16le", mime: "text/plain" };
    }
    if (buffer.subarray(0, 2).equals(BOM_UTF16_BE)) {
      return { isText: true, encoding: "utf-16be", mime: "text/plain" };
    }
  }

  // 4. 字节采样检测 — 抽样前 8KB，检查是否存在 NUL 字节或大量非文本字节
  const sampleSize = Math.min(buffer.length, 8192);
  if (sampleSize === 0) return { isText: false };

  let nullCount = 0;
  let controlCount = 0;

  for (let i = 0; i < sampleSize; i++) {
    const byte = buffer[i];
    if (byte === 0x00) {
      nullCount++;
      // 发现 NUL 字节，极可能是二进制
      if (nullCount > 0) return { isText: false };
    }
    // 控制字符（除 tab/newline/carriage-return）
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) {
      controlCount++;
    }
  }

  // 控制字符超过 5% — 大概率是二进制
  if (controlCount / sampleSize > 0.05) return { isText: false };

  return { isText: true, encoding: "utf-8", mime: "text/plain" };
}

/**
 * 从文本 buffer 中提取预览内容。
 */
export function extractPreview(
  buffer: Buffer,
  encoding: BufferEncoding = "utf-8",
  maxLength = 4000,
): FilePreview {
  const text = buffer.toString(encoding);
  const truncated = text.length > maxLength;
  return {
    content: truncated ? text.slice(0, maxLength) : text,
    totalBytes: buffer.length,
    truncated,
  };
}

/**
 * 构建文件描述文本，供 AI agent 阅读。
 * 包含文件名、大小、预览内容。
 */
export function buildFileDescription(
  fileName: string | undefined,
  preview: FilePreview,
): string {
  const name = fileName ?? "未知文件";
  const sizeKB = (preview.totalBytes / 1024).toFixed(1);
  const header = `[文件: ${name} (${sizeKB} KB)]`;
  // 转义预览内容中的 [[wechat_ 指令模式，防止注入
  const safeContent = escapeDirectivePatterns(preview.content);
  const truncNote = preview.truncated ? "\n... (内容已截断)" : "";
  return `${header}\n\`\`\`\n${safeContent}${truncNote}\n\`\`\``;
}

/**
 * 转义文本中的 [[wechat_ 模式，防止文件内容中的指令被解析。
 */
export function escapeDirectivePatterns(text: string): string {
  // 将 [[wechat_ 替换为 [​[wechat_（插入零宽空格打断指令匹配）
  return text.replace(/\[\[wechat_/g, "[\\[wechat_");
}

function extractExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot < 0) return "";
  return fileName.slice(lastDot).toLowerCase();
}
```

### 步骤 2：修改 `src/types.ts`

扩展 `WechatKfMessage` 的 `file` 字段：

```typescript
// 现有定义（第 63 行）:
file?: { media_id: string };

// 改为:
file?: { media_id: string; file_name?: string };
```

### 步骤 3：修改 `src/bot.ts` — `extractText` 增加文件名

```typescript
// 现有代码（第 121-122 行）:
case "file":
  return "[用户发送了一个文件]";

// 改为:
case "file": {
  const fileName = msg.file?.file_name;
  return fileName ? `[用户发送了一个文件: ${fileName}]` : "[用户发送了一个文件]";
}
```

### 步骤 4：修改 `src/bot.ts` — `dispatchMessage` 中增加文本检测

在 media 下载成功后（约第 498 行之后），增加文本文件检测逻辑：

```typescript
import {
  detectTextFile,
  extractPreview,
  buildFileDescription,
} from "./text-detect.js";

// 在 dispatchMessage 函数中，media 下载并保存之后：

// ── 文本文件检测 ──
// 对 file 类型消息，尝试检测是否为文本文件并提取预览
if (msg.msgtype === "file") {
  const fileName = msg.file?.file_name;
  const detection = detectTextFile(buffer, fileName, contentType);

  if (detection.isText) {
    const preview = extractPreview(
      buffer,
      (detection.encoding ?? "utf-8") as BufferEncoding,
    );
    const description = buildFileDescription(fileName, preview);
    // 替换 text 参数（原本是 "[用户发送了一个文件: xxx]"）
    text = description;
    log?.info(
      `${logTag(kfId)} text file detected: ${fileName} (${detection.mime})`,
    );

    // 更新 MIME 类型为实际检测的文本类型
    if (detection.mime) {
      mime = detection.mime;
    }
  }
}
```

注意：这要求 `dispatchMessage` 的 `text` 参数可被修改。当前签名中 `text` 是 `string` 参数，需改为 `let text` 或提前声明为变量。

具体修改方案：

```typescript
// dispatchMessage 签名不变，但内部声明可变变量：
async function dispatchMessage(
  ctx: BotContext,
  account: ResolvedWechatKfAccount,
  msg: WechatKfMessage,
  inputText: string, // 重命名参数
): Promise<void> {
  let text = inputText; // 允许文本检测时替换
  // ... 后续代码使用 text 变量 ...
}
```

### 步骤 5：改进文件 MIME 检测与文件名保留

在 `dispatchMessage` 的 media 下载部分（约第 490-496 行），利用 `file_name` 推断更准确的 MIME：

```typescript
// 现有代码:
file: ["application/octet-stream", `wechat_file_${msg.msgid}`],

// 改为:
file: (() => {
  const fn = msg.file?.file_name;
  const ext = fn ? extractExtension(fn) : "";
  const inferredMime = ext ? (MIME_BY_EXT[ext] ?? "application/octet-stream") : "application/octet-stream";
  const filename = fn ?? `wechat_file_${msg.msgid}`;
  return [inferredMime, filename] as [string, string];
})(),
```

或更简洁地在现有的 `staticMap` 之后追加 MIME 推断逻辑。

## 指令注入防护

### 风险

用户可能上传包含 `[[wechat_link:...]]` 等指令模式的文本文件，如果预览内容未转义，这些指令会被 `wechat-kf-directives.ts` 解析并执行，导致：

- 发送非预期的富文本卡片
- 触发小程序跳转
- 发送伪造的菜单消息

### 防护方案

`buildFileDescription` 中调用 `escapeDirectivePatterns` 对预览内容进行转义：

```typescript
// 将 [[wechat_ 替换为 [\[wechat_ ，打断指令匹配
export function escapeDirectivePatterns(text: string): string {
  return text.replace(/\[\[wechat_/g, "[\\[wechat_");
}
```

`wechat-kf-directives.ts` 的 regex 匹配 `[[wechat_` 开头，转义后的 `[\[wechat_` 不会被匹配。

### 额外防线

预览内容包裹在代码块（\`\`\`）中，agent 通常不会将代码块内容作为指令输出。但由于 agent 行为不可完全预测，转义是必要的硬防护。

## 边界情况

### 1. 无 file_name 字段

微信 API 可能在某些场景下不返回 `file_name`（如旧版本消息）。此时：

- `extractText` 退化为 `"[用户发送了一个文件]"`（与现有行为一致）
- `detectTextFile` 仅依赖 content-type 和字节采样
- 无扩展名可用时，字节采样仍能识别纯文本文件

### 2. 大文件

预览最多截取前 4000 字符（约 4KB 文本），不会导致 prompt 膨胀。`extractPreview` 的 `maxLength` 参数可配置。

### 3. 非 UTF-8 编码

- BOM 检测支持 UTF-16LE/UTF-16BE
- 无 BOM 的非 UTF-8 文本（如 GBK）：`buffer.toString("utf-8")` 会产生乱码，但不会崩溃
- 未来可扩展使用 `TextDecoder` 或 chardet 库，但当前零依赖约束下先支持 UTF-8

### 4. 二进制文件误判

字节采样的 NUL 检测 + 控制字符比例阈值（5%）能有效过滤绝大多数二进制文件（图片、PDF、压缩包、Office 文档均含大量 NUL 字节）。误判为文本的风险极低。

### 5. 空文件

`buffer.length === 0` 时 `detectTextFile` 返回 `{ isText: false }`，不生成预览。

### 6. 文件名含特殊字符

文件名直接展示在 `buildFileDescription` 的头部，不需要额外转义（不影响 markdown 解析，也不影响指令匹配）。

## 测试策略

### 新建 `src/text-detect.test.ts`

| 测试用例                           | 说明                                                                   |
| ---------------------------------- | ---------------------------------------------------------------------- |
| **扩展名检测**                     | `.txt` → text/plain, `.json` → application/json, `.py` → text/x-python |
| **未知扩展名**                     | `.xyz` → 退化到 content-type / 字节采样                                |
| **content-type 检测**              | `text/plain` → isText, `application/json` → isText                     |
| **BOM 检测**                       | UTF-8 BOM → isText, UTF-16LE BOM → isText                              |
| **纯 ASCII 文本**                  | 无 BOM、无扩展名的纯 ASCII → 字节采样判定为文本                        |
| **二进制文件**                     | 含 NUL 字节 → isText=false                                             |
| **控制字符多**                     | >5% 控制字符 → isText=false                                            |
| **空 buffer**                      | → isText=false                                                         |
| **extractPreview 截断**            | 超过 maxLength 时 truncated=true                                       |
| **extractPreview 完整**            | 短于 maxLength 时 truncated=false                                      |
| **buildFileDescription**           | 输出包含文件名、大小、代码块                                           |
| **escapeDirectivePatterns**        | `[[wechat_link:...]]` 被转义                                           |
| **escapeDirectivePatterns 无指令** | 普通文本不被修改                                                       |

### 扩展 `src/bot.test.ts`

| 测试用例                  | 说明                                                  |
| ------------------------- | ----------------------------------------------------- |
| **file 消息含 file_name** | extractText 返回含文件名的描述                        |
| **file 消息无 file_name** | extractText 返回原有占位符                            |
| **文本文件下载后检测**    | dispatchMessage 中 text 被替换为含预览的描述          |
| **二进制文件下载**        | text 保持原有占位符，MIME 为 octet-stream             |
| **文件 MIME 推断**        | .pdf 文件 → application/pdf, .csv → text/csv          |
| **指令注入防护**          | 含 `[[wechat_link:...]]` 的文件，预览内容中指令被转义 |

## 完整示例

### 用户发送 `report.csv` 文件

```
用户消息 (extractText):
  [用户发送了一个文件: report.csv]

下载后检测:
  detectTextFile(buffer, "report.csv") → { isText: true, mime: "text/csv" }

提取预览:
  extractPreview(buffer) → { content: "日期,销售额,利润\n2026-01-01,1000,200\n...", totalBytes: 2048, truncated: false }

最终传给 agent 的 text:
  [文件: report.csv (2.0 KB)]
```

日期,销售额,利润
2026-01-01,1000,200
2026-01-02,1500,350
...

```

保存的 media:
path: "inbound/wechat_file_xxx_report.csv", mime: "text/csv"
```

### 用户发送 `photo.zip` 文件

```
用户消息 (extractText):
  [用户发送了一个文件: photo.zip]

下载后检测:
  detectTextFile(buffer, "photo.zip") → { isText: false }

最终传给 agent 的 text:
  [用户发送了一个文件: photo.zip]  (保持不变)

保存的 media:
  path: "inbound/photo.zip", mime: "application/zip"
```
