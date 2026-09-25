# activity-data-layer

## Goal

Rust 侧落地活动数据层（设计 §4/§5/§6）：activity.sqlite、写入管道、查询 API。父任务：`.trellis/tasks/09-23-implement-activity-collection`，权威规格 `folyn-activity-collection-design.md`。

## Requirements

- `apps/desktop/src-tauri/src/activity/` 新模块：`db.rs`（连接管理、§5 四张表建表+索引）、`ingest.rs`（§4.2 pushEvents / getCursor / setCursor commands）、`pipeline.rs`（§4.3 校验→隐私过滤→append-only 去重→实体解析 lookup-or-create→关系写入→限流）、`query.rs`（§6 listEvents / aggregateMetrics / getEntityNeighbors 一跳 + score=event_count×exp(-天数/14) / getDailyDigestInput / getEventSummary 读写 ai_summary 缓存）
- task 状态物化到 `entities.metadata_json`（§4.4），事件表不可变只追加
- DB 文件：vault 内 `activity.sqlite`（单 vault 一份，与笔记索引库分开）
- 纯 Rust 单测覆盖：去重 insert-ignore、实体 lookup-or-create 幂等、固定关系映射写出、邻居时间加权排序、ongoingTasks 排期窗口过滤

## Acceptance Criteria

- [ ] `cargo test` 通过上述单测
- [ ] 通过 Tauri commands 可完成 push → query 全链路（含游标推进、重启不重复）
- [ ] 一次性事件 insert-ignore；task 状态变更追加新事件且 metadata_json 投影正确

## Out of Scope

- 贡献点、采集器、UI（子任务 2/3）
- AI 摘要实际生成逻辑（本层只做 ai_summary 字段读写）

## Technical Notes

- rusqlite 0.40 (bundled) 已在 Cargo.toml
- 限流：单次 pushEvents batch 上限 + 超频节流，常量即可
- 隐私过滤/脱敏正则规则由设置传入（§8），本层只留接口
