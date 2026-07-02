# csv file icon (csv.svg / csv_dark.svg)

## Goal

CSV 文件使用 `csv.svg` / `csv_dark.svg` 图标（明暗主题），文件树与 tab 均显示 csv 图标。

## What I already know

- `assets/icons/csv.svg` + `csv_dark.svg` 已存在（各 587 字节）。
- `ThemeIcon.tsx` 用 `import.meta.glob('../../assets/icons/*.svg')` 自动加载 → `iconMap['csv'] = {light, dark}`。
- `FileIcon.tsx`：`EXT_TO_THEME_ICON`（按扩展名）+ `HANDLER_TO_THEME_ICON`（按 handler id）两张映射表 → `getFileTypeIcon`/`FileIcon`。
- `csv/index.ts` 当前 `icon: getFileTypeIcon('code')`（占位）。
- 两表均无 `csv` 条目 → 当前 csv 文件树显示 DefaultFileIcon、tab 显示 code 图标。

## Requirements

- `FileIcon.tsx`：`EXT_TO_THEME_ICON` 加 `csv: 'csv'`；`HANDLER_TO_THEME_ICON` 加 `csv: 'csv'`。
- `csv/index.ts`：`icon` 从 `getFileTypeIcon('code')` 改为 `getFileTypeIcon('csv')`。
- 不新增/不改 svg 文件（已存在）。

## Acceptance Criteria

- [ ] 文件树中 `.csv` 文件显示 csv 图标。
- [ ] csv tab 显示 csv 图标。
- [ ] 明暗主题切换图标跟随。
- [ ] tsc + vitest 绿。

## Out of Scope

- 不改 svg 文件内容。
- 不动其它图标映射。

## Technical Notes

- 改 `components/icons/FileIcon.tsx`（两表）+ `components/file-types/csv/index.ts`（一处 icon）。
