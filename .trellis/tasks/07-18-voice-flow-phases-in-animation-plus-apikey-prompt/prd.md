# Voice flow phases in animation + API key prompt

## Goal

让语音输入的整条流程在动效上可见 —— 录音中（当前特效）→ 转为文字 → LLM 优化，三个阶段在动画/UI 上有可区分的视觉表达；并在未配置 `chatApiKey` 时给用户明确提示，避免当前「静默跳过 polish、直接插入原始 transcript」的无声降级。

## What I already know

- `useVoiceInput.ts:172-175` 的 `shouldPolish` 三道闸：`autoPolish`（默认 true）+ `polishPrompt` 非空 + `chatApiKey` 非空。第三道默认空 → 静默跳过 polish 阶段。
- Phase 状态机已有 `'idle' | 'recording' | 'transcribing' | 'polishing' | 'inserting' | 'error'`（useVoiceInput.ts:18-24），底层状态已存在；当前是 UI 没把它区分开。
- 两条视觉路径：
  - **mic-button 路径**（`VoiceInputButton.tsx`）：recording → 红底白方块；`busy`（transcribing/polishing/inserting）→ 通用 spinner + title `"语音处理中…"`。三阶段被合并成一个 spinner。
  - **voice-orb 路径**（`VoiceOrbApp.tsx` + `SiriGL`）：recording → wave 模式（live mic RMS）；transcribing/polishing → orb 模式（speed 1.5, 思考点旋转）；inserting → orb + merging（六点收缩）。orb 窗口当前**纯动画无文字**。
- 跨窗口：orb 窗口与主窗口是独立 JS realm，phase 通过 `voice://orb-phase` 事件同步。
- 现有错误展示模式：`flashError` + 3s 自动清除 + 标题文字；权限类错误有「打开系统设置」内联链接（VoiceInputButton.tsx:161-184）—— 可作为 chatApiKey 提示的视觉先例。
- 无 app-wide toast 系统；`petNotifyDispatcher` 是给桌面宠的，不适用。

## Assumptions (temporary)

- 用户希望两条路径（button + orb）都有阶段区分，但 orb 路径是主战场（hotkey 跨应用场景最需要视觉反馈）。
- 「提示」chatApiKey 未配置 = 文字 + 一键跳转设置，而不是阻塞错误。
- 阶段视觉差异优先用最小手段：文字 label + 现有动画参数微调（speed/颜色/merging），不新增大型动画资产。

## Decision (ADR-lite)

**Context**: chatApiKey 默认空导致 polish 静默跳过；用户读不出当前阶段，也无从知道为何没优化。
**Decision**:
- chatApiKey 提示 = 内联文字 + 一键「打开设置」链接（方案 A），复用 permission link 视觉先例。
- orb 窗口破例加底部 caption 文字层（方案 A），承担阶段读出职责；button 路径用 title + caption 文字 + spinner 颜色区分。
- 状态机不引入「假 polishing」—— phase 仍 honesty 走 transcribing → inserting，但通过 `voice://orb-phase` payload 扩展一个 `polishSkippedReason: 'no-api-key' | null` 字段，让 UI 层渲染提示。
**Consequences**: orb 窗口从纯动画变成「动画 + 文字」，视觉风格破例但符合「在动效上显示」的原始诉求。新增 caption 层是 `pointerEvents:none` 的透明 div，不破坏 NSPanel 透明行为。

## Requirements

- 阶段区分：transcribing（转为文字）与 polishing（LLM 优化）在 button 和 orb 两条路径上都有可区分的视觉表达。
  - button 路径：title 文字分阶段（`语音转文字中…` / `LLM 优化中…` / `插入中…`）+ spinner 颜色/速度区分。
  - orb 路径：底部 caption 文字层 + SiriGL 参数已有区分（wave/orb/merging），可选微调 speed。
