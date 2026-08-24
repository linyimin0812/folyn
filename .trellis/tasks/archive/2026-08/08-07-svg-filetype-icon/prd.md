# SVG file type: dedicated icon

## Goal

让 folyn 的 `svg` 文件类型用专属 `assets/icons/svg.svg` 图标，而非现在的通用 `image` 图标。

**Why**: 现状 `apps/desktop/src/components/file-types/svg/index.ts:8` 调 `getFileTypeIcon('image')`，落进 `HANDLER_TO_THEME_ICON['image']` → `'image'` theme icon。`ThemeIcon` 已通过 `import.meta.glob('../../assets/icons/*.svg')` 自动注册了 `svg.svg` 为名 `'svg'`，但没人引用。两行改动即可切到专属图标。

## Requirements

- `apps/desktop/src/components/file-types/svg/index.ts:8`: `getFileTypeIcon('image')` → `getFileTypeIcon('svg')`。
- `apps/desktop/src/components/icons/FileIcon.tsx` `HANDLER_TO_THEME_ICON`（约 89 行）加 `svg: 'svg',`。

## Acceptance Criteria

- [ ] `.svg` 文件在文件树 / tab 上显示 `assets/icons/svg.svg` 图标（蓝底 + "SVG" 字样）。
- [ ] 其他文件类型的图标不变。
- [ ] `pnpm --filter desktop typecheck` 绿。

## Out of Scope

- 改 `EXT_TO_THEME_ICON['svg']`（fallback for unregistered handlers；svg handler 已注册，无需动）。
- 加 `_dark` 变体（`svg.svg` 单文件，无 dark 版；沿用现状）。
- 其他 file-type 图标调整。

## Technical Notes

- `ThemeIcon.tsx` 的 `import.meta.glob` eager 加载所有 `assets/icons/*.svg`，按文件名（去 `.svg`）注册；`svg.svg` → 名 `'svg'`。
- `getFileTypeIcon(handlerId)` 流程：先查 excalidraw/web/clip 特例；再查 `HANDLER_TO_THEME_ICON[handlerId]`；命中且 `hasIcon(name)` 则返回 `<ThemeIcon name>`；否则 fallback `documentation`。
- ponytail：两行改动，正则表/无新抽象。
