// dev-voice.mjs — wrap the Tauri dev binary in a stub .app so macOS TCC can
// grant speech-recognition / microphone / accessibility permission in DEV mode.
//
// WHEN TO USE:
//   - `pnpm dev:voice` (this script): voice testing. The .app wrapper gives TCC
//     a `Contents/Info.plist` + bundle ID (`com.mochi.editor`) to consult, so
//     `SFSpeechRecognizer.requestAuthorization` + cpal mic + CGEvent Cmd+V all
//     work. The .app's webview loads from vite's devUrl (http://localhost:1420),
//     so frontend HMR still works.
//   - `pnpm tauri dev`: any non-voice dev. Tauri 2 runs `target/debug/mochi`
//     directly (raw Mach-O, no .app wrapper). The embedded `__info_plist`
//     section provides usage strings to TCC, but TCC for Speech Recognition
//     specifically requires a real .app bundle structure to persistently
//     grant the permission — so `pnpm tauri dev` cannot test voice. See
//     Step 1 research in the task PRD for the full rationale.
//
// ARCHITECTURE:
//   - Spawns `pnpm dev` (vite) in the background; waits for "Local:" on stdout.
//   - Runs `cargo build` (debug) — blocks until success.
//   - Builds `target/debug/Mochi.app/Contents/{Info.plist,Entitlements.plist,
//     MacOS/mochi -> symlink to ../../mochi}`. The MacOS/mochi symlink means a
//     rebuild picks up the new binary without re-wrapping; just re-launch.
//   - `open target/debug/Mochi.app` — launches the .app; TCC sees the bundle.
//   - Rust `log::info!` output goes to the macOS Unified Log. The dev .app's
//     `CFBundleExecutable` is `mochi` (lowercase, see line ~149 below — the
//     MacOS symlink is `Contents/MacOS/mochi`, NOT `Mochi`), so the Unified
//     Log `process` field is `mochi`, NOT `Mochi` (CFBundleName is irrelevant).
//     Read the log via:
//       log stream --predicate 'process == "mochi"' --info --debug
//     in a separate Terminal. If `process ==` matching is flaky on your OS
//     version, fall back to matching the binary path:
//       log stream --predicate 'senderImagePath CONTAINS "Mochi.app"' --info --debug
//     In Console.app, filter by process name `mochi` (lowercase), not `Mochi`.
//     The sidecar `<stamp>.txt` in `.voice_input/` is the on-disk
//     diagnostic for source-save issues — no console needed for that.
//   - Ctrl+C: kill vite + the .app cleanly.
//
// CAVEATS:
//   - macOS-only (refuses on other platforms with a clear error).
//   - Codesign the .app bundle (NOT just the raw binary) so the Info.plist +
//     Entitlements.plist are SEALED into the bundle signature. This is the fix
//     for the "accessibility granted in System Settings but AXIsProcessTrusted()
//     returns false" symptom: an unsealed Info.plist (the previous symlink +
//     sign-binary-only approach produced `Info.plist=not bound` +
//     `Sealed Resources=none`) lets TCC distrust the bundle's claimed
//     CFBundleIdentifier / NS*UsageDescription, so it falls back to cdhash-only
//     matching that breaks across rebuilds. Openless gets this for free because
//     `tauri build` codesigns the whole bundle; we have to do it manually in dev.
//   - Copies the binary into the bundle (not a symlink) so `codesign --deep`
//     seals the Mach-O inside the bundle. A symlink would let codesign -d
//     resolve to the raw `target/debug/mochi`, leaving the bundle's
//     Info.plist/Entitlements.plist unsealed — the previous bug.
//   - ad-hoc signed dev binary: TCC rows are keyed on bundle ID + cdhash.
//   - DON'T spawn the binary directly to capture stdout/stderr — bypassing
//     LaunchServices loses the bundle context TCC needs to find
//     NSSpeechRecognitionUsageDescription → instant TCC crash on stop.
//     (commit c88ecbe tried this; reverted in the follow-up.)

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// scripts/ lives under apps/desktop/, so .. = apps/desktop.
const DESKTOP_ROOT = resolve(__dirname, '..');
const SRC_TAURI_DIR = join(DESKTOP_ROOT, 'src-tauri');
const TARGET_DEBUG_DIR = join(SRC_TAURI_DIR, 'target', 'debug');
const APP_BUNDLE_DIR = join(TARGET_DEBUG_DIR, 'Mochi.app');
const CONTENTS_DIR = join(APP_BUNDLE_DIR, 'Contents');
const MACOS_DIR = join(CONTENTS_DIR, 'MacOS');
const DEV_BINARY = join(TARGET_DEBUG_DIR, 'mochi'); // target/debug/mochi
const MACOS_BINARY = join(MACOS_DIR, 'mochi'); // Contents/MacOS/mochi (a copy, not a symlink)
const SOURCE_INFO_PLIST = join(SRC_TAURI_DIR, 'Info.plist');
const SOURCE_ENTITLEMENTS = join(SRC_TAURI_DIR, 'Entitlements.plist');
const BUNDLE_INFO_PLIST = join(CONTENTS_DIR, 'Info.plist');
const BUNDLE_ENTITLEMENTS = join(CONTENTS_DIR, 'Entitlements.plist');

