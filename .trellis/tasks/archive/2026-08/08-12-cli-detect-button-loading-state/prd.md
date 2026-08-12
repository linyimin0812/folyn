# CLI detect button loading state

## Goal

CliSettings 的 detect 按钮当前点击后无视觉反馈，用户不知道在检测中（detect 现在会跑 dscl + 用户 shell + which，比之前慢）。加一个 loading 图标 + 禁用按钮，跟 Test 按钮的 `st.testing` pattern 对齐。

## What I already know

- detect 按钮：`apps/desktop/src/components/settings/CliSettings.tsx:103-124`，当前无 loading state
- Test 按钮：同文件 `:125-146`，已有 `st.testing` + `disabled` + label 切换的 pattern（`useState<Record<string, TestStatus>>`）
- `TestStatus = { testing: boolean; result?: {...} }`，detect 复用同一个 record 即可（加 `detecting?: boolean` 字段）
- 已有的 spinner pattern：
  - `<Loader2 size={13} className="animate-spin" />`（lucide-react，ModelPickerModal.tsx:152 用过）
  - CSS-only `<span className="... rounded-full border-... animate-spin" />`（ClipsPanel/AnalysisPanel 用过）

## Requirements

- detect 按钮点击后立即显示 loading 图标，禁用按钮，防止重复点击
- detect 完成（成功或失败）后恢复可点击状态
- 不影响 Test 按钮（Test 按钮已有自己的 testing state）
- 不引入新的 i18n key（detect 期间只显示 spinner，label 不变；或与 Test 一致切换到"检测中..."文案，需新增 i18n key）

## Acceptance Criteria

- [ ] detect 按钮点击后立即显示 spinner，按钮 disabled
- [ ] detect 完成（成功/失败/catch）后 spinner 消失，按钮重新可点击
- [ ] detect 进行中再次点击不重复触发
- [ ] Test 按钮行为不变

## Definition of Done

- 实现细节匹配现有 pattern（TestStatus 字段或独立 state，按 ponytail 选最简）
- lint / typecheck / build green
- 用户手动验证：点 detect → 看 spinner → 完成恢复

## Out of Scope

- detect 失败时的错误提示 UI（Q4 决策：失败不写 cliPaths，input 框不变；本 task 不加失败提示）
- Test 按钮的 loading 改动
- 其他 settings 页面的 loading 一致性审计

## Technical Approach

最简方案：在现有 `TestStatus` 类型上加 `detecting?: boolean` 字段，复用 `testStatus` state（已经是 `Record<string, TestStatus>`，keyed by adapter id）。

- detect onClick 开始：`setTestStatus((s) => ({ ...s, [a.id]: { ...(s[a.id] ?? { testing: false }), detecting: true } }))`
- try/finally：finally 里 `setTestStatus((s) => ({ ...s, [a.id]: { ...s[a.id], detecting: false } }))`
- detect 按钮 `disabled={sf === 'creating' ? false : (testStatus[a.id]?.detecting ?? false)}`，label 内条件渲染 `<Loader2 size={13} className="animate-spin" />` 替换或前置

或者更懒：独立 `useState<Record<string, boolean>>` 跟踪 detecting，跟 testing 解耦。两条路都行，按 ponytail 选独立 state（解耦更清晰，不污染 TestStatus 形状）。

## Implementation Plan

1. `CliSettings.tsx`：加 `detecting` state + detect 按钮 `disabled` + spinner
2. lint / typecheck / test
3. 用户手动验证
