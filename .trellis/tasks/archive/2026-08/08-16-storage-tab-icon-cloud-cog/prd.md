# Storage tab icon → CloudCog

## Goal

把"存储与分享"settings tab 的导航图标从 lucide `Cloud` 换成 `CloudCog`，区分"普通云存储"和"配置/管理云存储"的语义。

## Requirements

- `apps/desktop/src/components/settings/primitives.tsx` 的 NAV_GROUPS 中 `storage` 项的 icon 从 `<Cloud size={14} />` 换成 `<CloudCog size={14} />`
- imports 中 `Cloud` 仍保留（StorageSharingSettings.tsx 的 section header 还在用，不动）

## Out of Scope

- StorageSharingSettings.tsx section header 的 `<Cloud size={20} />` 不动
- 其他 tab 图标不动

## Technical Notes

- lucide-react 同时导出 `Cloud` 和 `CloudCog`
- 只改 primitives.tsx 一个文件