const VITE_READY_SIGNAL = 'Local:'; // vite prints "Local: http://localhost:1420/" when ready
const BUNDLE_ID = 'com.mochi.editor';
const BUNDLE_NAME = 'Mochi';
const BUNDLE_VERSION = '0.1.0';
const BUNDLE_BUILD = '1';
// Stamp file recording the dev bundle's code-signature DR from the last run.
// ponytail: cdhash is the only TCC-relevant field in the ad-hoc DR; comparing
// the full `codesign -d -r-` output is sufficient — no need to parse out just
// the hash. If throughput ever matters, narrow to a cdhash regex. We sample the
// BUNDLE (not the raw binary) so the stamp reflects the sealed-Info.plist
// signature — if the bundle's signature changes, TCC's grant is stale.
const SIGNATURE_STAMP = join(TARGET_DEBUG_DIR, '.dev-voice-codesign-stamp');

function log(msg) {
  console.log(`[dev:voice] ${msg}`);
}

function fail(msg) {
  console.error(`[dev:voice] ERROR: ${msg}`);
  process.exit(1);
}

function isMacOS() {
  return process.platform === 'darwin';
}

// Start vite in the background; resolve on the "Local:" ready line.
// Returns the child process.
function startVite() {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['dev'], { cwd: DESKTOP_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let resolved = false;
    const onReady = () => {
      if (!resolved) {
        resolved = true;
        resolve(child);
      }
    };
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      process.stdout.write(`[vite] ${text}`);
      if (!resolved && text.includes(VITE_READY_SIGNAL)) onReady();
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      process.stderr.write(`[vite] ${text}`);
    });
    child.on('error', (err) => {
      if (!resolved) reject(new Error(`failed to spawn vite: ${err.message}`));
    });
    child.on('exit', (code) => {
      if (!resolved) reject(new Error(`vite exited before ready (code=${code})`));
    });
  });
}

// Run `cargo build` (debug); throws on failure.
function cargoBuild() {
  log('building dev binary (cargo build — this may take a while on first run)...');
  const result = spawnSync('cargo', ['build'], { cwd: SRC_TAURI_DIR, stdio: 'inherit' });
  if (result.status !== 0) {
    fail(`cargo build failed (status=${result.status})`);
  }
  if (!existsSync(DEV_BINARY)) {
    fail(`cargo build reported success but ${DEV_BINARY} does not exist`);
  }
  log('cargo build OK');
}

// Re-sign the .app BUNDLE (not just the raw binary) with a stable identifier
// matching the bundle's CFBundleIdentifier + the audio-input entitlement.
//
// Why the bundle, not the raw binary: macOS TCC trusts a .app bundle's claimed
// CFBundleIdentifier / NS*UsageDescription ONLY when the Info.plist is SEALED
// into the bundle's code signature (`codesign -dv` must report
// `Info.plist=` bound, not "not bound"; `Sealed Resources=` something, not
// "none"). Signing only `target/debug/mochi` (the previous approach) left
// `Info.plist=not bound` + `Sealed Resources=none` — TCC fell back to
// cdhash-only matching that broke across rebuilds, surfacing as
// "AXIsProcessTrusted() returns false even after the user toggled Accessibility
// ON in System Settings".
//
// `--deep` traverses into the bundle and seals the Mach-O executable +
// Info.plist + Entitlements.plist + Resources in one signature. The
// `--entitlements` flag injects the audio-input entitlement (the same one
// openless/Tauri release builds apply) so cpal mic capture is permitted.
//
// ponytail: `--sign -` is ad-hoc; a stable self-signed cert would make TCC
// grants survive rebuilds entirely (no reset needed), but requires the user
// to create + trust a cert in Keychain. Out of scope for the dev script.
function codesignAppBundle() {
  // ponytail: `-i` is the identifier flag (short for `--identifier`); macOS
  // codesign has no `--bundle-id` flag. `--entitlements` injects the plist
  // into the signature; `--deep` seals nested code (the Mach-O binary).
  const result = spawnSync(
    'codesign',
    [
      '--force',
      '--deep',
      '--sign', '-',
      '-i', BUNDLE_ID,
      '--entitlements', BUNDLE_ENTITLEMENTS,
      APP_BUNDLE_DIR,
    ],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) {
    fail(`codesign of .app bundle failed (status=${result.status}) — run \`codesign --force --deep --sign - -i ${BUNDLE_ID} --entitlements ${BUNDLE_ENTITLEMENTS} ${APP_BUNDLE_DIR}\` manually to diagnose`);
  }
  log(`re-signed ${APP_BUNDLE_DIR} (identifier=${BUNDLE_ID}, entitlements sealed)`);
}

