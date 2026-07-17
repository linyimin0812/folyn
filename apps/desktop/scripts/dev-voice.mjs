// dev-voice.mjs — wrap the Tauri dev binary in a stub .app so macOS TCC can
// grant speech-recognition / microphone / accessibility permission in DEV mode.
//
// WHEN TO USE:
//   - `pnpm dev:voice` (this script): voice testing. The .app wrapper gives TCC
//     a `Contents/Info.plist` + bundle ID (`com.quill.editor`) to consult, so
//     `SFSpeechRecognizer.requestAuthorization` + cpal mic + CGEvent Cmd+V all
//     work. The .app's webview loads from vite's devUrl (http://localhost:1420),
//     so frontend HMR still works.
//   - `pnpm tauri dev`: any non-voice dev. Tauri 2 runs `target/debug/quill`
//     directly (raw Mach-O, no .app wrapper). The embedded `__info_plist`
//     section provides usage strings to TCC, but TCC for Speech Recognition
//     specifically requires a real .app bundle structure to persistently
//     grant the permission — so `pnpm tauri dev` cannot test voice. See
//     Step 1 research in the task PRD for the full rationale.
//
// ARCHITECTURE:
//   - Spawns `pnpm dev` (vite) in the background; waits for "Local:" on stdout.
//   - Runs `cargo build` (debug) — blocks until success.
//   - Builds `target/debug/Quill.app/Contents/{Info.plist,Entitlements.plist,
//     MacOS/quill -> symlink to ../../quill}`. The MacOS/quill symlink means a
//     rebuild picks up the new binary without re-wrapping; just re-launch.
//   - `open target/debug/Quill.app` — launches the .app; TCC sees the bundle.
//   - Rust `log::info!` output goes to the macOS Unified Log; read it via
//     `log stream --predicate 'process == "Quill"' --info --debug` in a
//     separate Terminal, or via Console.app (filter process = Quill).
//     The sidecar `<stamp>.txt` in `.voice_input/` is the on-disk
//     diagnostic for source-save issues — no console needed for that.
//   - Ctrl+C: kill vite + the .app cleanly.
//
// CAVEATS:
//   - macOS-only (refuses on other platforms with a clear error).
//   - The dev binary is ad-hoc signed by cargo. TCC may still re-prompt on
//     rebuilds if the binary's signature path changes — re-grant in
//     System Settings > Privacy & Security if so.
//   - DON'T spawn the binary directly to capture stdout/stderr — bypassing
//     LaunchServices loses the bundle context TCC needs to find
//     NSSpeechRecognitionUsageDescription → instant TCC crash on stop.
//     (commit c88ecbe tried this; reverted in the follow-up.)

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, rmSync, symlinkSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// scripts/ lives under apps/desktop/, so .. = apps/desktop.
const DESKTOP_ROOT = resolve(__dirname, '..');
const SRC_TAURI_DIR = join(DESKTOP_ROOT, 'src-tauri');
const TARGET_DEBUG_DIR = join(SRC_TAURI_DIR, 'target', 'debug');
const APP_BUNDLE_DIR = join(TARGET_DEBUG_DIR, 'Quill.app');
const CONTENTS_DIR = join(APP_BUNDLE_DIR, 'Contents');
const MACOS_DIR = join(CONTENTS_DIR, 'MacOS');
const DEV_BINARY = join(TARGET_DEBUG_DIR, 'quill'); // target/debug/quill
const MACOS_SYMLINK = join(MACOS_DIR, 'quill'); // Contents/MacOS/quill -> ../../quill
const SOURCE_INFO_PLIST = join(SRC_TAURI_DIR, 'Info.plist');
const SOURCE_ENTITLEMENTS = join(SRC_TAURI_DIR, 'Entitlements.plist');
const BUNDLE_INFO_PLIST = join(CONTENTS_DIR, 'Info.plist');
const BUNDLE_ENTITLEMENTS = join(CONTENTS_DIR, 'Entitlements.plist');

const VITE_READY_SIGNAL = 'Local:'; // vite prints "Local: http://localhost:1420/" when ready
const BUNDLE_ID = 'com.quill.editor';
const BUNDLE_NAME = 'Quill';
const BUNDLE_VERSION = '0.1.0';
const BUNDLE_BUILD = '1';

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

// Build the Quill.app wrapper. Idempotent: rm -rf's the existing bundle first.
// - Copies Info.plist + Entitlements.plist from src-tauri/.
// - Injects CFBundleIdentifier / CFBundleExecutable / CFBundlePackageType /
//   CFBundleName / CFBundleShortVersionString / CFBundleVersion into the
//   bundle's Info.plist (the source Info.plist only carries usage strings).
// - Contents/MacOS/quill is a symlink to ../../quill (the dev binary) so a
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
    `<key>CFBundleExecutable</key><string>quill</string>`,
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

  // Contents/MacOS/quill -> symlink to ../../../quill (the dev binary).
  // Three `..` to escape Quill.app/Contents/MacOS/ and reach target/debug/.
  // Relative symlink so the wrapper is portable if target/debug is moved.
  symlinkSync('../../../quill', MACOS_SYMLINK, 'file');

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
// osascript can find "Quill" by name; fall back to pkill on the dev binary.
function killApp() {
  const polite = spawnSync('osascript', ['-e', `tell application "${BUNDLE_NAME}" to quit`], { stdio: 'ignore' });
  if (polite.status !== 0) {
    spawnSync('pkill', ['-f', DEV_BINARY], { stdio: 'ignore' });
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
