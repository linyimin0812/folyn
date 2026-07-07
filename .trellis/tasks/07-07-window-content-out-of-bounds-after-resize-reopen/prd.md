# Pet-panel size unit mismatch on resize → close → reopen

## Goal

桌宠 pet-panel 面板在 2x DPI（Retina）显示器上：用户调整面板大小 → 关闭 → 重新打开后，**部分面板跑到桌面外**（off-screen）。

两个相关 bug：

1. **Size 单位混用**（已修）：panel size 持久化用物理 px，`clampPanelSize` 拿它和逻辑 points 的 `workArea` / `PET_PANEL_MIN_*` 比较。Retina 2x 下窗口被错误裁剪。前一次提交已修复（persist ÷sf / restore ×sf）。
2. **Position clamp 用常量尺寸**（本任务修）：`clampPanelPosition`（petPosition.ts:211-220）用**硬编码常量** `PET_PANEL_WIDTH=380` / `PET_PANEL_HEIGHT=520` 计算 `maxX/maxY`，没用用户实际调整后的 panel size。用户把面板调大后 → 关闭 → 重开时，position 按默认 380×520 clamp，但实际窗口是更大的尺寸 → 右下角溢出 workArea 跑到桌面外。再加上 restore effect 里 position 先于 size 恢复（PetPanelApp.tsx:139-175），position clamp 时还没有 clamped size 可用。

根因：position clamp 与 size clamp 各自独立，没有把"实际 panel size"传给 position clamp；restore 顺序也倒了。

## What I already know

### 复现路径
1. Retina (2x DPI) 显示器，workArea 例如 1440×900 逻辑。
2. 用户拖边缘把 pet-panel 调整到 450×600 逻辑 = 900×1200 物理。
3. ~800ms 后 poll 持久化：`setPetPanelSize(900, 1200)`（settingsStore 存的是物理 px）。
4. 关闭面板（`pet_panel_hide`）。
5. 重新打开：PetPanelApp mount → restore effect（PetPanelApp.tsx:124-178）读 `petPanelWidth=900 / petPanelHeight=1200`。
6. `clampPanelSize({900, 1200}, workArea={1440, 900})`：
   - width = `min(max(900, 280), max(280, 1440)) = 900`
   - height = `min(max(1200, 360), max(360, 900)) = 900` ← **bug**：把 900 逻辑当成 900 物理
7. `pet_panel_set_size(900, 900)`（commands.rs:739-750 接收物理 px）→ 实际 450×450 逻辑。
8. 用户期望 450×600 逻辑，实际 450×450 逻辑 → 高度少 150px → 内容溢出。

### 关键代码
- `apps/desktop/src/components/pet/PetPanelApp.tsx:162-173` — restore：`clampPanelSize` 结果直接传 `pet_panel_set_size`，未做单位转换。
- `apps/desktop/src/components/pet/PetPanelApp.tsx:203-230` — persist poll：`pet_panel_get_size` 返回物理 px，÷sf **只对 position 做了**，size 直接 `Math.round` 存物理。
- `apps/desktop/src/components/pet/petPosition.ts:237-250` — `clampPanelSize`：参数签名说 `saved` 是物理 px，但内部 `Math.min/Math.max` 与 `workArea`（逻辑）、`PET_PANEL_MIN_*`（逻辑）混用。
- `apps/desktop/src-tauri/src/commands.rs:735-765` — `pet_panel_set_size` / `pet_panel_get_size` 都用 `PhysicalSize`，物理 px。
- 对比：`petPosition.ts:108-114` `clampPetPosition` 与 `clampPanelPosition:211-220` 都在**逻辑空间**运算（pet 窗口的 position 链路正确）。

### 历史背景
PetPanelApp.tsx:188-193 注释明确："Panel SIZE is stored/restored as-is (size-unit cleanup is a separate task)." —— 这个 task 就是来补 size 链路单位转换的。

## Decision (ADR-lite)

**Context**: size 链路要么全用物理、要么全用逻辑。位置链路已经选了"存逻辑、边界 ÷/× sf"，size 链路应当对齐。

**Decision**: 让 panel size **全程在逻辑空间运算**，与 position 链路一致：
1. **Persist**（PetPanelApp.tsx:215-216）：`pet_panel_get_size` 返回物理 px，**÷ `sf`** 转成逻辑再存 `settingsStore`。
2. **Restore**（PetPanelApp.tsx:162-173）：读到的 `petPanelWidth/Height` 现在是逻辑 points；`clampPanelSize` 接收逻辑 `saved`、与逻辑 `workArea` / `PET_PANEL_MIN_*` 比较（单位一致，运算正确）；结果 **× `sf`** 转物理再传 `pet_panel_set_size`。
3. **`clampPanelSize` 签名注释更新**：`saved` 与返回值都改为逻辑 points。
4. **`PetPanelSize` 接口注释更新**（petPosition.ts:222-227）：从 "physical px" 改为 "logical points"。

