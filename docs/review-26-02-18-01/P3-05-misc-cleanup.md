# P3-05: 杂项清理和小改进

## 来源

各层审查中的低优先级问题汇总

## 问题列表

### 1. extractText location 格式化（BL-L2）

**文件**: `bot.ts:56`

当前 `name` 和 `address` 都为空时输出 `"[位置: ]"`。

```typescript
// 改为
const detail = [name, address].filter(Boolean).join(" ");
return detail ? `[位置: ${detail}]` : "[位置]";
```

### 2. msgmenu 消息类型未处理（BL-L3）

**文件**: `bot.ts` extractText

添加 case 分支：

```typescript
case "msgmenu": {
  const menu = msg.msgmenu;
  const head = menu?.head_content ?? "";
  const items = Array.isArray(menu?.list)
    ? menu.list.map(item => item.content ?? item.id).join(", ")
    : "";
  return head ? `${head} [选项: ${items}]` : `[菜单消息: ${items}]`;
}
```

### 3. listAccountIds 返回 ["default"] 的语义（BL-L4）

**文件**: `accounts.ts:69-73`

记录 "default" 账户不可用于 API 调用的语义，或在 `resolveAccount` 中对 "default" 做显式处理。

### 4. saveCursor 每次 mkdir（BL-L6）

**文件**: `bot.ts:36-39`

添加 `dirCreated` 标志，首次后跳过 mkdir。（已包含在 P1-10 中）

### 5. Logger 类型统一（BL-L8）

**文件**: `bot.ts:23`, `monitor.ts:19`

统一定义 Logger 接口：

```typescript
interface Logger {
  info: (...args: any[]) => void;
  warn?: (...args: any[]) => void;
  error: (...args: any[]) => void;
}
```

### 6. MIME_MAP 使用 as const（API-L5）

**文件**: `api.ts:15-21`

```typescript
const MIME_MAP = {
  ".jpg": "image/jpeg",
  // ...
} as const satisfies Record<string, string>;
```

### 7. 媒体类型检测 detectMediaType 扩展名补全（PL-L7）

**文件**: `outbound.ts:14-20`

补充 `.webm`（video）、`.flac`（voice）、`.tif`/`.tiff`（image）。

与 `api.ts` 的 `MIME_MAP` 整合到一个共享映射中。

### 8. config resolveAllowFrom 冗余 map(String)（PI-L7）

**文件**: `channel.ts:75-78`

如已有类型保证是 `string[]`，可去除 `map(String)`。

### 9. meta 信息不一致（PI-L2）

`openclaw.plugin.json` 和 `channel.ts` 中的 `blurb` 文案不同，统一为一处。

### 10. inline code 还原缺少视觉标记（PL-L4）

```typescript
// 还原时添加方括号
result = result.replace(/\x00IC(\d+)\x00/g, (_m, idx) =>
  `\`${inlineCodes[Number(idx)] ?? ""}\``
);
```

## 验收标准

- [ ] 每项改动单独可验证
- [ ] `pnpm run typecheck` 通过
- [ ] `pnpm test` 通过
- [ ] 无功能退化

## 涉及文件

- `src/bot.ts` — location 格式化、msgmenu 分支
- `src/accounts.ts` — default 语义文档
- `src/monitor.ts` — Logger 类型
- `src/api.ts` — MIME_MAP as const
- `src/outbound.ts` — detectMediaType 扩展名
- `src/channel.ts` — resolveAllowFrom、meta
- `src/unicode-format.ts` — inline code 还原
