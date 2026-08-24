# 桌宠启动位置居中而非右下角默认值

## 现象
桌宠图标启动后显示在屏幕正中，而非预期的"右下角偏上"默认位置（`computeDefaultPetPosition`）。

## 复现
- `pnpm tauri dev`（debug 构建，2026-07-07 00:55）
- pet 窗口启动后 mascot 渲染在屏幕中心
- 期望：`computeDefaultPetPosition` → `x = width-120-8, y = height-120-48`（右下角偏上）

## 排查证据（已确认）
1. 代码最新（今天构建），非旧二进制
2. 磁盘 `petPositionX/Y = -1`（`storage.json`）→ 启动应走"右下角默认"分支（`PetApp.tsx:371-379`）
3. `tauri.conf.json` pet 窗口 `visible:false + center:true` 无 x/y → 无人显式定位时按 conf 默认居中
4. `set_pet_position` / `pet_get_work_area` 已注册（`lib.rs:325,329`）；`isTauri()` 恒 true（`platform.ts`）
5. storage.json 在会话中被写过（01:36），但 `petPositionX/Y` 仍 `-1` → 800ms 轮询（`PetApp.tsx:265-303`）从未成功落盘

## 关键矛盾 → 根因假设
轮询 effect 每 800ms 读 `getCurrentWindow().outerPosition()` 调 `setPetPosition`（会落盘）。若 PetApp 正常运行且 pet 居中，第一拍就该把居中坐标写回磁盘。磁盘始终 `-1` → **轮询从未成功执行 `setPetPosition`**，即 `outerPosition()` 或位置相关 `invoke` 在每次 tick 都抛错被 `try/catch`（`PetApp.tsx:284` / `417`）静默吞掉。

mascot 能渲染 → PetApp 已挂载；但所有位置相关调用静默失败 → 窗口留在 conf 默认居中位置。日志只在 pet 窗口 devtools（终端看不到），且 pet 窗口 120×120 透明 `focus:false` 右键被自定义菜单接管，无法常规开 devtools。

## 计划
### Phase 1：临时文件诊断（先做）
在 PetApp 关键节点把状态写到 `~/Library/Application Support/com.folyn.editor/pet-debug.log`（绕过 console），精确定位哪一步抛错：
- mount 时间戳
- `pet_get_work_area` 返回值 / 是否抛错
- `computeDefaultPetPosition` 计算结果
- `set_pet_position` invoke 是否成功 / 抛错内容
- `outerPosition()` 实际返回值
- `show()` 前后位置变化
- 轮询每 tick 的 `outerPosition()` + 是否调 `setPetPosition`

每行带时间戳。诊断代码标记为临时，定位后移除。

### Phase 2：根据诊断结果修复
候选根因与对应修法：
- **A. set_position 在 hidden 窗口不生效**（`PetApp.tsx:138-147` 注释已述）→ 在 `show()` 之后重新 `set_pet_position`（对齐 panel 的 `PetApp.tsx:147` 模式）
- **B. pet capability 缺 `core:window:allow-set-position`** → 补权限（影响 JS fallback `setPosition()`）
- **C. 某个 invoke/outerPosition 权限或初始化问题** → 据诊断错误信息修

## 验收
- [ ] 诊断日志能定位到具体抛错点
- [ ] 修复后首次启动（saved=-1）pet 显示在右下角偏上
- [ ] 拖动后重启，pet 恢复到拖动后的位置（saved 分支）
- [ ] 诊断代码移除
