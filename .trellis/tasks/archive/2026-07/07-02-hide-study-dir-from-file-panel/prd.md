# fix: hide __study__ (and other built-in dirs) from file panel for existing users

## Goal

修复老用户文件面板仍显示 `__study__` 等内置目录的问题：回填逻辑只以 `__wiki__` 为哨兵，已含 `__wiki__` 但缺 `__study__`/`__schedule__`/`__analyze__` 的持久化设置不会补齐。

## What I already know

- `settingsStore.ts:152` 默认 `excludePatterns` 已含全部 7 个内置目录（`__wiki__`/`__clips__`/`__reports__`/`__daily__`/`__study__`/`__schedule__`/`__analyze__`）。
- `settingsStore.ts:305` 回填：`if (saved.excludePatterns && !saved.excludePatterns.includes('__wiki__'))` 才补齐全部。哨兵是 `__wiki__`——老用户若 saved 含 `__wiki__` 但缺后加的 `__study__` 等，回填不触发 → 这些目录显示在文件面板。
- `vaultStore.ts:285-303` 用 `excludePatterns` 过滤 fileTree（`matchesAnyPattern`，精确名或 `*`/`?` glob）。

## Requirements

- 回填改为逐个补齐：对每个内置目录，若 `saved.excludePatterns` 不含则追加（不再以单一哨兵门控）。
- 不改变用户自定义的其它 pattern，不重复追加已存在的。
- 7 个内置目录：`__wiki__`/`__clips__`/`__reports__`/`__daily__`/`__study__`/`__schedule__`/`__analyze__`。

## Acceptance Criteria

- [ ] 持久化 settings 含 `__wiki__` 但缺 `__study__` 时，加载后 `__study__` 被补进 excludePatterns → 文件面板不显示 `__study__`。
- [ ] 已含全部内置目录的 settings 不被重复追加。
- [ ] 用户自定义 pattern 保留。
- [ ] 单测覆盖"部分缺失 → 补齐"、"全有 → 不变"。
- [ ] tsc + vitest 绿。

## Definition of Done

- tsc / vitest 绿；扩展 settingsStore 单测。
- 不改默认值、不改 vaultStore 过滤逻辑。

## Technical Approach

- `settingsStore.ts` 回填块改为：`const BUILTIN_DIRS = ['__wiki__','__clips__','__reports__','__daily__','__study__','__schedule__','__analyze__']; const existing = saved.excludePatterns ? saved.excludePatterns.split('\n').map(s=>s.trim()).filter(Boolean) : []; const missing = BUILTIN_DIRS.filter(d => !existing.includes(d)); if (missing.length) saved.excludePatterns = [...existing, ...missing].join('\n');`
- 仅当 `saved.excludePatterns` 存在时执行（与现状一致；为空则用默认值路径）。

## Out of Scope

- 不改默认 excludePatterns。
- 不改 vaultStore 过滤实现。
- 不做 settings 迁移之外的 UI 改动。

## Technical Notes

- 受影响文件：`apps/desktop/src/store/settingsStore.ts`（回填块 ~305 行）+ 其测试。
