# 根因：单位错配（逻辑点 vs 物理像素）

## 诊断方法
加了临时 Rust 命令 `pet_debug_log`（追加到 `appDataDir/pet-debug.log`）+ JS helper `petDebug.ts`，在 PetApp 启动 effect 和 800ms 轮询的关键节点写日志（绕过 pet 窗口 devtools 难开的问题）。

## 诊断日志结论（无任何抛错）
```
workArea = {x:0, y:30, width:1680, height:953}   # 来自 Rust pet_get_work_area
petPositionX/Y = 1552 / 816                       # source: "saved"
resolved = {x:1552, y:816}
set_pet_position ok
outerPosition after set = {1552, 816}             # 与 expected 一致
outerPosition AFTER show = {1552, 816}            # show() 没有重置位置
```
所有调用成功，pet 被稳定设置在物理坐标 (1552, 816)。**没有抛错、没有 hidden-window set_position 不生效问题、没有 capability 缺失问题。**

## 根因
屏幕是 **Retina**（`system_profiler`: 2560×1600 Retina，scaled 1680×1050，`backingScaleFactor`=2）。

- `pet_get_work_area` 返回 `NSScreen.visibleFrame` = **逻辑点**（1680×953）
- `set_pet_position` 接收 `PhysicalPosition` = **物理像素**
- `outerPosition()` 返回 **物理像素**
- `PET_WINDOW_SIZE=120`、`PET_RIGHT_MARGIN=8`、`PET_BOTTOM_MARGIN=48`、`PET_PANEL_WIDTH=380`、`PET_PANEL_HEIGHT=520`、`PET_PANEL_GAP=8` 都是**逻辑**值（对应 tauri.conf 的逻辑尺寸）

`computeDefaultPetPosition` 用逻辑点算 `x = 1680-120-8 = 1552`（逻辑空间正确右下角），**直接**当物理像素传给 `set_pet_position`。2× Retina 下：物理 1552 = 逻辑 776 → 水平中心；物理 816 = 逻辑 408 → 垂直中心。**pet 落在屏幕中间。**

`petPosition.ts` 头部注释（6-11 行）声称"全程物理像素，workArea 来自 `monitor.size`（物理）"——但实际实现用 Rust `pet_get_work_area`（逻辑点），**违反自述的单位契约**。

## 修复方案（逻辑空间做数学 + 边界单位转换）
数学本身在逻辑空间是正确的，只缺边界转换。`petPosition.ts` 的数学函数**不用改**（它们在逻辑空间本就正确：workArea 逻辑、常量逻辑）。

### Rust
1. `PetWorkArea` struct 增加 `scale_factor: f64`
2. `pet_get_work_area` 返回 `[[screen backingScaleFactor] doubleValue]`（workArea 仍返回逻辑点，不变）

### JS（PetApp.tsx / PetPanelApp.tsx）
3. 调 `set_pet_position` / `setPosition` 前：`物理 = 逻辑 × scaleFactor`
4. 读 `outerPosition()` / `probe.window_x/y` 后：`逻辑 = 物理 ÷ scaleFactor`
5. 保存的位置（`setPetPosition`）改为存**逻辑**值（显示器分辨率无关）
6. 面板位置 `computePanelPosition` 同样：probe 位置 ÷ sf 转逻辑 → 计算 → 结果 × sf 调 `pet_panel_set_position`

### 迁移
7. 加 storage version key（如 `petPosVersion`）。旧版保存的物理坐标重置 `petPositionX/Y = -1`（强制走新默认值；旧值本身是错的）。面板位置同理。

### 清理
8. 修完移除诊断代码：`pet_debug_log` Rust 命令 + 注册 + `petDebug.ts` + PetApp.tsx 里的所有 `petDebug(...)` 调用 + `import { petDebug }`

## 涉及文件
- `apps/desktop/src-tauri/src/commands.rs`（PetWorkArea struct + pet_get_work_area + 移除 pet_debug_log）
- `apps/desktop/src-tauri/src/lib.rs`（移除 pet_debug_log 注册）
- `apps/desktop/src/components/pet/petPosition.ts`（数学函数不改，但头部注释要修正单位契约描述）
- `apps/desktop/src/components/pet/PetApp.tsx`（边界转换 + 迁移 + 移除诊断）
- `apps/desktop/src/components/pet/PetPanelApp.tsx`（面板位置边界转换）
- `apps/desktop/src/components/pet/petDebug.ts`（删除）
- `apps/desktop/src/store/settingsStore.ts`（迁移 version key）

## 验收
- 首次启动（saved=-1）pet 在右下角偏上（逻辑 y≈785，物理 y≈1570）
- 拖动后重启，pet 恢复拖动后位置
- 面板在 pet 上方/下方正确弹出，不偏移
- 诊断代码全部移除，`pet-debug.log` 不再生成
- `tsc --noEmit` + `cargo check` 通过
