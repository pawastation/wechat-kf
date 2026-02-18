# P3-03: 构建产物优化和包导出配置

## 来源

Plugin Interface 审查 L3、L4、L5

## 问题描述

### 1. 编译输出包含测试文件（L4）

`dist/src/` 中包含 `*.test.js` 和 `*.test.d.ts`，因为 `tsconfig.json` 没有排除 `*.test.ts`。这些文件会被发布到 npm。

### 2. package.json 缺少 main/exports（L3）

没有 `main`、`exports`、`types` 字段指明入口。OpenClaw 通过 `openclaw.extensions` 指向 `./index.ts`（TypeScript 源文件），但标准 npm 消费者找不到入口。

### 3. 公共 API 表面偏大（L5）

导出了底层 API（`encrypt`、`decrypt`、`sendTextMessage`、`getAccessToken` 等），未来重构需维护向后兼容。

## 目标

优化构建产物，明确包入口，控制公共 API 表面。

## 具体改动

### 1. tsconfig.json 排除测试文件

```json
{
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

### 2. package.json 添加导出配置

```json
{
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./crypto": {
      "types": "./dist/src/crypto.d.ts",
      "import": "./dist/src/crypto.js"
    },
    "./api": {
      "types": "./dist/src/api.d.ts",
      "import": "./dist/src/api.js"
    }
  }
}
```

### 3. 考虑精简主入口导出

主入口 (`index.ts`) 只导出插件对象。底层工具通过 subpath export 提供（如 `wechat-kf/crypto`）。

## 验收标准

- [ ] `pnpm run build` 后 `dist/` 中不包含 `*.test.js` 和 `*.test.d.ts`
- [ ] `package.json` 有 `main`、`types`、`exports` 字段
- [ ] `require("wechat-kf")` 和 `import ... from "wechat-kf"` 能正确解析
- [ ] `pnpm run typecheck` 通过

## 涉及文件

- `tsconfig.json` — 添加 exclude
- `package.json` — 添加 main/types/exports
- `index.ts` — 可选：精简导出
