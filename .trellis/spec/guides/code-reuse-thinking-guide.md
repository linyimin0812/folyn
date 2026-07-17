# Code Reuse Thinking Guide

> **Purpose**: Stop and think before creating new code - does it already exist?

---

## The Problem

**Duplicated code is the #1 source of inconsistency bugs.**

When you copy-paste or rewrite existing logic:
- Bug fixes don't propagate
- Behavior diverges over time
- Codebase becomes harder to understand

---

## Before Writing New Code

### Step 1: Search First

```bash
# Search for similar function names
grep -r "functionName" .

# Search for similar logic
grep -r "keyword" .
```

### Step 2: Ask These Questions

| Question | If Yes... |
|----------|-----------|
| Does a similar function exist? | Use or extend it |
| Is this pattern used elsewhere? | Follow the existing pattern |
| Could this be a shared utility? | Create it in the right place |
| Am I copying code from another file? | **STOP** - extract to shared |

---

## Common Duplication Patterns

### Pattern 1: Copy-Paste Functions

**Bad**: Copying a validation function to another file

**Good**: Extract to shared utilities, import where needed

### Pattern 2: Similar Components

**Bad**: Creating a new component that's 80% similar to existing

**Good**: Extend existing component with props/variants

### Pattern 3: Repeated Constants

**Bad**: Defining the same constant in multiple files

**Good**: Single source of truth, import everywhere

---

## When to Abstract

**Abstract when**:
- Same code appears 3+ times
- Logic is complex enough to have bugs
- Multiple people might need this

**Don't abstract when**:
- Only used once
- Trivial one-liner
- Abstraction would be more complex than duplication

---

## After Batch Modifications

When you've made similar changes to multiple files:

1. **Review**: Did you catch all instances?
2. **Search**: Run grep to find any missed
3. **Consider**: Should this be abstracted?

---

## Gotcha: Asymmetric Mechanisms Producing Same Output

**Problem**: When two different mechanisms must produce the same file set (e.g., recursive directory copy for init vs. manual `files.set()` for update), structural changes (renaming, moving, adding subdirectories) only propagate through the automatic mechanism. The manual one silently drifts.

**Symptom**: Init works perfectly, but update creates files at wrong paths or misses files entirely.

**Prevention checklist**:
- [ ] When migrating directory structures, search for ALL code paths that reference the old structure
- [ ] If one path is auto-derived (glob/copy) and another is manually listed, the manual one needs updating
- [ ] Add a regression test that compares outputs from both mechanisms

---

## Checklist Before Commit

- [ ] Searched for existing similar code
- [ ] No copy-pasted logic that should be shared
- [ ] Constants defined in one place
- [ ] Similar patterns follow same structure

---

## Reference: macOS Native Framework FFI Pattern

When you need to call a macOS native framework (Speech, AVFoundation, CoreGraphics, AppKit, etc.) from Rust, the canonical reference implementation lives at `apps/desktop/src-tauri/src/voice/`:

- `apple_speech.rs` — `SFSpeechRecognizer` via `objc2` + `block2` (request authorization block, URL recognition request, multi-utterance `SegmentAccumulator` for "speech pauses don't lose prior text" bug).
- `permissions.rs` — `AVAudioApplication.requestRecordPermissionWithCompletionHandler:` (macOS 14+, AVFAudio framework) + `AVCaptureDevice.requestAccessForMediaType:completionHandler:` (older macOS, AVFoundation framework) + `AXIsProcessTrustedWithOptions` with `kAXTrustedCheckOptionPrompt: true` (ApplicationServices + CoreFoundation frameworks). The 8s `recv_timeout` pattern synchronizes the async objc block. **Non-obvious**: cpal's implicit first-use mic prompt is unreliable (especially in Tauri 2 dev mode where the binary may not be a real .app bundle, or after a TCC-crash iteration left permission previously denied). A voice/ASR flow MUST call `permissions::ensure_microphone()` BEFORE `Recorder::start` to guarantee the system prompt fires. Same for accessibility: the bare `AXIsProcessTrusted()` check returns a hard error with no prompt; `request_accessibility()` is the path that actually triggers the system prompt.
- `recorder.rs` — `cpal` mic capture → 16kHz mono Int16 PCM (downmix + linear-interpolation resample).
- `insertion.rs` — CoreGraphics `CGEvent` Cmd+V via raw `extern "C"` + `#[link(name = "...", kind = "framework")]` (zero Cargo deps for system frameworks).
- `wav.rs` — `encode_wav_16k_mono` WAV encoder (pure Rust).

Crate pinning: `objc2` + `block2` coexist with the older `objc 0.2` + `cocoa 0.25` used by `pet_panel_macos.rs`. Don't try to unify — both work side by side. Match versions to `Cargo.toml`'s `[target.'cfg(target_os = "macos")'.dependencies]` block.

cfg gate: all native-framework files start with `#![cfg(target_os = "macos")]` so Windows builds compile clean (the parent module's types become empty on non-macOS).

**Before writing new macOS FFI from scratch**: read `voice/apple_speech.rs`'s doc comments — they explain the SAFETY reasoning for every `msg_send!`, the runloop-thread model (`spawn_blocking` for objc runloop), and the cancellation pattern (`Send` wrapper around a `*mut AnyObject` task handle).

