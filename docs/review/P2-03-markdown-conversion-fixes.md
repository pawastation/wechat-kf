# P2-03: Markdown→Unicode 转换修复与增强

## 来源

Presentation 审查 H3、H4、H5、M2、M3

## 问题描述

`unicode-format.ts` 的 Markdown 转换存在多个问题：

### 1. 多行粗体/斜体不支持（H3）
`.+?` 不匹配换行，跨行的 `**bold\ntext**` 不会被转换。

### 2. 标题处理顺序问题（H4）
标题转换在粗体/斜体之后执行，`# Hello *italic*` 中 italic 先被转为 Unicode 斜体，然后标题对 Hello 应用粗体，但斜体部分不会被转为粗体（因为已是非 ASCII 字符）。

### 3. 无序列表 `*` 与斜体冲突（H5）
`* first item *` 可能被斜体正则匹配，消除列表标记。

### 4. 代码块还原缺少视觉标记（M2）
代码块内容被提取后直接还原，与普通文本无法区分。

### 5. 多种 Markdown 语法未处理（M3）
- 图片 `![alt](url)` — 被链接正则错误匹配为 `!alt (url)`
- 任务列表 `- [ ] / - [x]` — 未处理
- 表格 — 未处理
- 转义字符 `\*` `\_` — 未处理

## 目标

修复已知的转换顺序和正则冲突问题，补充常见 Markdown 语法支持。

## 具体改动

### 1. 调整处理顺序

建议顺序：
1. 代码块保护（已有）
2. inline code 保护（已有）
3. **图片语法**（新增，在链接之前）
4. **转义字符保护**（新增）
5. **标题转换**（移到粗体/斜体之前）
6. 粗体/斜体
7. 删除线
8. **列表转换**（移到斜体之后）
9. 链接
10. 引用
11. 水平线
12. 还原占位符

### 2. 新增图片语法处理

```typescript
// 在链接处理之前
result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "[$1]($2)");
```

### 3. 新增任务列表处理

```typescript
result = result.replace(/^[ \t]*-\s+\[x\]\s+/gm, "\u2611 ");
result = result.replace(/^[ \t]*-\s+\[ \]\s+/gm, "\u2610 ");
```

### 4. 代码块还原增加视觉标记

```typescript
result = result.replace(/\x00CB(\d+)\x00/g, (_m, idx) => {
  const code = codeBlocks[Number(idx)] ?? "";
  return `\n━━━ code ━━━\n${code}\n━━━━━━━━━━━━\n`;
});
```

### 5. 标题处理移至粗体之前

提取标题行内容，先去除内联 Markdown 标记，再应用粗体：

```typescript
// 标题处理（在粗体/斜体之前）
result = result.replace(/^(#{1,6})\s+(.+)$/gm, (_m, hashes, content) => {
  // content 中可能还有 ** 或 * 标记，先不处理
  return toBold(content);
});
// 然后再处理剩余的粗体/斜体
```

## 验收标准

- [ ] `# Hello *world*` 全部输出为粗体
- [ ] `* item one\n* item two` 正确转为列表，不被斜体捕获
- [ ] `![alt](url)` 转为 `[alt](url)` 而非 `!alt (url)`
- [ ] `- [x] done` 转为 `\u2611 done`
- [ ] 代码块还原带有视觉分隔标记
- [ ] 现有 `unicode-format.test.ts` 全部通过
- [ ] 新增测试覆盖上述所有场景
- [ ] 不引入新的正则回溯风险（大文本测试）

## 涉及文件

- `src/unicode-format.ts` — 修改转换逻辑
- `src/unicode-format.test.ts` — 新增测试用例
