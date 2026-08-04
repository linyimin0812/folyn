# 通知设置 - AI 生成弹窗模型下拉统一与白名单输入框 Compact 样式

## 背景

通知设置页（`NotificationsSettings.tsx`）中：

1. **AI 生成弹窗**（`BubbleTemplateAIChatModal`）头部的模型选择器当前用 `PairSelector` 的默认 `trigger="full"`（带 provider 图标+名称+模型 ID 的标签按钮），而 AI Panel 的 `ChatInput` 用的是 `trigger="icon"` 的紧凑方形图标按钮。两处入口视觉不一致。
2. **外部应用白名单**（`BubbleAppWhitelistBlock`）的输入框和"添加"按钮当前用 `flex gap-2` 排布，两者各自带圆角和边框，中间有空隙。用户希望改成 AntD `Space.Compact` 风格：输入框无右圆角、按钮无左圆角、中间无缝拼接、整体一个外圆角边框。

## 目标

- 弹窗头部模型下拉与 AI Panel 一致：使用 `trigger="icon"` 紧凑变体，保留 `onOpenSettings` 跳到「设置 > 模型」。
- 白名单输入框 + 添加按钮 Compact 拼接。

## 改动范围

### 1. `apps/desktop/src/components/settings/BubbleTemplateAIChatModal.tsx`

- 头部右侧 `PairSelector`：
  - 添加 `trigger="icon"`。
  - 添加 `onOpenSettings` —— 调用 `useNavStore` 跳到 `settings` 页 / `models` tab（复用 `ChatInput.tsx:205-208` 的同一模式）。
  - 移除 `className="max-w-[220px]"`（icon 变体是固定 28px，max-w 无意义）。
  - `dropDirection` 保持默认 `"down"`（弹窗头部在顶部，向下展开符合习惯；AI Panel 用 `"up"` 是因为它在聊天输入底部，场景不同）。
  - 头部布局可能需要微调：原 `PairSelector` 占据右侧较宽空间，改成 icon 后空间收缩，确认 `✕` 关闭按钮和 PairSelector 之间的间距仍协调（沿用现有 `gap-2`）。

### 2. `apps/desktop/src/components/settings/NotificationsSettings.tsx` — `BubbleAppWhitelistBlock`

- 输入框：去掉右侧圆角（`rounded-r-none`）+ 去掉右边框（避免双线）。
- 按钮：去掉左侧圆角（`rounded-l-none`），保留其余 btn 样式。
- 容器：`flex` 不带 `gap-2`，让两者直接贴合。
- 整体保持现有边框色 `border-brd`，视觉上是一个组件组。

## 非目标

- 不动 `PairSelector` 组件本身。
- 不动弹窗内的会话 `<select>`（那是会话切换，不是模型选择）。
- 不动白名单已添加项的 chip 样式。
- 不动其他设置页的同名组件。

## 验收

- 弹窗头部右侧模型按钮变成方形图标按钮，点击下拉出 provider/model 列表（与 AI Panel 一致）。
- 模型未配置时点击图标按钮，下拉里有「打开设置」入口，点击跳到「设置 > 模型」tab。
- 白名单输入框 + 添加按钮无缝拼接，中间无空隙、无双线，整体一个外圆角边框。

## 风险

- `trigger="icon"` 在弹窗头部可能比原 `full` 变体更不显眼，用户可能找不到模型切换入口。但这是用户明确要求的「和 AI Panel 一致」，AI Panel 也是这个形态。
- Compact 拼接如果按钮高度和输入框不一致会有错位。当前输入框 `py-1 text-[11px]`、按钮用 `btn btn-g btn-sm`，需要验证高度匹配；如果不匹配，调整输入框 padding 或按钮高度。
