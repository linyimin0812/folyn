# Research: Frontend voice gating — replace `onMac()` with platform detection

- **Query**: `onMac()` 替换为 `isTauri()` + `isWindowsPlatform()` 的改动点、UI/状态机路径、i18n 文案调整
- **Scope**: internal (纯前端代码 grep + read)
- **Date**: 2026-08-13

## TL;DR

3 个 `onMac()` 调用点全部替换为 `onMacOrWindows()`（或 `isTauri() && !isWeb()`，平台检测统一走 `apps/desktop/src/utils/shellSidecar.ts:24` 的 `isWindowsPlatform()` + 现有 `/Mac/i.test(navigator.platform)`）。i18n key `settings:voice.windowsUnsupported` / `ai:voice.button.windowsUnsupported` / `settings:voice.windowsUnsupportedBanner` 在 Windows 平台上不再渲染，文案改为"已支持"或删除。状态机 `useVoiceInput` 的 `onMac()` 守卫（line 60, 145）改为 `onMacOrWindows()`，hotkey path 同。VoiceSettings 的三个 macOS permission rows（麦克风/语音识别/辅助功能）在 Windows 上隐藏（无等价权限概念）。

## Files Found

| File Path | Line | Description |
|---|---|---|
| `apps/desktop/src/components/ai/VoiceInputButton.tsx` | 31 | `function onMac(): boolean { return isTauri() && /Mac/i.test(navigator.platform); }` |
| `apps/desktop/src/components/ai/VoiceInputButton.tsx` | 56 | `const mac = onMac();` |
| `apps/desktop/src/components/ai/VoiceInputButton.tsx` | 61 | `const isDisabled = disabled || !mac || busy;` — 非 macOS 直接禁用 |
| `apps/desktop/src/components/ai/VoiceInputButton.tsx` | 84-94 | `title` 文案：`!mac` 时显示 `t('ai:voice.button.windowsUnsupported')` |
| `apps/desktop/src/components/ai/VoiceInputButton.tsx` | 98 | `recording && (!mac || !glAvailable)` — fallback ring gate |
| `apps/desktop/src/hooks/useVoiceInput.ts` | 60-62 | `function onMac(): boolean { ... }` 镜像定义 |
| `apps/desktop/src/hooks/useVoiceInput.ts` | 145 | `if (!onMac()) return;` — start 守卫 |
| `apps/desktop/src/components/settings/VoiceSettings.tsx` | 140 | `const onMac = isTauri() && /Mac/i.test(navigator.platform);` |
| `apps/desktop/src/components/settings/VoiceSettings.tsx` | 175, 178, 185, 183-187, 189-199, 233-241, 286-294 | `!onMac` 分支渲染 `windowsUnsupportedBanner` / macOS permission rows gate |
| `apps/desktop/src/utils/shellSidecar.ts` | 24 | `isWindowsPlatform(): boolean { return /Win/i.test(navigator.platform); }` 已存在 |
| `apps/desktop/src/utils/shellSidecar.ts` | 17 | `const isWin = /Win/i.test(navigator.platform);` buildShellSidecar 内联检查 |
| `apps/desktop/src/i18n/locales/zh/settings.json` | 440-441 | `windowsUnsupported` / `windowsUnsupportedBanner` 中文文案 |
| `apps/desktop/src/i18n/locales/en/settings.json` | 440-441 | 英文文案 |
| `apps/desktop/src/i18n/locales/zh/ai.json` | 62 | `ai:voice.button.windowsUnsupported` 中文 |
| `apps/desktop/src/i18n/locales/en/ai.json` | 62 | 英文 |

## 替换方案

### 新建 `apps/desktop/src/utils/voicePlatform.ts`

最小改动方案：**不新建文件**，直接在 3 个文件本地定义 `onMacOrWindows()`，或在 `shellSidecar.ts` 加导出。推荐后者（统一来源）：

```ts
// shellSidecar.ts 追加：
export function isVoiceSupportedPlatform(): boolean {
  if (!isTauri()) return false;
  if (typeof navigator === 'undefined') return false;
  return /Mac/i.test(navigator.platform) || /Win/i.test(navigator.platform);
}

export function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
}
```

`isVoiceSupportedPlatform` = macOS ∪ Windows（语音已实装的平台）；`isMacPlatform` 保留给需要 macOS-only 行为（如 permission rows、`voice_request_accessibility` 等 Windows 无等价的入口）。

### VoiceInputButton.tsx 改动