**Consequences**:
- 优点：单位与 position 链路统一，clamp 运算语义正确，2x DPI 不再裁剪。
- 优点：1x DPI 显示器上 ÷1 / ×1 无副作用，行为不变。
- 缺点：旧版本持久化的 `petPanelWidth/Height` 是物理 px；新版本读到的值会被当成逻辑 → 在 2x DPI 上首次恢复后面板会变成 2x 大小。**需要迁移**：读到旧值时按 `sf` ÷ 一次转成逻辑再存。或者：检测旧值（>some threshold）触发重新初始化为 -1。
- 风险：迁移逻辑要稳妥——读到的 saved size 如果明显大于 workArea（比如 2x 膨胀），用 `clampPanelSize` 裁回 workArea 即可，不会出问题（只是首次恢复尺寸不对，用户再调一次就好）。但更稳妥是显式迁移。

## Requirements

- R1 (persist): `pet_panel_get_size` 返回的物理 px 在写入 `settingsStore` 前要 **÷ `sf`** 转成逻辑 points。✅ 已完成
- R2 (restore): 从 `settingsStore` 读出的 size 是逻辑 points；`clampPanelSize` 在逻辑空间运算；调 `pet_panel_set_size` 前 **× `sf`** 转物理。✅ 已完成
- R3 (clamp): `clampPanelSize` 的 `saved` 参数与返回值都是逻辑 points；注释更新。✅ 已完成
- R4 (迁移): 旧版本持久化的物理 px 值由 `clampPanelSize` 自然兜底（min to workArea），不引入 schema 机制。✅ 已完成
- R5: 1x DPI 显示器行为不变（÷1 ×1）。✅ 已完成
- R6 (NEW): `clampPanelPosition` 接收**实际 panel size**（width/height），按实际尺寸计算 `maxX/maxY`，不再用硬编码常量 `PET_PANEL_WIDTH/PET_PANEL_HEIGHT`。
- R7 (NEW): restore effect 里**先**算出 clamped size，**再**用 clamped size 调 `clampPanelPosition`，最后依次 `set_size` / `set_position`（或并行 invoke 但 position clamp 要用 clamped size）。
- R8 (NEW): `computePanelPosition`（首次打开）继续用默认常量 `PET_PANEL_WIDTH/PET_PANEL_HEIGHT`——首次打开就是默认尺寸，没问题。
- R9 (NEW): 测试覆盖：用户把 panel 调大到 600×700，position 在 (workArea.right - 100, workArea.bottom - 100) → clamp 后整个 panel 要在 workArea 内。

## Acceptance Criteria

- [ ] Retina 显示器：调整面板到 450×600 逻辑 → 关闭 → 重开，面板尺寸为 450×600 逻辑，内容不溢出。✅ 已验证（单测）
- [ ] Retina 显示器：调整面板到超过 workArea（如 1500×1000 逻辑）→ 关闭 → 重开，`clampPanelSize` 裁剪到 workArea 内，内容不溢出。✅ 已验证（单测）
- [ ] **NEW**：调整面板变大（如 600×700）并拖到屏幕右下角 → 关闭 → 重开，整个面板都在 workArea 内，没有部分跑到桌面外。
- [ ] **NEW**：调整面板变大并拖到屏幕左上角 → 关闭 → 重开，面板完全在 workArea 内。
- [ ] 1x DPI 显示器：resize → close → reopen 行为不变。
- [ ] `petPosition.test.ts` 新增 position clamp 用实际 size 的单测。
- [ ] `pnpm typecheck`（`tsc -b`）通过。

## Definition of Done

- PetPanelApp.tsx persist/restore 两处加 ÷sf / ×sf。
- petPosition.ts `clampPanelSize` + `PetPanelSize` 接口注释更新为逻辑 points。
- petPosition.test.ts 加 2x DPI 单测。
- 手动在 Retina 桌宠面板验证 resize → close → reopen。
- tsc -b 绿。

## Out of Scope

- 不改 Rust 侧 `pet_panel_set_size` / `pet_panel_get_size`（继续物理 px，符合 Tauri PhysicalSize 约定）。
- 不改 tauri.conf.json 的 `minWidth`/`minHeight`（继续逻辑 points）。
- 不引入 settingsStore schema 版本机制（用 clamp 自然兜底，详见 R4）。
- 不动 pet 窗口（120×120）的尺寸链路（本就无 size 持久化）。
- 不动 pet position 链路（已正确）。

## Technical Notes

- 关键文件：
  - `apps/desktop/src/components/pet/PetPanelApp.tsx`（persist + restore effect）
  - `apps/desktop/src/components/pet/petPosition.ts`（`clampPanelSize` + `PetPanelSize` 注释）
  - `apps/desktop/src/components/pet/petPosition.test.ts`（加 2x DPI 单测）
- 迁移兜底（R4 简单方案）：旧版本物理 px 值在 2x DPI 上会变成 2x 逻辑大小，但 `clampPanelSize` 会 `Math.min(saved, workArea.width)` 把它裁回 workArea 逻辑尺寸——用户看到的是面板被裁到屏幕大小，而不是 2x 膨胀。可接受。1x DPI 上旧值与新值同单位，无影响。
- 不需要研究文件——单一单位转换 bug，纯算术修复。
