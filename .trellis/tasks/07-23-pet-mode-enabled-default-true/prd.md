# pet-mode-enabled-default-true

## Goal

`petStore.petModeEnabled` 默认值 `false` → `true`。用户观察到应用打开时「显示桌宠」toggle 显示 false 但桌宠图标仍可见（根因是 `PetApp` mount effect 无条件 `getCurrentWindow().show()`，本任务不修；仅按用户要求把默认值改为 true，让首次启动的 toggle 状态与实际可见性一致）。

## Requirements

- `apps/desktop/src/store/petStore.ts` 第 104 行 `petModeEnabled: false` → `petModeEnabled: true`。
- 不动 `PERSIST_KEYS_PET` 里的 `petModeEnabled`（仍然持久化）。
- 不动 hydrate 逻辑。

## Acceptance Criteria

- [ ] 首次启动（无持久化 state）toggle 显示「显示桌宠」为 ON。
- [ ] 已持久化为 false 的老用户：hydrate 后仍显示 OFF（默认值改动不影响已有持久化值）—— 这是预期，不在本任务范围。

## Out of Scope

- 修 `PetApp` mount effect 无条件 `show()` 的根因（用户未要求）。
- 迁移已持久化的 false 值。

## Technical Notes

- 已持久化 `petModeEnabled` 的老用户不受影响（hydrate 用持久化值覆盖默认值）。
- 改动只影响首次启动。
