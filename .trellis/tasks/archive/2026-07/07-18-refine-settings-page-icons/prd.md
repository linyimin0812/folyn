# refine-settings-page-icons

## Goal

将设置页的 emoji 图标替换为统一、精致的 lucide-react 线性图标，提升视觉一致性和专业感。

## Requirements

* 新增 `lucide-react` 依赖
* 替换 `NAV_GROUPS` 的 11 个导航 emoji（primitives.tsx）
* 替换 `SettingsPage.tsx` 中关于/说明区的 6 个 emoji：💡 🏠 🔓 ✦ 📋 🔄
* 替换 `PluginsSettings.tsx` 的 ⚠️ 警告 emoji
* 保留 `VoiceSettings.tsx` 描述正文里的 🎤（文本内容，非 UI 图标）
* 图标尺寸与导航项占位一致（约 14×14px），亮色/暗色主题都清晰
- 图标用 `currentColor` 跟随文字色

## 图标映射

| 来源 emoji | lucide 图标 | 用途 |
|---|---|---|
| 🖥 | Monitor | 外观 |
| ✏️ | SquarePen | 编辑器 |
| ⌨️ | Keyboard | 快捷键 |
| 📄 | FileText | 文件模板 |
| 🐾 | PawPrint | 桌宠 |
| 🔔 | Bell | 通知 |
| 🧩 | Puzzle | 插件 |
| ✦ (nav) | Sparkles | AI 工具 |
| 🎤 (nav) | Mic | 语音输入 |
| ⚡ | Zap | Skills |
| ℹ️ | Info | 关于 |
| 💡 | Lightbulb | 使用说明 |
| 🏠 | Home | 本地优先 |
| 🔓 | Unlock | 开放格式 |
| ✦ (about card) | Sparkles | AI 辅助 |
| 📋 | ClipboardCopy | 复制版本信息 |
| 🔄 | RefreshCw | 检查更新 |
| ⚠️ | TriangleAlert | 可信插件警告 |

## Acceptance Criteria

* [ ] 上述 18 处 emoji 全部替换为对应 lucide 图标
* [ ] 图标在亮色/暗色主题下显示正常
* [ ] 导航项无布局回归
* [ ] `pnpm build` 通过

## Definition of Done

* 截图对比 before/after
* lint / typecheck / build 通过
* 无布局回归

## Technical Approach

* `pnpm add lucide-react`（在 `apps/desktop`）
* `primitives.tsx`：`NAV_GROUPS` 的 `icon` 字段类型从 `string` 改为 `ReactNode`，直接渲染 `<Monitor size={14} />` 等
* `SettingsPage.tsx` / `PluginsSettings.tsx`：导入对应 lucide 组件，替换 emoji `<div>`/文本
* 沿用现有 inline SVG 的尺寸规范（14px 导航 / 17px 卡片），通过 `size` prop 控制

## Out of Scope

* 设置页之外的 emoji（PetChat / PetContextMenu 等他处）
* `VoiceSettings.tsx` 描述正文中的 🎤 字符（文本内容）
* 图标交互/动画

## Technical Notes

* `NAV_GROUPS` 定义：`apps/desktop/src/components/settings/primitives.tsx:18-35`
* 关于区 emoji：`apps/desktop/src/components/pages/SettingsPage.tsx:325, 473-477`
* ⚠️ 警告：`apps/desktop/src/components/settings/PluginsSettings.tsx:198`
* 现有 inline SVG 模式参考：`SettingsPage.tsx:106-108`
