# Research: SendInput + Clipboard for voice paste on Windows

- **Query**: `user32::SendInput` + `VK_CONTROL` + `VK_V` 模拟 Cmd+V；剪贴板 `OpenClipboard` + `SetClipboardData` vs Tauri 2 clipboard plugin；`paste_log` Windows 落位
- **Scope**: mixed (内部代码已读 + 外部 API 知识)
- **Date**: 2026-08-13

## TL;DR

Windows 等价 macOS `insertion.rs` CGEvent Cmd+V：**`user32::SendInput` + `VK_CONTROL` + `VK_V` keydown/keyup 序列**。剪贴板预填**复用现有 `tauri-plugin-clipboard-manager`**（已在 `Cargo.toml:21`），不引 `OpenClipboard`/`SetClipboardData` FFI。`paste_log` 路径从 `~/Library/Logs/...` 改为 `dirs::cache_dir().unwrap().join("folyn/logs")` → Windows 上 `%LOCALAPPDATA%\folyn\logs\folyn-voice-debug.log`。Accessibility 概念在 Windows 不存在（不需要 AX 权限），SendInput 在 foreground app 注入即可。

## Files Found

| File Path | Description |
|---|---|
| `apps/desktop/src-tauri/src/voice/insertion.rs` | macOS CGEvent Cmd+V 实现，`#![cfg(target_os = "macos")]` gate，需 Windows cfg 新文件 `voice/insertion_win.rs` 或 cfg 分支 |
| `apps/desktop/src-tauri/src/voice.rs:28-49` | `paste_log` 函数 macOS 实现，路径硬编码 `~/Library/Logs/folyn-voice-debug.log`；需 Windows 路径分支 |
| `apps/desktop/src-tauri/src/voice.rs:676-709` | `voice_insert_text` macOS 命令，hide-orb + `spawn_blocking(insertion::insert_text)`；Windows 需 cfg 分支，不依赖 orb hide（无 NSPanel） |
| `apps/desktop/src-tauri/src/voice/insertion.rs:84-116` | `insert_text`：clipboard write → `post_cmd_v()` → schedule restore；Windows 等价 |
| `apps/desktop/src-tauri/src/voice/insertion.rs:195-310` | `post_cmd_v`：CGEvent FFI；Windows 用 SendInput FFI 替换 |
| `apps/desktop/src-tauri/src/voice/insertion.rs:118-149` | `schedule_clipboard_restore`：thread::spawn + 750ms 后恢复；Windows 可直接复用（cp 不依赖平台） |
| `apps/desktop/src-tauri/Cargo.toml:142-151` | 已有 `windows-sys` features `Win32_UI_WindowsAndMessaging` + `Win32_Foundation`，`SendInput` 在 `Win32_UI_Input_KeyboardAndMouse` 需补 |

## macOS Cmd+V 实现回顾

`insertion.rs:195-310` — CoreGraphics FFI：

```rust
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventSourceCreate(state_id: CGEventSourceStateID) -> CGEventSourceRef;
    fn CGEventCreateKeyboardEvent(source: CGEventSourceRef, virtual_key: CGKeyCode, key_down: bool) -> CGEventRef;
    fn CGEventSetFlags(event: CGEventRef, flags: CGEventFlags);
    fn CGEventPost(tap: CGEventTapLocation, event: CGEventRef);
}
// KEY_V = 9, KCG_EVENT_FLAG_MASK_COMMAND = 0x00100000, KCG_HID_EVENT_TAP = 0
```

行为：`CGEventPost(KCG_HID_EVENT_TAP, event)` 注入到**前台 app 的 key window**（不是 Folyn 自己），与 macOS `voice_insert_text` 的 "cross-app insert" 语义一致。

## Windows SendInput 等价

**Cargo.toml feature**（补到 `windows-sys` 或迁 `windows` crate）：

```toml
windows-sys = { version = "0.59", features = [
  "Win32_UI_Input_KeyboardAndMouse",  # SendInput, KEYBDINPUT, VK_*
  "Win32_UI_WindowsAndMessaging",     # 已有
  "Win32_Foundation",                 # 已有
  # ... 其他已有
] }
```

`SendInput` FFI（`voice/insertion_win.rs`，顶层 `#![cfg(target_os = "windows")]`）：

