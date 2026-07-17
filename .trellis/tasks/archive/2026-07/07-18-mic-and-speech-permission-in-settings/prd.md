# 麦克风 / 语音识别权限接入设置页

## 背景
语音输入(语音 tab)目前只有「辅助功能权限」一行可在设置页显式触发系统授权框。
麦克风 / 语音识别权限只能在录音启动时由后端 `ensure_microphone` /
`apple_speech::ensure_authorized` 隐式触发,设置页无独立入口。

用户希望麦克风 / 语音识别跟辅助功能一样,在设置页可显式触发授权框并看状态。

## 范围(MVP)
在 `VoiceSettings.tsx` 辅助功能行下方新增两行「麦克风权限」「语音识别权限」,
复用与辅助功能完全一致的 `idle|checking|granted|denied` 状态机与按钮文案范式。

### 后端
- 新增 IPC `voice_request_microphone` (macOS): `spawn_blocking` 调
  `permissions::request_microphone()`, `MicStatus::Granted` → true。
- 新增 IPC `voice_request_speech` (macOS): `spawn_blocking` 调
  `apple_speech::ensure_authorized().is_ok()`。
- 非 macOS 桩:两者均返回 `Ok(false)`,与 `voice_request_accessibility` 一致。
- 在 `lib.rs` `invoke_handler` 注册两条命令。

### 前端
- `VoiceSettings.tsx`:新增 `micState` / `speechState` 两个 state,
  各一个 `requestMicrophone` / `requestSpeech` 回调,仿 `requestAccessibility`。
- 两个 `<Row>`,仅 `onMac` 渲染,文案对齐辅助功能行(「点击按钮触发系统授权框」)。
- Denied 文案提示去 系统设置 → 隐私与安全性 对应项开启(语音识别 / 麦克风一旦拒绝,
  系统不重复弹框,需手动去系统设置——与辅助功能重启语义不同,文案点明)。

## 非范围
- 不改录音热路径(`voice_start` 内 `ensure_microphone`/`ensure_authorized` 不动)。
- 不加「打开页面自动 check」——与辅助功能行为对齐(idle 起步,点击才查)。
- 不做独立 Permissions tab。
