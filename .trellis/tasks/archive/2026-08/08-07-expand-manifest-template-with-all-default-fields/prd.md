# 扩充 manifest 模板字段

## 目标

`packages/create-folyn-plugin/template/manifest.json` 列出所有可选字段的默认值，让插件作者打开模板即见完整 surface，按需填充。

## 范围

- 字段集 = `PluginManifest`（packages/plugin-sdk/src/types.ts）全部字段
- 默认值规则：字符串 `""`，数组 `[]`，布尔 `false`，对象用其字段默认值递归
- 必填字段（id/name/version/tier/main）保留占位符
- 不引入 JSONC 注释（host 走 JSON parse，注释会破解析）
- 不改 `validateManifest`：模板仍须通过校验

## 验收

- 模板 manifest 经 `validateManifest()` 不报错
- 在 monorepo 内 scaffold 一个新 plugin，`pnpm typecheck` + `pnpm build` 通过