```tsx
// line 4 import 改：
import { isTauri } from '@/utils/platform';
import { isVoiceSupportedPlatform, isMacPlatform } from '@/utils/shellSidecar';
// 等价：用现有 isWindowsPlatform + 内联 onMac，避免新函数。推荐导出 isVoiceSupportedPlatform 集中。

// line 31 删除 onMac 定义
// line 56 改：
const voiceSupported = isVoiceSupportedPlatform();
const isMac = isMacPlatform();

// line 61 改：
const isDisabled = disabled || !voiceSupported || busy;

// line 84-94 title 改：
const title = !voiceSupported
  ? t('ai:voice.button.unsupported')  // 改 i18n key，见下
  : recording ? ...
```

`recording && (!voiceSupported || !glAvailable)` fallback ring 分支（line 98）：Windows 上 `voiceSupported=true`，但 macOS 的 SiriGL orb 是独立 Tauri 窗口，Windows 上 orb 窗口若未启用 → fallback ring 必须渲染。改：

```tsx
{recording && (isMac ? !glAvailable : true) && trigger === 'hotkey' && (
  // macOS：glAvailable=false 时 fallback；Windows：always fallback ring（无 orb / 无 SiriGL）
)}
```

### useVoiceInput.ts 改动

```ts
// line 60-62 删除 onMac 定义
// line 7 import 改：
import { isVoiceSupportedPlatform } from '@/utils/shellSidecar';

// line 145 改：
if (!isVoiceSupportedPlatform()) return;

// line 298-307 `voice_debug_frontmost` 调用：Windows 上 Rust 有 cfg 分支返回 macOS-only 错误，
// 改为 isMac 时才调用，Windows skip：
if (isMacPlatform()) { try { await invoke('voice_debug_frontmost'); } ... }
```

### VoiceSettings.tsx 改动

```tsx
// line 140 改：
const voiceSupported = isVoiceSupportedPlatform();
const isMac = isMacPlatform();

// line 175, 178: !voiceSupported 时显示 unsupported banner；!isMac 时隐藏 macOS permission rows
// line 183-187: !voiceSupported 渲染 windowsUnsupportedBanner（文案改名，见 i18n）
// line 189-199: isMac 渲染 macOS mic permission row
// line 233-241: isMac 渲染 macOS speech permission row
// line 286-294: isMac && autoPaste 渲染 macOS accessibility permission row
```

## UI / 状态机路径全清单

### 1. VoiceInputButton.tsx
- **L56** `const mac = onMac()` → 替换 `voiceSupported`
- **L61** `isDisabled` gate → 用 `voiceSupported`
- **L84** title `!mac` 分支 → `!voiceSupported` + 改 i18n key
- **L98** fallback ring gate → macOS 走 `!glAvailable`，Windows 走 `true`（无 orb）
- **L126** aria-label 不依赖平台

### 2. useVoiceInput.ts (zustand store)
- **L60-62** `onMac()` 定义 → 删除
- **L145** `start()` 守卫 `if (!onMac()) return;` → `isVoiceSupportedPlatform()`
- **L293-297** `voice_debug_frontmost` before insert → `isMac` gate（Windows Rust 返 macOS-only 错误）
- **L305-308** `voice_debug_frontmost` after insert → 同上
- **L329** `showVoiceOrbWindow()` → Windows 上 orb 窗口若启用则 show，否则 no-op（plugin `WebviewWindow.getByLabel('voice-orb')` 跨平台）

### 3. VoiceSettings.tsx
- **L140** `onMac` → 拆 `voiceSupported` + `isMac`
- **L175, 178** `!onMac` 渲染 `windowsUnsupported` → `!voiceSupported`
- **L183-187** banner gate → `!voiceSupported`
- **L189-199** macOS mic permission row gate → `isMac`
- **L233-241** macOS speech permission row gate → `isMac`
- **L286-294** macOS accessibility permission row gate → `isMac && autoPaste`
- **L196, 239, 292** `requestPerm('voice_request_*')` invoke → `isMac` gate（Windows Rust 返 false 或错误）

### 4. App.tsx (global hotkey listener)
- 未读 App.tsx，但 `useVoiceInput.ts:49` 注释提到 "App.tsx global-hotkey listener" — 调用 `useVoiceInput.getState().start()/stop()`，走 store 守卫，**无需额外改**。

### 5. VoiceOrbApp (separate Tauri window)
- 未读，但 `useVoiceInput.ts:85-94` `emitOrbPhase` 广播 `voice://orb-phase`。Windows 上 orb 窗口是否启用待 PR 决定；若启用，orb frontend 需 cfg 同 `useVoiceInput` 的 `isVoiceSupportedPlatform`；若不启用，`voice_orb_hide` 命令在 Windows 仍存在（`voice.rs:415` 无 cfg gate，跨平台），orb 窗口不存在时 `voice_orb_hide` 返回 `voice-orb window not found` 错误——前端 `useVoiceInput` 应 swallow 此错误。

