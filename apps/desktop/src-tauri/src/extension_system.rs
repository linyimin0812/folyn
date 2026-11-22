//! `system:*` on behalf of trusted extensions (`api.system`): facts about the
//! user's desktop that need native code to read.
//!
//! `frontWindow` — the frontmost app and its window title. Fixed queries with
//! no extension-controlled arguments: a fixed osascript on macOS, fixed FFI
//! calls on Windows. An extension may call it only when its manifest declares
//! `permissions.system.frontWindow` (shown in the consent dialog); the JS side
//! fast-fails, this re-checks the on-disk manifest.

use std::fs;

use serde::Serialize;

use crate::errors::AppError;
use crate::extension_commands::{extensions_dir, is_valid_extension_id};

/// Frontmost app + window title (title null when the platform/window can't
/// provide one).
#[derive(Serialize, Debug)]
pub struct FrontWindow {
    pub app: String,
    pub title: Option<String>,
}

/// The frontmost window (app + title), or `None` when unavailable
/// (unsupported platform, permission denied, no foreground window). On macOS
/// the first call triggers the system Automation-permission prompt.
#[tauri::command]
pub async fn extension_front_window(
    app: tauri::AppHandle,
    extension_id: String,
) -> Result<Option<FrontWindow>, AppError> {
    // A bare id segment, so the manifest read below cannot leave the
    // extensions dir and borrow another extension's declaration.
    if !is_valid_extension_id(&extension_id) {
        return Err(format!("system:frontWindow denied: invalid extension id: {extension_id}").into());
    }
    let manifest_path = extensions_dir(&app)?
        .join(&extension_id)
        .join("manifest.json");
    let manifest_str = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("failed to read manifest for {extension_id}: {e}"))?;
    let manifest: serde_json::Value =
        serde_json::from_str(&manifest_str).map_err(|e| e.to_string())?;
    check_front_window(&manifest)?;
    // osascript can take a moment; keep it off the main thread.
    tauri::async_runtime::spawn_blocking(front_window)
        .await
        .map_err(|e| AppError::Internal {
            detail: format!("front-window task join failed: {e}"),
        })
}

/// Trusted tier only, and `permissions.system.frontWindow` must be `true`.
/// Pure, like the other manifest checks in `extension_security`.
fn check_front_window(manifest: &serde_json::Value) -> Result<(), String> {
    if manifest["tier"].as_str() != Some("trusted") {
        return Err("system:frontWindow denied: trusted tier only".to_string());
    }
    if manifest["permissions"]["system"]["frontWindow"].as_bool() != Some(true) {
        return Err("system:frontWindow denied: permissions.system.frontWindow not declared".to_string());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn front_window() -> Option<FrontWindow> {
    // System Events list output: "AppName, Window Title" / "AppName, missing value".
    let script = "tell application \"System Events\" to get {name, name of first window} of first application process whose frontmost is true";
    let out = std::process::Command::new("osascript")
        .args(["-e", script])
        .output()
        .ok()?;
    if !out.status.success() {
        // Automation not granted yet (or AppleScript error): the app-only
        // script usually still works — same permission, weaker query.
        let fallback = "tell application \"System Events\" to get name of first application process whose frontmost is true";
        let out2 = std::process::Command::new("osascript")
            .args(["-e", fallback])
            .output()
            .ok()?;
        if !out2.status.success() {
            return None;
        }
        let app = String::from_utf8_lossy(&out2.stdout).trim().to_string();
        return (!app.is_empty()).then(|| FrontWindow { app, title: None });
    }
    let line = String::from_utf8_lossy(&out.stdout).trim().to_string();
    // Titles can contain commas; app names can't contain ", " in practice —
    // split at the first separator so a comma'd title stays whole.
    let (app, title) = match line.split_once(", ") {
        Some((a, t)) => (a.trim().to_string(), t.trim()),
        None => (line, ""),
    };
    if app.is_empty() {
        return None;
    }
    let title = if title.is_empty() || title == "missing value" {
        None
    } else {
        Some(title.to_string())
    };
    Some(FrontWindow { app, title })
}

#[cfg(target_os = "windows")]
fn front_window() -> Option<FrontWindow> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
    };

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            log::warn!("[activity] front_window: no foreground window");
            return None;
        }
        let mut title_buf = [0u16; 512];
        let title_len = GetWindowTextW(hwnd, title_buf.as_mut_ptr(), 512);
        let title = if title_len > 0 {
            Some(String::from_utf16_lossy(&title_buf[..title_len as usize]))
        } else {
            None
        };
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == 0 {
            log::warn!("[activity] front_window: no pid for foreground window");
            return None;
        }
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if process.is_null() {
            log::warn!("[activity] front_window: OpenProcess denied for pid {pid}");
            return None;
        }
        let mut path_buf = [0u16; 1024];
        let mut path_len = path_buf.len() as u32;
        let ok = QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            path_buf.as_mut_ptr(),
            &mut path_len,
        );
        CloseHandle(process);
        if ok == 0 {
            log::warn!("[activity] front_window: QueryFullProcessImageNameW failed for pid {pid}");
            return None;
        }
        let image = String::from_utf16_lossy(&path_buf[..path_len as usize]);
        let app = exe_stem(&image).to_string();
        if app.is_empty() {
            log::warn!("[activity] front_window: empty image path for pid {pid}");
            return None;
        }
        // ponytail: UWP front windows are owned by ApplicationFrameHost —
        // resolving the real app needs IApplicationActivationManager; add if
        // UWP titles matter.
        Some(FrontWindow { app, title })
    }
}

