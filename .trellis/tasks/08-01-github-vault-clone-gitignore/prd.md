# GitHub vault clone 后同步 .gitignore 忽略隐藏目录

## Goal

GitHub 类型 vault 在 `git clone` 后，应用自动创建 `__wiki__/`、`__clips__/`、`__schedule__/`、`__study__/`、`__analyze__/` 等内置受管目录。这些目录属于本地工作区产物，不应回写到用户远端仓库。

两件事：
1. **自动**：clone 完成后，把 `BUILTIN_EXCLUDE_DIRS` 自动追加到克隆仓库根的 `.gitignore`（保留已有内容）。
2. **手动**：在「同步 GitHub」弹窗（`GitPanel`）的改动文件列表里，对匹配 `excludePatterns` 的行显示「加入 .gitignore」按钮，点击追加该 pattern 并刷新状态。

## Requirements

* `prepareGithubVault` 在 `cloneRepo` 成功后，调用 `ensureGitignoreEntries(absPath, BUILTIN_EXCLUDE_DIRS)`，向仓库根 `.gitignore` 追加缺失的内置目录条目。
* 重新添加已克隆仓库（跳过 clone 路径）时不触发自动写入。
* `GitPanel` 改动文件列表中：对每个文件用 `findMatchedPattern(path, excludePatterns)` 计算；命中则在该行末尾显示「加入 .gitignore」按钮。
* 点击按钮 → `ensureGitignoreEntries(absPath, [matchedPattern])` → 刷新 git 状态 + 刷新文件树；按钮在 busy 期间禁用。
* `findMatchedPattern`：扫描路径每段（按 `/` 切），返回首个匹配 `excludePatterns` 的 pattern 字符串；通配 pattern 透传。
* `.gitignore` 合并语义：行级去重、保留已有内容（含注释行）、只在缺失时追加。

## Acceptance Criteria

* [ ] `mergeGitignoreEntries('', ['__wiki__', '__clips__'])` 返回内容含 `__wiki__` 与 `__clips__`。
* [ ] `mergeGitignoreEntries('__wiki__\n# comment\n', ['__wiki__'])` 返回 `{ changed: false, content: '__wiki__\n# comment\n' }`。
* [ ] `mergeGitignoreEntries('node_modules\n', ['*.log', '__wiki__'])` 返回 changed=true 且内容追加 `*.log` 与 `__wiki__`。
* [ ] `findMatchedPattern('__wiki__/sub/foo.md', ['__wiki__'])` 返回 `'__wiki__'`。
* [ ] `findMatchedPattern('app.log', ['*.log'])` 返回 `'*.log'`。
* [ ] `findMatchedPattern('README.md', ['__wiki__'])` 返回 `null`。
* [ ] 新克隆的 GitHub vault 根目录存在 `.gitignore` 且含 7 个 `__xxx__` 目录。
* [ ] 已有 `.gitignore` 内容完整保留。
* [ ] `GitPanel` 中匹配 `excludePatterns` 的改动行末尾出现「加入 .gitignore」按钮；不匹配的行不显示按钮。
* [ ] 点击按钮后该行（及同 pattern 下其他行）从改动列表消失，因 git 不再跟踪。

## Definition of Done

* 新增 `apps/desktop/src/utils/excludePattern.ts` 与单测 `excludePattern.test.ts`。
* `gitService.ts` 新增 `ensureGitignoreEntries` 薄壳；`gitService.test.ts` 复用 `mergeGitignoreEntries` 测试（不测 IO 壳）。
* `vaultStore.ts` 删除内联 `patternToRegExp`/`matchesAnyPattern`，改 import；`prepareGithubVault` 追加 ensureGitignore 调用。
* `GitPanel.tsx` 接入按钮逻辑。
* i18n zh/en `shell.json` gitPanel 增 `addToGitignore` / `gitignoreAdded`。
* lint / typecheck / vitest 通过；不破坏 `vaultStore.test.ts` / `settingsPersistence.test.ts`。

## Technical Approach

### 文件清单

* **NEW** `apps/desktop/src/utils/excludePattern.ts`（纯函数，无 IO）
  * `patternToRegExp(pattern)`：从 vaultStore 平移。
  * `matchesAnyPattern(name, patterns)`：从 vaultStore 平移。
  * `findMatchedPattern(filePath, patterns)`：按 `/` 切段，逐段调 `matchesAnyPattern`，返回首个命中 pattern 字符串；无命中返回 `null`。
  * `mergeGitignoreEntries(existing, entries)`：纯函数，返回 `{ changed: boolean; content: string }`。逻辑：把 `existing` 按行 split + trim，过滤空与 `#` 开头注释作为 "have" 集合（注释行原样保留，不参与去重判断）；对 `entries` 中不在 "have" 的，append 到尾部，每条占一行。无新增 → `changed=false`，原内容原样返回。