## i18n 文案调整

**新增/改 key**（`zh` + `en` 两份）：

| Key | 旧值 | 新值 |
|---|---|---|
| `settings:voice.windowsUnsupported` | `"。Windows 暂不支持语音输入"` | **删除或改** `"。当前平台不支持语音输入"`（仅 Linux/web 时显示） |
| `settings:voice.windowsUnsupportedBanner` | `"当前平台暂不支持语音输入..."` | 同上，"当前平台" |
| `ai:voice.button.windowsUnsupported` | `"Windows 暂不支持语音输入"` | `"ai:voice.button.unsupported"` = `"当前平台不支持语音输入"` |
| `settings:voice.microphone.title` / `.desc` / `.action` | macOS AVAudioApplication 描述 | 加 `macos` 后缀或 `voice.permission.mic.macos.title`，Windows 不渲染此 row |

**推荐方案**：保留现有 key，文案改为"当前平台"通用化（Linux/web 仍可能命中），不新增 key。Windows 用户不再看到 unsupported banner，UX 自然恢复。

## macOS permission rows 在 Windows 的处理

`VoiceSettings.tsx` 三个 `PermissionRow`（mic / speech / accessibility）在 Windows 上：
- **麦克风**：Windows 无独立"语音识别"权限概念，cpal 隐式弹 Consent UI。**隐藏 row**（`isMac &&` gate）。
- **语音识别**：Windows 无 SFSpeechRecognizer 等价，WinRT SpeechRecognizer 不需独立权限。**隐藏 row**。
- **辅助功能**：Windows 无 AX 概念，SendInput 不需权限。**隐藏 row**。

Windows 用户在 VoiceSettings 看到：
- 通用设置（saveSource / sourceDir / spokenLanguage / autoPolish / polishPrompt / autoPaste / globalHotkey / voicePair）全部可见。
- 三个 macOS 权限 row 隐藏。
- 顶部无 unsupported banner。

## 风险点

1. **`navigator.platform` deprecated**：浏览器 spec 标记 deprecated，但 Tauri 2 webview 仍可用。替代 `navigator.userAgentData.platform` 在 Tauri webview 不一定支持。**MVP 保留 `navigator.platform`**，Tauri webview 兼容。
2. **VoiceOrbApp 窗口在 Windows 启用决策**：若启用需 `tauri.conf.json` 的 `voice-orb` 窗口配置跨平台（已配，`voice.rs:300-376` macOS 用 NSPanel，Windows 用普通 Tauri 窗口 + `WS_EX_TOOLWINDOW` 类似 pet）。**MVP 可不启用 orb**，前端 `showVoiceOrbWindow` swallow no-window 错误，UX 退化到 mic-button 内 ring（fallback CSS）。
3. **`voice_debug_frontmost` Windows 实现**：Rust 侧需 cfg 分支，Windows 上 `GetForegroundWindow` + `GetWindowTextW` + `GetWindowThreadProcessId` 返回前台窗口信息（`windows-sys` `Win32_UI_WindowsAndMessaging` feature 已有）。MVP 可省，前端 isMac gate 不调用即可。
4. **i18n key 改名回归**：若 `windowsUnsupported` 改 `unsupported`，需全局 grep 确认无其他调用。已 grep，仅 3 处 + 4 处 locale。
5. **`globalHotkey` 注册**：`voice_set_global_hotkey` 命令跨平台（`voice.rs:898-944` 无 cfg gate），`tauri-plugin-global-shortcut` 在 Windows 用 RegisterHotKey，注册 OK。前端 VoiceSettings 的 hotkey recorder（`VoiceSettings.tsx:67-119` `VoiceHotkeyRecorder`）不需改，已跨平台。

## Caveats / Not Found

- 未读 `apps/desktop/src/App.tsx` 确认 global hotkey listener 的 onMac gate；`useVoiceInput.ts:49` 注释指向 App.tsx，若 App.tsx 也有 `onMac()` 需同替换。需 grep `onMac` 全项目。
- 未读 `VoiceOrbApp.tsx`（orb 窗口前端），Windows 上 orb 启用决策待 PR。
- 未读 `apps/desktop/src/utils/platform.ts`（`isTauri` 来源），确认其跨平台一致性。
- 未读 `apps/desktop/src/store/voiceStore.ts`（`spokenLanguage` 等 settings），假设其平台无关。
