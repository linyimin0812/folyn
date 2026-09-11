# Fix DBML ER preview positions lost on reopen

## Goal

DBML ER preview 拖动卡片后保存，重新打开文件时位置恢复成默认 d3-force 布局。本任务修复加载路径的 meta 块 seeding bug，让保存的位置在重开时正确还原。

## Root cause

`extensions/dbml/src/view/ErDiagramX6.tsx` 的 parse effect（约 L667-719）有一个 one-shot seeding guard `hasSeededFromMetaRef`：

```ts
if (!hasSeededFromMetaRef.current) {
  hasSeededFromMetaRef.current = true;   // ← bug：无论有没有 meta 都置 true
  if (meta) {
    manualPositionsRef.current = new Map(...);
    ...
  }
}
```

`DbmlPreview` 的 `content` 初始值是 `useState<string>('')`。挂载流程：

1. ErDiagramX6 挂载，content=`''`。parse effect 首次运行 → `hasSeededFromMetaRef.current=true`（但 meta 为 undefined，没东西 seed）。
2. iframe READY → host post OPEN → setContent(真实文件内容) → content prop 变化 → parse effect 再次运行。
3. 此时 `hasSeededFromMetaRef.current` 已是 true → **seeding 块被整体跳过** → `manualPositionsRef` 保持空 → `layoutEr(schema, w, h, manualPositionsRef.current)` 跑全新 d3-force → 位置丢失。

## Fix

`extensions/dbml/src/view/ErDiagramX6.tsx` parse effect 中，把 seeding guard 改成只在确有 meta 时才标记为已 seed：

```ts
if (!hasSeededFromMetaRef.current && meta) {
  hasSeededFromMetaRef.current = true;
  manualPositionsRef.current = new Map(
    Object.entries(meta.positions).map(([name, p]) => [name, { x: p.x, y: p.y } as Point]),
  );
  if (meta.view?.showGrid) setShowGrid(true);
  if (meta.view?.zoomPct) {
    const z = meta.view.zoomPct;
    const safe = z >= 25 && z <= 200 ? z : null;
    if (safe != null) {
      setZoomPct(safe);
      restoreZoomRef.current = safe;
    }
  }
}
```

效果：
- 首次 content=`''`（无 meta）→ flag 保持 false，等真实内容到达再 seed。
- 真实带 meta 的内容到达 → flag 置 true，seed 位置。
- 后续内容变化（拖动产生的 meta-only 更新会被 `dbml === lastCompletedDbmlRef.current` 早退 skip；用户键入的 dbml 文本变化到达时 flag 已 true，不再 re-seed，**不引入 clobber 风险**）。

## Acceptance Criteria

* [ ] 给一个带 `<!-- dbml:meta\npositions: {...}\n-->` 注释块的 .dbml 文件，重新打开后 ER 卡片出现在保存位置（非 d3-force 默认布局）。
* [ ] 不带 meta 块的 .dbml 文件打开后行为不变（d3-force 默认布局）。
* [ ] 拖动卡片后位置仍实时写回（meta emit 管线不变）。
* [ ] 拖动→保存→关闭→重开：位置还原。
* [ ] 键入 dbml 文本修改时不会 clobber manualPositionsRef（不退化原有 guard 意图）。

## Definition of Done

* 修改 `extensions/dbml/src/view/ErDiagramX6.tsx` 一处 seeding guard。
* 手动验证上述 AC。
* `pnpm --filter dbml build` 通过。

## Out of Scope

* 改动 `extractDbmlMeta` / `withDbmlMeta` / meta 块格式。
* 新增持久化字段（注释、颜色等）。
* 改动 host 侧 `setContentExternal` / `updateTabContent` / 保存管线。
* 自动保存（拖动后自动落盘）— 不在本任务范围。

## Technical Notes

* Bug 文件：`extensions/dbml/src/view/ErDiagramX6.tsx` L671-690 区域。
* 相关 commit：`58027d8b` 在 drag→onChange 链路加了 console diagnostics（host 端和 iframe 端各一行 `[dbml] ... change (len)`）— 本次 bug 在加载路径，不在该链路。
* `layoutEr`（`erLayout.ts` L213-414）已正确处理 manualPositions：在 manualPositions 中的卡片走 `fixedPositions` + `fx/fy`，其余跑 simulation。bug 是 manualPositions 在加载时没被填充。