```rust
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, KEYBDINPUT, INPUT, INPUT_KEYBOARD, KEYEVENTF_KEYUP,
    VK_CONTROL, VK_V,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow};

const KEY_V: u16 = 0x56;  // 'V' virtual key

fn post_ctrl_v() -> Result<(), String> {
    unsafe {
        let mut inputs: [INPUT; 4] = std::mem::zeroed();
        // 1. Ctrl down
        inputs[0].r#type = INPUT_KEYBOARD;
        *(&mut inputs[0].Anonymous.ki as *mut KEYBDINPUT) = KEYBDINPUT {
            wVk: VK_CONTROL, wScan: 0, dwFlags: 0, time: 0, dwExtraInfo: 0,
        };
        // 2. V down
        inputs[1].r#type = INPUT_KEYBOARD;
        *(&mut inputs[1].Anonymous.ki as *mut KEYBDINPUT) = KEYBDINPUT {
            wVk: KEY_V, wScan: 0, dwFlags: 0, time: 0, dwExtraInfo: 0,
        };
        // 3. V up
        inputs[2].r#type = INPUT_KEYBOARD;
        *(&mut inputs[2].Anonymous.ki as *mut KEYBDINPUT) = KEYBDINPUT {
            wVk: KEY_V, wScan: 0, dwFlags: KEYEVENTF_KEYUP, time: 0, dwExtraInfo: 0,
        };
        // 4. Ctrl up
        inputs[3].r#type = INPUT_KEYBOARD;
        *(&mut inputs[3].Anonymous.ki as *mut KEYBDINPUT) = KEYBDINPUT {
            wVk: VK_CONTROL, wScan: 0, dwFlags: KEYEVENTF_KEYUP, time: 0, dwExtraInfo: 0,
        };
        let sent = SendInput(4, inputs.as_mut_ptr(), std::mem::size_of::<INPUT>() as i32);
        if sent == 0 {
            return Err("SendInput returned 0".into());
        }
    }
    Ok(())
}
```

**关键差异 vs. macOS CGEvent**：
- macOS `CGEventPost` 把事件注入到 HID event tap（系统级），key window 谁有焦点谁收到。
- Windows `SendInput` 注入到**当前 foreground 窗口**的 input queue。前台窗口通常是用户正在 dictation 的目标 app。
- macOS 行为对齐点：两者都是"注入前台，不是 Folyn 自己"。Folyn 主窗口在录音期间不应抢焦点——macOS 用 NSPanel `orderFrontRegardless` 非激活；Windows 上 `voice-orb` 窗口（若启用）需 `SetWindowPos HWND_TOPMOST` 但不 `SetForegroundWindow`，否则 SendInput 注入到 Folyn 自己的 webview。

## Clipboard 路径

**推荐：复用 `tauri-plugin-clipboard-manager`**（`Cargo.toml:21`，macOS `insertion.rs:24` 已用）。

```rust
use tauri_plugin_clipboard_manager::ClipboardExt;
// 在 voice/insertion_win.rs 里：
let clipboard = app.clipboard();
clipboard.write_text(text.to_string())?;   // 写入
let prev = clipboard.read_text().ok();       // snapshot 恢复用
```

**为何不用 `OpenClipboard` + `SetClipboardData` FFI**：
1. Tauri clipboard plugin 已链接，零新依赖（ponytail 第 5 档）。
2. `OpenClipboard` 需 `GetForegroundWindow` handle，否则失败；plugin 内部已处理。
3. `SetClipboardData(CF_UNICODETEXT, hGlobal)` 需 `GlobalAlloc` + `GlobalLock` + memcpy + `GlobalUnlock`， boilerplate ~30 行，plugin 一行 `write_text` 替代。
4. plugin 跨平台一致（macOS/Windows/Linux 同 API）。

**唯一例外**：若需要写非文本（HTML/RTF/image），plugin 0.x 仅支持 text + image；首版只需 text。

## paste_log 路径

`voice.rs:33-34` 现状：

```rust
let path = std::path::PathBuf::from(std::env::var("HOME").unwrap_or_default())
    .join("Library/Logs/folyn-voice-debug.log");
```

PRD R11 要求改为 `dirs::cache_dir().join("folyn/logs")`：

```rust
fn paste_log(msg: &str) {
    use std::io::Write;
    let dir = dirs::cache_dir()  // Cargo.toml 加 dirs dep（或走路过的 tauri::path::cache_dir()）
        .unwrap_or_else(|| std::env::temp_dir())
        .join("folyn").join("logs");
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("folyn-voice-debug.log");
    // ... OpenOptions ...
}
```

**Windows 落位**：`dirs::cache_dir()` 在 Windows 返回 `%LOCALAPPDATA%`（即 `C:\Users\<user>\AppData\Local`），所以最终路径：
```
C:\Users\<user>\AppData\Local\folyn\logs\folyn-voice-debug.log
```

`dirs` crate 已是 tauri 的 transitive dep（`tauri` 内部用），但**未直接声明**。推荐用 `tauri::path::cache_dir(&app)`（Tauri 2 API）避免新 dep：