// Read the .app bundle's current code-signature designated requirement (DR).
// `codesign -d -r-` prints `# designated => cdhash H"<hex>"` for ad-hoc signed
// bundles. The cdhash is the only TCC-relevant field — comparing the full
// stdout is a cheap, parsing-free way to detect "bundle signature changed".
// Reads the BUNDLE (not the raw binary) so the stamp reflects the sealed
// signature — matches what TCC actually validates.
function readBundleSignature() {
  const result = spawnSync(
    'codesign',
    ['-d', '-r-', APP_BUNDLE_DIR],
    { encoding: 'utf8' },
  );
  // codesign -d writes the DR to stderr (not stdout); merge both so a future
  // codesign version that moves it to stdout doesn't silently break detection.
  return `${result.stdout || ''}${result.stderr || ''}`.trim();
}

// If the .app bundle's signature DR changed since the last run, reset TCC for
// the bundle ID so the user gets a clean prompt instead of a stale toggle.
// Faithful port of openless `build-mac.sh` (tccutil reset before install) +
// `lib.rs::reset_tcc_for_beta_restart` (same rationale: "ad-hoc 签名 hash
// 每次构建都会变，旧授权立即失效"). Without this, System Settings shows the
// Accessibility toggle ON but `AXIsProcessTrusted()` returns false — exactly
// the "已经授权了，但是还是显示错误" symptom. SpeechRecognition is reset
// too: SFSpeechRecognizer authorization is also a TCC row keyed on the same
// cdhash.
function resetTccIfSignatureChanged() {
  const current = readBundleSignature();
  let previous = '';
  try {
    previous = readFileSync(SIGNATURE_STAMP, 'utf8').trim();
  } catch {
    // First run — no stamp yet. Fall through to reset so a prior grant from a
    // different signature doesn't linger as a stale toggle.
  }
  if (current === previous) {
    log('dev binary signature unchanged — keeping existing TCC grants');
    return;
  }
  log('dev binary signature changed — resetting TCC so the next prompt fires cleanly');
  for (const service of ['Accessibility', 'Microphone', 'SpeechRecognition']) {
    const r = spawnSync('tccutil', ['reset', service, BUNDLE_ID], { stdio: 'inherit' });
    if (r.status !== 0) {
      // tccutil exits non-zero if the service has no row for this bundle ID —
      // harmless on a fresh install. Don't abort the dev script over it.
      console.warn(`[dev:voice] tccutil reset ${service} ${BUNDLE_ID} exited ${r.status} (ok if no prior grant)`);
    }
  }
  try {
    writeFileSync(SIGNATURE_STAMP, current, 'utf8');
  } catch (err) {
    console.warn(`[dev:voice] could not write stamp ${SIGNATURE_STAMP}: ${err.message}`);
  }
}

