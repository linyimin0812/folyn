# HTML image mode toggle refactor

## Goal

把"存储与分享"settings tab 底部的"HTML 内图片处理"选项按钮（inline / upload）当前样式重写。当前问题：

- 按钮行缺少外层容器（应有 segmented-control 的 `border border-brd2 rounded-md overflow-hidden` 包裹），按钮间还有 `gap-2` 把它们拆开，看着像两个独立按钮而非一个控件
- 按钮内文案过长（"Inline 为 data URI（单文件自包含）"），塞进按钮后换行，丑
- 缺少当前选中模式的简短说明——用户得猜选中后的行为

## Requirements

- 用 segmented-control 模式（沿用 codebase 的 ImagePasteDialog format selector 范式：`flex border border-brd2 rounded-md overflow-hidden` + 按钮 `flex-1 py-1.5 px-3.5 border-r border-r-brd2 last:border-r-0`，active 用 `bg-acc text-white font-semibold`，inactive 用 `bg-surf text-t2 hover:bg-hov hover:text-t1`）
- 按钮文案短化：`inline` → "Inline"，`upload` → "Upload"；原先的长文案拆成 `inlineDesc` / `uploadDesc`，作为 segmented control 下方的描述行显示，跟 `htmlImageMode` 当前值动态绑定
- 保留上方 label + help，间距按 `pt-5` 与上面一组控件拉开

## Out of Scope

- 不改 i18n key 命名（保留 `htmlImageMode.inline` / `htmlImageMode.upload` 作为按钮文案，新增 `.inlineDesc` / `.uploadDesc` 平级 key）
- 不动 R2 / Qiniu 表单的 Field 样式
- 不动 provider `<select>`

## Technical Notes

- 改动文件：
  - `apps/desktop/src/components/settings/StorageSharingSettings.tsx` — JSX 重写按钮组
  - `apps/desktop/src/i18n/locales/en/settings.json` + `zh/settings.json` — 短化按钮文案 + 新增 desc
- 复用模式参考：`apps/desktop/src/components/editor/ImagePasteDialog.tsx` 的 format selector