```rust
let dir = app.path().cache_dir()  // tauri::AppHandle 的 path()
    .unwrap_or_else(|_| std::env::temp_dir().to_path_buf())
    .join("folyn").join("logs");
```

但 `paste_log` 在 `insertion.rs` 是被 `post_cmd_v` 调用、无 `app` handle 入参。需重构 `paste_log` 签名传 `&AppHandle`，或用 `OnceLock<PathBuf>` 在 setup 时初始化全局路径（与 macOS 当前无 `app` 形参兼容）。

**推荐方案**：用 `dirs` 直接 dep（`Cargo.toml` 加 `dirs = "5"`），跨平台一致，`paste_log` 保持自由函数无 app handle。`dirs` 是轻量纯 Rust crate，编译时间 < 1s。

## 与 macOS 行为差异

| 维度 | macOS | Windows |
|---|---|---|
| 注入 API | `CGEventPost` (HID tap) | `SendInput` (foreground queue) |
| 权限 | Accessibility (AXIsProcessTrusted) | 无等价权限；UIPI（User Interface Privilege Isolation）下 Folyn 若非 elevated 进程不能注入到 elevated 目标，普通用户场景无影响 |
| 剪贴板 | `tauri-plugin-clipboard-manager` | 同（plugin 跨平台） |
| Orb hide pre-paste | NSPanel hide 防 key window 干扰 | `voice-orb` Tauri window（若启用）需 `hide()` pre-paste 同 macOS；Tauri `window.hide()` 跨平台一致 |
| 恢复剪贴板 | 750ms 后 thread::spawn | 同（thread::spawn 跨平台） |
| 前台窗口检测 | `voice_debug_frontmost` objc2 NSWorkspace | `GetForegroundWindow` + `GetWindowTextW` + `GetWindowThreadProcessId`，可在 `windows-sys` `Win32_UI_WindowsAndMessaging` feature 下实现 |

## paste_log 重构改动点

1. `voice.rs:28-49` 移除 `#[cfg(target_os = "macos")]` gate，让 `paste_log` 跨平台可用。
2. 路径函数提取 `paste_log_path() -> PathBuf`，cfg 分支：
   - macos: `~/Library/Logs/folyn-voice-debug.log`
   - windows: `%LOCALAPPDATA%\folyn\logs\folyn-voice-debug.log`
   - linux: `~/.cache/folyn/logs/folyn-voice-debug.log`
3. `insertion.rs` 的 `paste_log` 调用（line 85, 96, 98, 101, 104, 113, 250, 263, 277, 280, 296, 301）全部走新 `paste_log`。
4. Windows `insertion_win.rs` 复用同一 `paste_log`，无需新建。

## 风险点

1. **SendInput 被 foreground 窗口拒绝**（UIPI）：若用户正在 dictation 到管理员进程而 Folyn 非管理员，SendInput 失败。普通用户场景少见。**MVP 不处理**。
2. **SendInput 时序**：Ctrl down → V down → V up → Ctrl up 必须同一 `SendInput` 调用（4 个 input）或紧密连续 4 个 `SendInput(1, ...)`。同批 4 个最稳。
3. **clipboard race**：`tauri-plugin-clipboard-manager` 在 Windows 用 OLE clipboard，`write_text` 可能阻塞 10-50ms（OLE marshal）。`insertion.rs:84-116` 已包在 `spawn_blocking`（`voice.rs:705`），Windows 同路径。
4. **`paste_log` 创建目录权限**：`%LOCALAPPDATA%` 用户可写，无障碍。
5. **`dirs` crate vs `tauri::path`**：选 `dirs` 简单，但若 `Cargo.toml` 已通过其他 transitive dep 拉入 `dirs`，加显式 dep 会触发版本锁定（已在 `windows-sys` 0.59 依赖链中可能含 `dirs` 5.x）。需 `cargo tree -d dirs` 确认版本，避免双版本。

## Caveats / Not Found

- 未验证 `windows-sys` 0.59 的 `Win32_UI_Input_KeyboardAndMouse` feature 是否包含 `VK_V`（实际 `VK_V` 不是命名常量，需用字面量 `0x56`；`VK_CONTROL` 是常量）。Windows host `cargo check` 验证。
- 未验证 `tauri-plugin-clipboard-manager` 2.x 在 Windows 上 `write_text` 是否走 OLE 还是 `OpenClipboard`；插件源码未读，依赖其跨平台契约。
- `GetForegroundWindow` + `GetWindowTextW` 的 `voice_debug_frontmost` 等价实现未在 windows-sys feature 集中确认（`Win32_UI_WindowsAndMessaging` 应包含，已声明）。