// Build the Mochi.app wrapper. Idempotent: rm -rf's the existing bundle first.
// - Copies Info.plist + Entitlements.plist from src-tauri/.
// - Injects CFBundleIdentifier / CFBundleExecutable / CFBundlePackageType /
//   CFBundleName / CFBundleShortVersionString / CFBundleVersion into the
//   bundle's Info.plist (the source Info.plist only carries usage strings).
// - Contents/MacOS/mochi is a symlink to ../../mochi (the dev binary) so a
//   rebuild picks up the new binary without re-wrapping.
function buildAppBundle() {
  if (!existsSync(DEV_BINARY)) {
    fail(`${DEV_BINARY} not found — run cargo build first`);
  }
  // Fresh wrapper each time so the symlink + plists are current.
  rmSync(APP_BUNDLE_DIR, { recursive: true, force: true });
  mkdirSync(MACOS_DIR, { recursive: true });
  mkdirSync(join(CONTENTS_DIR, 'Resources'), { recursive: true });

  // Info.plist: copy source, then inject bundle keys after the first <dict>.
  // Lazy: regex-insert on the source XML rather than parsing plist in JS
  // (no new deps). The source Info.plist is a flat dict of usage strings,
  // stable, do-not-touch per the task PRD — drift between source and bundle
  // would surface as a missing key in `plutil -p`, which Step 3 verifies.
  const sourcePlist = readFileSync(SOURCE_INFO_PLIST, 'utf8');
  const bundleKeys = [
    `<key>CFBundleIdentifier</key><string>${BUNDLE_ID}</string>`,
    `<key>CFBundleExecutable</key><string>mochi</string>`,
    `<key>CFBundlePackageType</key><string>APPL</string>`,
    `<key>CFBundleName</key><string>${BUNDLE_NAME}</string>`,
    `<key>CFBundleShortVersionString</key><string>${BUNDLE_VERSION}</string>`,
    `<key>CFBundleVersion</key><string>${BUNDLE_BUILD}</string>`,
  ].join('');
  // Insert bundle keys right after the opening <dict> on its own line.
  // The source uses `<dict>\n  <key>...`, so we anchor on the first `<dict>\n`.
  const bundlePlist = sourcePlist.replace(/<dict>\n/, `<dict>\n  ${bundleKeys}\n`);
  if (bundlePlist === sourcePlist) {
    fail('failed to inject CFBundle keys into Info.plist — source format unexpected');
  }
  writeFileSync(BUNDLE_INFO_PLIST, bundlePlist, 'utf8');

  // Entitlements: copy verbatim (not strictly needed for an unsandboxed dev
  // binary, but the task spec says to include it; harmless).
  copyFileSync(SOURCE_ENTITLEMENTS, BUNDLE_ENTITLEMENTS);

  // COPY the dev binary into the bundle (not a symlink). A symlink would let
  // `codesign --deep` resolve to the raw `target/debug/mochi`, leaving the
  // bundle's Info.plist + Entitlements.plist unsealed (`Info.plist=not bound`)
  // — exactly the TCC-ignores-grant bug we fixed. Copying means codesign seals
  // the in-bundle Mach-O + Info.plist together as one signed bundle. A rebuild
  // requires re-copying (buildAppBundle runs every dev:voice invocation — rm -rf
  // + mkdir at the top, so the copy is fresh each time).
  copyFileSync(DEV_BINARY, MACOS_BINARY);

  log(`built ${APP_BUNDLE_DIR}`);
}

// Launch the .app via `open` so LaunchServices registers the bundle context
// TCC needs to find NSSpeechRecognitionUsageDescription in Info.plist. Spawning
// the binary directly (even inside the bundle) bypasses LaunchServices and
// triggers a TCC crash on stop — see CAVEATS above.
function openApp() {
  const result = spawnSync('open', [APP_BUNDLE_DIR], { stdio: 'inherit' });
  if (result.status !== 0) {
    fail(`open ${APP_BUNDLE_DIR} failed (status=${result.status})`);
  }
  log(`launched ${APP_BUNDLE_DIR}`);
}

// Kill the .app. LaunchServices tracks the app again (launched via `open`), so
// osascript can find "Mochi" by name; fall back to pkill on the bundle's
// MacOS executable path (a copy of the dev binary inside the .app).
function killApp() {
  const polite = spawnSync('osascript', ['-e', `tell application "${BUNDLE_NAME}" to quit`], { stdio: 'ignore' });
  if (polite.status !== 0) {
    spawnSync('pkill', ['-f', MACOS_BINARY], { stdio: 'ignore' });
  }
  log('app stopped');
}

function cleanup() {
  log('shutting down...');
  killApp();
}

function main() {
  if (!isMacOS()) {
    fail('dev:voice is macOS-only — TCC / SFSpeechRecognizer require a .app bundle. On Windows, voice input is disabled (see VoiceInputButton.tsx).');
  }
  if (!existsSync(SOURCE_INFO_PLIST)) {
    fail(`${SOURCE_INFO_PLIST} not found — the voice feature must be set up first`);
  }
  if (!existsSync(SOURCE_ENTITLEMENTS)) {
    fail(`${SOURCE_ENTITLEMENTS} not found — the voice feature must be set up first`);
  }

  let viteChild = null;
  process.on('SIGINT', () => {
    if (viteChild) {
      try { viteChild.kill('SIGTERM'); } catch {}
    }
    cleanup();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    if (viteChild) {
      try { viteChild.kill('SIGTERM'); } catch {}
    }
    cleanup();
    process.exit(0);
  });

  (async () => {
    log('starting vite (frontend HMR for the .app webview)...');
    viteChild = await startVite();
    log('vite ready');

    cargoBuild();
    buildAppBundle();
    codesignAppBundle();
    resetTccIfSignatureChanged();
    openApp();

    log('voice dev environment up. Press Ctrl+C to stop (kills vite + the .app).');
    // Keep the process alive so vite keeps serving HMR; Ctrl+C handler does the cleanup.
    await new Promise(() => {});
  })().catch((err) => {
    if (viteChild) {
      try { viteChild.kill('SIGTERM'); } catch {}
    }
    fail(err.message || String(err));
  });
}

main();
