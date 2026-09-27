# isTauri() 运行环境分支收敛（观察项处置）

## Goal

架构报告观察项：isTauri() 被 47 个非测试文件直接调用、160 处分支，评估是否收敛为平台能力层。

## What I already know（代码勘察）

* **isTauri() 是硬编码 `return true`**（utils/platform.ts:2，注释 "Always true for desktop-only builds"）——应用为 desktop-only，**web 运行时不存在**。
* "平台能力层"的前提不成立：没有双运行时需要抽象。报告原话是"尚未成灾，若继续增长应收敛"——但增长上限也只是更多死分支。
* 调用分布（非测试，~160 处 / 46 文件）：
  - 113 处 `if (!isTauri()) return;` 守卫 → 恒为 no-op 的死守卫
  - ~15 处 `if (isTauri()) { A } else { B }` / 三元 → else 支死代码（WebViewer、attachments、extensionStore 等 web fallback 路径）
  - ~10 处 UI 禁用态 `disabled={!isTauri()}`、title 文案 → 恒 false / 恒 true
* 测试现状：`vite dev`（浏览器裸跑）是唯一非 Tauri 运行时，但 isTauri() 在其中也返回 true → 守卫已不保护任何环境。
* 3 个测试文件 mock isTauri：
  - attachments.test.ts（toggle true/false，测 web fallback 保存路径）
  - createExtensionApi.test.ts（mock **false**，测 "non-Tauri runtime" 路径原样返回）
  - editorIoService.test.ts（mock true）
  - 这些 mock false 的用例测的是生产中不可能到达的死路径。

## Assumptions (temporary)

* 删除死守卫零行为变化（isTauri() 恒 true 已在生产与未 mock 的测试中生效）。

## Decision (ADR-lite)

**Context**: 架构报告观察项建议"若继续增长收敛为平台能力层"；勘察发现 isTauri() 硬编码 true，无双运行时。
**Decision**: 保留不动（用户 2026-09-27 拍板）。
**Consequences**: 零风险零成本；160 处死分支作为已知噪音接受。isTauri() 恒 true 已封死增长上限，不构成腐化趋势。若未来真的引入 web 构建，届时这些分支反而是现成的起点。不新增抽象、不删除。

## Requirements

* 无代码改动。观察项处置完毕：确认不构成腐化，无需收敛。

## Acceptance Criteria

* [x] 勘察结论记录（isTauri 恒 true、160 处死分支、无双运行时）
* [x] 用户决策：保留不动

## Out of Scope

* 不新增"平台能力层"抽象（无双运行时，YAGNI）。
* 不动 isPetPanelWindow()（真实的多窗口分支，非运行环境分支）。

## Technical Notes

* 关键文件：utils/platform.ts、store/extensionStore.ts、components/pet/PetPanelApp.tsx（13 处）、components/pet/PetMenuApp.tsx（7 处）、file-types/web/WebViewer.tsx（5 处+ else 分）。
* 风险点：删 else 支时需连带删除只被死分支调用的辅助函数；mock false 的测试用例随之删除或改写。
