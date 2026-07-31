# Delete dead syncStore

## Goal

R3 告警暴露：`syncStore` 在生产代码里没有任何 import，`registerPersistSlice({ name: 'sync', ... })` 永远不跑，SLICES 永远缺 'sync'。同时没有任何 UI 读写 syncMethod / syncBucket / autoSync / e2eEncrypt（`grep -rln` components 目录零命中，i18n 只有一个无关的 "Model sync complete"）。syncStore 是为未来 sync 功能预埋的空壳，从未接线——保留只会让启动告警永久刷屏 + 误导后来人。

## Requirements

* 删除 `apps/desktop/src/store/syncStore.ts`、`apps/desktop/src/store/syncStore.test.ts`。
* 从 `apps/desktop/src/store/settingsPersistence.ts` 的 `EXPECTED_SLICES` 数组删 `'sync'`。
* 从 `apps/desktop/src/store/settingsPersistence.test.ts` 删 `useSyncStore` 的 import + `resetAllDefaults` 里的 `useSyncStore.setState` + 测试断言里所有 sync 字段（mutate→persist→reload 的 `setSyncBucket('rt-bucket')` + `syncBucket === 'rt-bucket'`；legacy blob fan-out 里的 `syncMethod/syncEndpoint/syncAccessKey/syncSecretKey/syncBucket/autoSync/e2eEncrypt` 字段 + 对应断言）。
* 删除已落到磁盘的孤儿文件 `~/.quill/storage/sync.json` 的清理路径不在此任务范围（用户可手动删，存储客户端下次启动不会复生）。

## Acceptance Criteria

* [ ] `apps/desktop/src/store/syncStore.ts` + `.test.ts` 不存在。
* [ ] `grep -rln syncStore apps/desktop/src` 仅命中可能的历史 archive 路径（生产代码 0 命中）。
* [ ] 启动控制台不再有 `[settingsPersistence] hydrate loop starting with unregistered slices: ['sync']` 告警。
* [ ] `pnpm -w run test -- --run settingsPersistence` 通过（除基线已存在的 36 个 pre-existing 失败外，无新增失败）。
* [ ] `npx tsc -b` 通过。

## Definition of Done

* 文件删干净，无悬挂 import。
* 测试同步更新，无残留断言。
* typecheck + 测试通过。
* commit message 说明 syncStore 从未接线 + R3 告警促成删除决策。

## Technical Approach

最小删除 diff。无新代码、无新依赖、无迁移逻辑——syncStore 从未 hydrate 过，磁盘上即便有 `sync.json` 也不会被读，安全删除。

## Out of Scope

* 磁盘上已存在的 `~/.quill/storage/sync.json` 清理（用户自行删，或下次 storage.ts 改动时扫一遍孤儿文件）。
* 重新设计 sync 功能（如果将来要做，从零开始，不复用此尸骸）。
* 其他 store 的死代码排查（本次只解决告警点名的 sync）。

## Technical Notes

* `apps/desktop/src/store/syncStore.ts:65` — 死的 registerPersistSlice 调用。
* `apps/desktop/src/store/settingsPersistence.ts` EXPECTED_SLICES 数组。
* `apps/desktop/src/store/settingsPersistence.test.ts` — sync 相关断言集中在 round-trip 和 legacy blob 两个 describe 块。
* 上一任务 commit `8e6de0e` 引入 EXPECTED_SLICES 告警，本任务是其第一次抓到真 bug 的清理。