/// File name of a process image path without its extension, handling both
/// `\` and `/` separators. The extension is stripped from the last path
/// component only. `""` in → `""` out.
#[cfg(any(target_os = "windows", test))]
fn exe_stem(image_path: &str) -> &str {
    let name = image_path.rsplit(['\\', '/']).next().unwrap_or(image_path);
    match name.rfind('.') {
        // ".hidden" keeps its name: the leading dot isn't an extension.
        Some(0) | None => name,
        Some(i) => &name[..i],
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn front_window() -> Option<FrontWindow> {
    None
}

#[cfg(test)]
mod exe_stem_tests {
    use super::*;

    #[test]
    fn strips_last_component_and_extension() {
        assert_eq!(exe_stem(r"C:\Program Files\Code.exe"), "Code");
        assert_eq!(exe_stem(r"C:\apps\foo.bar\Weird.Sig.exe"), "Weird.Sig");
        assert_eq!(exe_stem("/usr/bin/code"), "code");
        assert_eq!(exe_stem("Code.exe"), "Code");
        assert_eq!(exe_stem("noext"), "noext");
    }

    #[test]
    fn edge_cases() {
        assert_eq!(exe_stem(r"C:\dir\.hidden"), ".hidden");
        assert_eq!(exe_stem("."), ".");
        assert_eq!(exe_stem(""), "");
    }
}

#[cfg(test)]
mod check_tests {
    use super::*;

    #[test]
    fn allows_a_trusted_extension_that_declares_it() {
        let m = serde_json::json!({ "tier": "trusted", "permissions": { "system": { "frontWindow": true } } });
        assert!(check_front_window(&m).is_ok());
    }

    #[test]
    fn denies_without_the_declaration() {
        for m in [
            serde_json::json!({ "tier": "trusted" }),
            serde_json::json!({ "tier": "trusted", "permissions": { "system": {} } }),
            serde_json::json!({ "tier": "trusted", "permissions": { "system": { "frontWindow": false } } }),
            serde_json::json!({ "tier": "trusted", "permissions": { "system": { "frontWindow": "yes" } } }),
        ] {
            assert!(check_front_window(&m).is_err(), "{m}");
        }
    }

    #[test]
    fn denies_the_sandbox_tier() {
        let m = serde_json::json!({ "tier": "sandbox", "permissions": { "system": { "frontWindow": true } } });
        assert!(check_front_window(&m).is_err());
    }
}
