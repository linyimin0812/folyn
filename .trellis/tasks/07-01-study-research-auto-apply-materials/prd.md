# 学习研究自动写入资料

## Goal
"AI 找资料"动作完成后，把 AI 产出的资料清单**自动写入**主题文档 `## 资料` 段，不再以建议卡片形式要求用户逐条"加入/忽略"。

## Background
- 现状：`runResearch` → `beginSuggestion('research')` → AI 聊天产出 → `consumeSuggestion` 解析为 `suggestedMaterials` 建议卡片 → 用户逐条 `acceptMaterialSuggestion` 才写盘。
- 用户诉求："找好资料后自动更新资料，不要询问"。

## Decision
- `consumeSuggestion` 在 research 分支：解析建议后直接 `autoApplyMaterialSuggestions`（去重 + append）写回 `## 资料`，`suggestedMaterials` 恒为空，不再产卡片。
- 去重键：`(url || title)` 小写，与已有资料重复则跳过。
- plan 分支保持建议卡片流程不变（计划仍需人工取舍）。
- UI：移除 `StudyMaterialsSection` 的资料建议卡片块及相关 props；"AI 找资料"按钮保留，结果直接出现在资料列表。

## Requirements
- research 产出 → 自动 append 到 `## 资料`（去重）。
- 无资料/无主题时安全 no-op，`pendingSuggestion` 仍清零。
- 不破坏 plan 建议、SQ3R、手动 CRUD 等既有流程。