* **NEW** `apps/desktop/src/utils/excludePattern.test.ts`
  * 覆盖 Acceptance Criteria 中所有纯函数断言。
* **MODIFY** `apps/desktop/src/store/vaultStore.ts`
  * 删 `patternToRegExp` (64-71) 与 `matchesAnyPattern` (74-81) 内联定义，从 `@/utils/excludePattern` import。
  * `prepareGithubVault` 在 `await cloneRepo(...)` 之后、return 之前，调用 `ensureGitignoreEntries(absPath, BUILTIN_EXCLUDE_DIRS)`（从 `@/store/appearanceStore` import `BUILTIN_EXCLUDE_DIRS`，从 `@/services/gitService` import `ensureGitignoreEntries`）。失败用 `console.warn` 不抛错（clone 本身已成功，不应让 .gitignore 失败阻塞 vault 创建）。
* **MODIFY** `apps/desktop/src/services/gitService.ts`
  * 新增 `ensureGitignoreEntries(targetPath, entries): Promise<void>`：用 `@tauri-apps/plugin-fs` `readTextFile` 读 `.gitignore`（catch = ''），调 `mergeGitignoreEntries`，`changed=true` 时 `writeTextFile` 覆盖写回。`join` 用 `@tauri-apps/api/path`。
* **MODIFY** `apps/desktop/src/components/git/GitPanel.tsx`
  * 顶部加 `useAppearanceStore` selector 取 `excludePatterns`，按 `\n` split、trim、过滤空与 `#` 开头得 patterns。
  * 文件行渲染处计算 `matchedPattern = findMatchedPattern(f.path, patterns)`；命中时行末加按钮（小尺寸，复用 `btn btn-sm` 类）。
  * 按钮 onClick：`await ensureGitignoreEntries(absPath, [matchedPattern])` → `await refreshStatus()` → `await refreshFileTree()` → toast `gitignoreAdded`。
  * busy 期间禁用按钮；点击中显示禁用态。
* **MODIFY** `apps/desktop/src/i18n/locales/{zh,en}/shell.json`
  * `gitPanel` 增加 `addToGitignore`、`gitignoreAdded`。

### 关键决策

* **同步范围 = `BUILTIN_EXCLUDE_DIRS`**：clone 时只追加 7 个内置目录，不污染用户仓库与笔记无关的 `node_modules` 等。
* **手动按钮 = 单 pattern 追加**：点击即把命中的 pattern 字符串追加到 `.gitignore`。这样同 pattern 下所有文件都会被 git 忽略，自然从改动列表消失。
* **失败容忍**：clone 后 ensureGitignore 失败只 warn，不阻塞 vault 创建。
* **IO 与纯函数分离**：`mergeGitignoreEntries` 纯函数可测；`ensureGitignoreEntries` 薄壳不测。

## Decision (ADR-lite)

**Context**: 用户克隆的 GitHub 仓库可能自带 `.gitignore`；内置目录需自动忽略；用户也可能想手动忽略某些匹配 excludePatterns 的改动文件。

**Decision**: Approach A（仅 BUILTIN_EXCLUDE_DIRS 自动同步）+ Approach B（GitPanel 中仅匹配 excludePatterns 的行显示按钮，追加该 pattern）。

**Consequences**:
- 用户在设置里自定义的隐藏 pattern 不会自动进 .gitignore，但可通过 GitPanel 按钮手动追加。
- clone 时一次性快照，不监听设置后续编辑回写。
- 同 pattern 多文件场景：点一次按钮即清空该 pattern 下所有改动行（git 行为天然如此）。

## Out of Scope

* 不监听 `excludePatterns` 后续编辑并回写到已克隆仓库。
* 不为 tauri/local provider 写 `.gitignore`（不是 git 仓库）。
* 不修改远端仓库（push）。
* 不在「重新添加已克隆仓库」路径触发自动写入。

## Technical Notes

* 入口函数：`prepareGithubVault` @ `apps/desktop/src/store/vaultStore.ts:39-62`。
* `BUILTIN_EXCLUDE_DIRS` @ `apps/desktop/src/store/appearanceStore.ts:11-19`，line 185 已 export。
* `useAppearanceStore.getState().excludePatterns` 是文件面板隐藏真值。
* `GitPanel` @ `apps/desktop/src/components/git/GitPanel.tsx`，parsed.files 来自 `parseGitStatus`。
* 现有 `gitService.test.ts` 只测纯 builder；`excludePattern.test.ts` 同风格。
