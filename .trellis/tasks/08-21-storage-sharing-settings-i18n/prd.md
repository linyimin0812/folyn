# 存储与分享设置页 i18n

## Goal

让 `apps/desktop/src/components/settings/StorageSharingSettings.tsx` 在 zh/en/ja/es/de/fr 全部 locale 下都显示完整翻译，而不是回退到 zh。

## What I already know

组件本体**已经**大量用 `t('settings:storage.*')`，但有 3 处硬编码：
- `apps/desktop/src/components/settings/StorageSharingSettings.tsx:189` — `Cloudflare R2` 表单标题
- `apps/desktop/src/components/settings/StorageSharingSettings.tsx:290` — `七牛云 Kodo` 表单标题
- `apps/desktop/src/components/settings/StorageSharingSettings.tsx:379` — `阿里云 OSS` 表单标题

七牛 region 下拉选项（行 304-308）硬编码英文：`z0 (East China)` 等 5 条。

locale 端现状：
- `apps/desktop/src/i18n/locales/{zh,en}/settings.json` 已有完整 `storage` namespace
- `apps/desktop/src/i18n/locales/{ja,es,de,fr}/settings.json` **完全缺失** `storage` namespace → ja/es/de/fr 用户当前回退到 zh

`settings:storage.provider.{r2,qiniu,oss}.label` 这些 key 在 zh/en 已存在，但组件没有用——直接 hardcode 了。

## Requirements

1. **ja/es/de/fr 补齐 `storage` namespace**：以 en 为蓝本翻译，6 个 locale key 树对齐 zh/en。
2. **zh/en 增加 `storage.qiniu.regionOption.{z0,z1,z2,na0,as0}`**：region 下拉文案 key 化；ja/es/de/fr 一并补齐。
3. **组件接线**：
   - 3 处表单标题改用 `t('settings:storage.provider.{r2,qiniu,oss}.label')`
   - 5 条 region option 改用 `t('settings:storage.qiniu.regionOption.<id>')`
4. 不动：placeholder（`https://...`、`images/` 等技术示例）、`Cloudflare R2` 这种纯品牌名（但 zh/en 的 `provider.r2.label` 值就是 `Cloudflare R2`，照搬即可）。

## Acceptance Criteria

- [ ] `extracted-namespaces.test.ts` 仍然通过（zh/en key 树一致）
- [ ] 切换到 ja/es/de/fr 任一语言，存储与分享页所有可见文案（含 3 处表单标题、region 下拉、CORS 复制按钮、toast、Hint 列表）都不再出现中文回退
- [ ] 切换到 en，七牛表单标题显示 `Qiniu Kodo`（不是 `七牛云 Kodo`）

## Definition of Done

- zh/en/ja/es/de/fr 六个 `settings.json` 的 `storage` 子树 key 一致（不要求 ja/es/de/fr 通过 extracted-namespaces test，那个只检 zh/en）
- 组件无残留硬编码中文/英文用户可见文案
- 不跑全项目编译（per user feedback memory）

## Out of Scope

- 不动 `i18n/index.ts` 注册（复用 `settings` namespace）
- 不动 `extracted-namespaces.test.ts`（只检 zh/en，已足够）
- 不翻译技术 placeholder（`https://pub-xxx.r2.dev`、`cn-hangzhou` 等）
- 不动 `storageConfigStore` / `getAllProviders` 的 `labelKey` 机制（那是 provider select 用的，已工作）

## Technical Approach

单次 edit 批处理：
1. 用 Python 脚本批量给 ja/es/de/fr 的 `settings.json` 注入 `storage` 子树（手写翻译文本）
2. 给 zh/en 的 `storage.qiniu` 加 `regionOption` 子对象
3. 给 ja/es/de/fr 的 `storage.qiniu` 同步加 `regionOption`
4. 改组件 3 处表单标题 + 5 处 region option 为 `t()` 调用

## Technical Notes

- spec: `.trellis/spec/desktop/frontend/i18n-guidelines.md` — namespace prefix 强制、zh/en key 树对齐由 `extracted-namespaces.test.ts` 保证
- 前例参考：上一轮 WorkArea 空状态加 `shell:workArea.empty.*` 的 6-locale 同步做法
- `settings:storage.provider.{r2,qiniu,oss}.label` 已存在于 zh/en，ja/es/de/fr 需要补
