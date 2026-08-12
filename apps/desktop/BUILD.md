# Building Quill Desktop

Cross-platform build instructions for the Tauri 2 + React/TS desktop app.

## Prerequisites

| Platform | Toolchain |
|----------|-----------|
| macOS | Xcode CLT, Rust stable, Node 20+, pnpm |
| Windows | Microsoft Visual C++ Build Tools (MSVC), Rust stable (`x86_64-pc-windows-msvc`), Node 20+, pnpm, WebView2 runtime (preinstalled on Win10+/Server 2022+) |

Install Rust targets if missing:

```sh
rustup target add aarch64-apple-darwin x86_64-apple-darwin      # macOS
rustup target add x86_64-pc-windows-msvc                        # Windows
```

## Dev

```sh
pnpm install
pnpm dev                  # vite dev server (frontend only, no Tauri shell)
pnpm tauri dev            # full Tauri app in dev (uses host platform)
```

For the voice dev wrapper (macOS only — codesign + TCC reset):

```sh
pnpm dev:voice
```

## Production build

```sh
# Frontend only (typecheck + vite build)
pnpm build

# Native installer per platform — run on the matching OS:
pnpm build:mac            # macOS: .app + .dmg, signed with ad-hoc identity, copied to /Applications
pnpm build:win            # Windows: .exe (NSIS) + .msi via Tauri's bundle.windows config
pnpm tauri build          # current host platform, Tauri defaults
```

### Windows-specific notes

- The NSIS installer (`bundle.windows.nsis.installMode: "currentUser"`) installs per-user (no admin elevation needed).
- Code signing is **not** configured in this repo; SmartScreen will warn on first run of an unsigned `.exe`. Pass `--target x86_64-pc-windows-msvc` if cross-compiling (rare; usually you build on a Windows host).
- ARM64 Windows is **not** a build target yet (x86_64 only).

### macOS-specific notes

- `build:mac` runs `scripts/build-mac.sh` which signs, verifies, and copies to `/Applications/Quill.app`. Requires the `codesign` / `PlistBuddy` / `xattr` tools (macOS-only).
- Universal binary build is handled by `.github/workflows/release.yml`'s `build-macos-universal` job.

## CI

`.github/workflows/release.yml` runs on `release: published` and `workflow_dispatch`. Matrix:

- `macos-latest` × `aarch64-apple-darwin`
- `macos-latest` × `x86_64-apple-darwin`
- `windows-latest` × `x86_64-pc-windows-msvc`
- `build-macos-universal` (separate job, universal binary)

Each job uses `tauri-apps/tauri-action@v0` to build + attach artifacts to the GitHub release.

## Platform support matrix

| Feature | macOS | Windows | Notes |
|---|---|---|---|
| Editor / file tree / shell detect | ✅ | ✅ | R2-R8 (PR3) |
| Terminal (xterm + portable-pty) | ✅ | ✅ (cmd / PowerShell via ConPTY) | R5-R7 (PR3) |
| Chrome cookie/password import | ✅ (Keychain + AES-128-CBC) | ✅ (DPAPI + AES-256-GCM) | R9 (PR5) |
| Open external URL/app | ✅ (`open`) | ✅ (`cmd /c start`) | R10 (PR4) |
| Pet overlay window | ✅ (NSPanel) | ⚠ follow-up | `#[cfg(target_os="macos")]` stub on Windows; UI hides entry |
| Voice input | ✅ (SFSpeechRecognizer) | ⚠ follow-up | `#[cfg(target_os="macos")]` stub on Windows; UI hides entry |

## Known Windows gaps (follow-up tasks)

- **Pet overlay native rewrite**: NSPanel → WS_EX_LAYERED + WS_EX_TOOLWINDOW + SetWindowPos HWND_TOPMOST, multi-monitor work area via SystemParametersInfoW / GetMonitorInfoW. Current pet commands are cfg-gated to macOS.
- **Voice input native rewrite**: SFSpeechRecognizer → Windows::Media::SpeechRecognition (WinRT); CoreGraphics CGEvent → SendInput (user32); AVFoundation mic permission → Windows::Media::Capture::MediaCapture. Current voice module is cfg-gated to macOS.
- **Pi adapter Windows support**: `buildPiShellCommand` uses `cliPath.includes('/')` + sh-only sibling-node invocation. Pi CLI on Windows needs a separate spawn path (follow-up).
- **Windows code signing / MSIX**: not in this repo; SmartScreen will warn on unsigned `.exe` until a signing cert is added.
