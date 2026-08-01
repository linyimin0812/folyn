# Make the Git panel self-explanatory

## Goal

The Git panel triggered from the Activity Bar (GitHub icon) currently reads as a developer tool — title says "Git 操作", status block dumps raw `git status --short` output, section labels quote command-line strings (`git pull`, `commit + push -u origin HEAD`). A user opening it should understand within 2 seconds *what this dialog does* and *which button to press when*. This task rewrites copy + status rendering + adds one-line action hints so the panel is self-explanatory without dumbing it down for power users.

## What I already know

- `apps/desktop/src/components/git/GitPanel.tsx:22-160` — the panel. Modal via `dlg-overlay` (ponytail: reuses existing dialog CSS, side-popover deferred).
- Triggered from `apps/desktop/src/components/shell/ActivityBar.tsx:123-133` — only renders for `providerType === 'github'` vaults.
- `apps/desktop/src/services/gitService.ts:148-151` — `getStatus` returns the raw stdout of `git status --short` (or `'(clean)'`).
- `git status --short` line format: two-char XY status code + space + path. Common codes: ` M` modified-not-staged, `M ` staged, `A ` added, `D ` deleted, `R ` renamed, `??` untracked, `UU` conflict.
- No i18n in the panel today — Chinese inline strings. Keep that style.

## Decision (ADR-lite)

**Context**: Raw `git status --short` is readable to a developer but not to the vault user who just clicked the GitHub icon. The command-name labels reinforce "this is a Git CLI wrapper" rather than "this syncs your notes".
**Decision**: Parse the status output in-panel (no backend change) into a plain-language summary + categorized list. Rewrite labels to describe the *action* and *when to use it*, not the underlying command. Keep the modal as-is (no layout rewrite, no side-popover).
**Consequences**: One parsing helper added to `GitPanel.tsx` (or a tiny co-located util). No service-layer change. Raw output still reachable via a disclosure toggle so power users don't lose it.

## Requirements

- Title communicates intent: "同步「{vault name}」到 GitHub" instead of "Git 操作 — {name}".
- Status block shows a one-line summary: "✓ 工作区干净" or "N 个文件有改动" + breakdown by category (修改 / 新增 / 删除 / 未跟踪 / 冲突).
- Below the summary, a compact list of changed files with a per-file status badge in plain language.
- Raw `git status --short` output retained behind a "显示原始输出" disclosure — power-user escape hatch, default collapsed.
- Section labels drop the command-name parenthetical; replaced with a one-line hint describing *when* to use the action:
  - Pull section: "拉取远程更新" + hint "把 GitHub 上的最新改动下载到本地仓库。"
  - Commit & Push section: "提交并推送" + hint "把本地改动上传到 GitHub。需先填写提交信息。"
- No new dependencies. No new CSS classes (reuse `dlg-*`, `btn-*`).
- No layout change beyond tighter spacing and the new summary/list region.

## Acceptance Criteria

- [ ] Opening the panel on a clean repo shows "✓ 工作区干净" and no file list.
- [ ] Opening on a repo with mixed changes shows the summary line with correct counts per category, and the file list with plain-language badges.
- [ ] "显示原始输出" toggle expands to show the verbatim `git status --short` output.
- [ ] Pull / Commit & Push section labels no longer contain `git pull` / `commit + push -u origin HEAD` strings.
- [ ] Each action section has a one-line hint under the label.
- [ ] Pull, Commit & Push, Refresh still work (no behavior regression).
- [ ] Lint + typecheck green.

## Definition of Done

- Manual check in dev server: clean repo + dirty repo (mixed ` M`, `??`, `A `, `D `).
- Lint + typecheck green.
- Commit on `master` (no PR — solo dev flow).

## Out of Scope (explicit)

- Replacing the modal with a side-popover / side panel (ponytail: deferred — needs new panel infra).
- i18n wiring (panel uses inline Chinese today; not changing the convention here).
- Backend / `gitService.ts` changes — parsing stays in the panel.
- Persistent collapse state for the raw-output disclosure.

## Technical Approach

Single file change: `apps/desktop/src/components/git/GitPanel.tsx`.

Add a pure parser `parseGitStatus(raw: string)` returning:
```ts
interface ParsedStatus {
  clean: boolean;
  counts: { modified: number; added: number; deleted: number; untracked: number; conflict: number };
  files: { path: string; label: string }[];
  raw: string;
}
```
Mapping (XY → category):
- `??` → 未跟踪 (untracked)
- `A ` / `A?` → 新增 (added)
- `D ` / ` D` → 删除 (deleted)
- `R ` / `C ` → 重命名 (renamed) — collapse into "修改" for the count, label "重命名"
- ` M` / `MM` / `M ` → 修改 (modified)
- `UU` / `AA` / `DU` etc. (both-modified family) → 冲突 (conflict)

Render order in the body:
1. Summary line (with category breakdown chips).
2. File list (max-height: 200, overflow auto — same as current `<pre>`).
3. Disclosure toggle "显示原始输出" → expands the existing `<pre>` with raw output.
4. Refresh button (unchanged).
5. Pull section (label + hint + button).
6. Commit & Push section (label + hint + input + button).

Inline test (ponytail: one runnable check, no framework):
```ts
// ponytail: self-check — run with `npx tsx`/node --import tsx if curious.
// Kept as a comment block so production doesn't ship the runner.
function demo() {
  const out = parseGitStatus(' M src/a.ts\n?? new.txt\nA  b.md\n');
  assert(out.counts.modified === 1 && out.counts.untracked === 1 && out.counts.added === 1);
  assert(!out.clean);
  assert(parseGitStatus('').clean);
}
```

## Technical Notes

- `apps/desktop/src/components/git/GitPanel.tsx` (parser + UI rewrite, single-file scope)
- `apps/desktop/src/services/gitService.ts:148` (`getStatus` — read-only reference, no change)
- `apps/desktop/src/components/shell/ActivityBar.tsx:123-133` (trigger — no change)