- chatApiKey 未配置且 `autoPolish=true` 时，给出可见提示（非静默跳过）：
  - 文案：「未配置 API Key，跳过 LLM 优化」+ 一键「打开设置」链接。
  - 在 button 和 orb 两条路径都渲染。
- 提示具备「前往设置」的一键跳转能力，跳转到 SettingsPage 的 AI 配置区。
- 不引入「假 polishing」状态：phase 状态机不变，通过扩展 `voice://orb-phase` payload 的 `polishSkippedReason` 字段传递提示信息。

## Acceptance Criteria

- [ ] recording → transcribing → polishing → inserting 四个 phase 在 button 路径上视觉可区分（title + spinner 颜色）。
- [ ] recording → transcribing → polishing → inserting 四个 phase 在 orb 路径上视觉可区分（caption 文字 + SiriGL 参数）。
- [ ] chatApiKey 为空时，button 和 orb 路径都显示「未配置 API Key」提示 + 「打开设置」链接。
- [ ] 点击「打开设置」跳转到 SettingsPage AI 配置区。
- [ ] 已配置 chatApiKey 时，原有润色流程不受影响（polishing 阶段正常进入并完成）。
- [ ] orb 窗口新增文字层不破坏 NSPanel 透明 + 不拦截 pointerEvents。

## Definition of Done

- Lint / typecheck / CI green
- 两条路径手测：mac 真机分别走 button 和 hotkey，观察四阶段视觉
- chatApiKey 空 / 非空 两态手测
- 不引入新依赖

## Out of Scope (explicit)

- Windows 平台支持（VoiceInputButton 已硬-disable）
- 重做 SiriGL shader 或新增动画资产
- App-wide toast 系统搭建
- Polish 失败（网络/API 错误）的重试 UI（已有 console 回退 raw，本次只改 chatApiKey 空的场景）

## Research Notes

### chatApiKey 提示的三种形式

- **A. 内联状态文字 + 一键跳转链接**（推荐）—— 沿用 permission link 先例（VoiceInputButton.tsx:161-184）。orb/button 下方显示「未配置 API Key，跳过 LLM 优化」，附「打开设置」链接。复用现有 `openSystemSettings` 风格 → 改成跳 AI 配置页。**Pros**: 视觉一致、可一键修复、无新组件。**Cons**: orb 窗口要新增文字层。
- **B. 短暂 error 闪烁**（3s 自清）—— 复用 `flashError('未配置 API Key，已使用原始文本')`。**Pros**: 改动最小（1 行）。**Cons**: 用户来不及点「前往设置」就消失了；与「跳过 polish 但仍插入文本」的非致命语义不匹配 error 红点。
- **C. polishing 阶段强制进入并显示「未配置」**—— phase 改成「shouldPolish=false 时仍走 polishing，但 polish 不实际调用 LLM，只展示提示」。**Pros**: 流程线性可见。**Cons**: 引入「假 polishing」状态，状态机语义变脏。

### 阶段视觉差异的最小手段

- button 路径：title 文字区分（「语音转文字中…」/「LLM 优化中…」/「插入中…」）+ spinner 颜色/速度区分（如 polishing 用 acc 色）。
- orb 路径：orb 窗口底部加一行 caption 文字（460×180 容器底部约 24px）+ SiriGL 速度/merging 参数已有区分，可选微调（如 polishing 时 speed=1.2、transcribing 时 speed=1.5）。

## Technical Notes

- `useVoiceInput.ts` stop() 中 shouldPolish 判断点（line 172-175）是改 prompt 的根因位置。
- 新增「未配置 chatApiKey」提示时，应当在判断点本地 emit 一个状态（而非改 phase 状态机），避免 error 语义污染。
- orb 窗口的 caption 需要新增 DOM 层（目前 VoiceOrbApp 只渲染 SiriGL canvas），在 `<div style={position:fixed}>` 内增加一个 `pointerEvents:none` 的文字 div。
- 跨窗口事件已有 `voice://orb-phase`，如有新增提示状态可复用同通道扩展 payload。
