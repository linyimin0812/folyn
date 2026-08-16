# Storage settings — provider selector → dropdown

## Goal

把"存储与分享"settings tab 顶部 "服务提供商" 那一行按钮（图标+标签+状态徽章）改为单个 `<select>` 下拉框。configured/notConfigured 状态用一个小徽章附在下拉框右边，或并到 option 文本里。

## Reason

按钮行只在 2 个 provider 时占空间合理，后续接 SM.MS/Imgur/OSS/COS 几家时，按钮行会爆宽或换行。下拉框线性可扩展。

## Requirements

- 把 `StorageSharingSettings.tsx` 中的 `providers.map(button)` 块替换为 `<select>` + 配套 `<label>`
- `<select>` 切换 `activeProvider`，option 文本包含 provider label + "（未配置）" 后缀（未配置时）
- configured 状态仍可见——可以在 select 右边放一个小徽章，或者直接在 option 文本里带
- 保持 i18n（label 走 `t(p.labelKey)`，徽章走 `t('settings:storage.provider.configured' / 'notConfigured')`）

## Out of Scope

- 表单字段的改动
- provider 列表本身的变化

## Technical Notes

- 唯一改动文件：`apps/desktop/src/components/settings/StorageSharingSettings.tsx`
- 复用现有 QiniuForm 里的 `<select>` 样式作为视觉参考
